import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { AppStore, JobDefinitionRecord, JobKey, JobRunRecord, MetricFamily, OperatorProfileRecord, SnapshotRecord, SprintWindowRecord } from "./types";

interface State {
  jobs: JobDefinitionRecord[];
  runs: JobRunRecord[];
  snapshots: SnapshotRecord[];
  sprintWindows: SprintWindowRecord[];
  operators: OperatorProfileRecord[];
  settings: Record<string, { value: unknown; updatedAt: string; updatedBy: string | null }>;
}

const MAX_RUNS = 2000;
const MAX_SNAPSHOTS = 5000;

/**
 * In-memory AppStore with optional JSON persistence (APP_STORE_FILE). Used in mock mode,
 * tests and local development so the snapshot pipeline works with no database.
 * Not for production: a single-process store cannot coordinate multiple workers.
 */
export class MemoryAppStore implements AppStore {
  private state: State = { jobs: [], runs: [], snapshots: [], sprintWindows: [], operators: [], settings: {} };
  private lastLoadedMtime = -1;

  constructor(private readonly file?: string) {
    this.load();
  }

  /**
   * With a file configured, the file is the source of truth: re-read when it changed on disk so
   * the web process and the worker (and separately bundled Next routes) see each other's writes.
   */
  private load() {
    if (!this.file || !existsSync(this.file)) return;
    try {
      const mtime = statSync(this.file).mtimeMs;
      if (mtime === this.lastLoadedMtime) return;
      this.state = revive(JSON.parse(readFileSync(this.file, "utf8")));
      this.lastLoadedMtime = mtime;
    } catch {
      /* keep current state; a partially written file is retried on the next call */
    }
  }

  private persist() {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.state));
    renameSync(tmp, this.file);
    this.lastLoadedMtime = statSync(this.file).mtimeMs;
  }

  async listJobs() {
    this.load();
    return [...this.state.jobs];
  }
  async getJob(key: JobKey) {
    this.load();
    return this.state.jobs.find((j) => j.key === key) ?? null;
  }
  async upsertJob(job: JobDefinitionRecord) {
    this.load();
    const i = this.state.jobs.findIndex((j) => j.key === job.key);
    if (i >= 0) this.state.jobs[i] = { ...this.state.jobs[i], ...job, lockedAt: this.state.jobs[i].lockedAt, lockedBy: this.state.jobs[i].lockedBy };
    else this.state.jobs.push(job);
    this.persist();
  }
  async tryLockJob(key: JobKey, owner: string, now: Date, staleAfterMs: number) {
    this.load();
    const job = this.state.jobs.find((j) => j.key === key);
    if (!job) return false;
    const held = job.lockedAt !== null && now.getTime() - job.lockedAt.getTime() < staleAfterMs;
    if (held && job.lockedBy !== owner) return false;
    job.lockedAt = now;
    job.lockedBy = owner;
    this.persist();
    return true;
  }
  async unlockJob(key: JobKey, owner: string) {
    this.load();
    const job = this.state.jobs.find((j) => j.key === key);
    if (job && job.lockedBy === owner) {
      job.lockedAt = null;
      job.lockedBy = null;
      this.persist();
    }
  }

  async createRun(run: JobRunRecord) {
    this.load();
    this.state.runs.push(run);
    if (this.state.runs.length > MAX_RUNS) this.state.runs.splice(0, this.state.runs.length - MAX_RUNS);
    this.persist();
  }
  async finishRun(id: string, patch: Pick<JobRunRecord, "status" | "finishedAt" | "durationMs" | "rowsProcessed" | "errorSummary">) {
    this.load();
    const run = this.state.runs.find((r) => r.id === id);
    if (run) Object.assign(run, patch);
    this.persist();
  }
  async listRuns(jobKey?: JobKey, limit = 50) {
    this.load();
    return this.state.runs
      .filter((r) => !jobKey || r.jobKey === jobKey)
      .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
      .slice(0, limit);
  }

  async saveSnapshot(snapshot: SnapshotRecord) {
    this.load();
    this.state.snapshots.push(snapshot);
    if (this.state.snapshots.length > MAX_SNAPSHOTS) this.state.snapshots.splice(0, this.state.snapshots.length - MAX_SNAPSHOTS);
    this.persist();
  }
  async latestSnapshot<T>(family: MetricFamily) {
    this.load();
    // Ties break towards the most recently written row: with an injected clock (tests, a paused
    // scheduler) two captures can share a timestamp, and the newer one is the right answer.
    let latest: SnapshotRecord | null = null;
    for (const s of this.state.snapshots) if (s.metricFamily === family && (latest === null || s.capturedAt.getTime() >= latest.capturedAt.getTime())) latest = s;
    return (latest as SnapshotRecord<T> | null) ?? null;
  }
  async previousSnapshot<T>(family: MetricFamily, before: Date) {
    this.load();
    const rows = this.state.snapshots
      .filter((s) => s.metricFamily === family && s.capturedAt.getTime() < before.getTime())
      .sort((a, b) => b.capturedAt.getTime() - a.capturedAt.getTime());
    return (rows[0] as SnapshotRecord<T> | undefined) ?? null;
  }

  /** Newest snapshot per termKey (the sprint overlay's archive). */
  async latestSnapshotsByTerm<T>(family: MetricFamily, limit = 12) {
    this.load();
    const byTerm = new Map<string, SnapshotRecord>();
    for (const s of this.state.snapshots.filter((s) => s.metricFamily === family)) {
      const key = s.termKey ?? "";
      const seen = byTerm.get(key);
      if (!seen || s.capturedAt.getTime() >= seen.capturedAt.getTime()) byTerm.set(key, s);
    }
    return [...byTerm.values()].sort((a, b) => b.capturedAt.getTime() - a.capturedAt.getTime()).slice(0, limit) as SnapshotRecord<T>[];
  }

  async listSprintWindows() {
    this.load();
    return [...this.state.sprintWindows].sort((a, b) => b.start.localeCompare(a.start));
  }
  async getSprintWindow(termKey: string) {
    this.load();
    return this.state.sprintWindows.find((w) => w.termKey === termKey) ?? null;
  }
  async setSprintWindow(termKey: string, start: string, end: string, updatedBy: string | null) {
    this.load();
    const row: SprintWindowRecord = { termKey, start, end, updatedAt: new Date(), updatedBy };
    const i = this.state.sprintWindows.findIndex((w) => w.termKey === termKey);
    if (i >= 0) this.state.sprintWindows[i] = row;
    else this.state.sprintWindows.push(row);
    this.persist();
  }

  async listOperatorProfiles() {
    this.load();
    return [...this.state.operators].sort((a, b) => a.sourceCode.localeCompare(b.sourceCode) || (a.effectiveFrom ?? "").localeCompare(b.effectiveFrom ?? ""));
  }
  async upsertOperatorProfile(record: OperatorProfileRecord) {
    this.load();
    const i = this.state.operators.findIndex((o) => o.id === record.id || (o.sourceCode === record.sourceCode && o.effectiveFrom === record.effectiveFrom));
    if (i >= 0) this.state.operators[i] = { ...record, id: this.state.operators[i].id };
    else this.state.operators.push(record);
    this.persist();
  }

  async getSetting<T>(key: string) {
    this.load();
    return (this.state.settings[key]?.value as T | undefined) ?? null;
  }
  async setSetting<T>(key: string, value: T, updatedBy: string | null) {
    this.load();
    this.state.settings[key] = { value, updatedAt: new Date().toISOString(), updatedBy };
    this.persist();
  }
}

/** JSON round-trip loses Date objects; restore them. */
function revive(raw: State): State {
  const d = (v: unknown) => (typeof v === "string" ? new Date(v) : (v as Date | null));
  return {
    jobs: (raw.jobs ?? []).map((j) => ({ ...j, lockedAt: d(j.lockedAt) })),
    runs: (raw.runs ?? []).map((r) => ({ ...r, startedAt: d(r.startedAt)!, finishedAt: d(r.finishedAt) })),
    snapshots: (raw.snapshots ?? []).map((s) => ({ ...s, capturedAt: d(s.capturedAt)! })),
    sprintWindows: (raw.sprintWindows ?? []).map((w) => ({ ...w, updatedAt: d(w.updatedAt)! })),
    operators: (raw.operators ?? []).map((o) => ({ ...o, updatedAt: d(o.updatedAt)! })),
    settings: raw.settings ?? {},
  };
}
