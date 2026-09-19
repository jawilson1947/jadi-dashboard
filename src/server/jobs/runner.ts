import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { getConfig } from "../db/config";
import { getDataProvider } from "../repositories";
import type { DataProvider } from "../repositories/types";
import { getAppStore } from "../store";
import type { AppStore, JobKey, JobRunRecord } from "../store/types";
import { getJobDefinition, JOB_DEFINITIONS, toRecord } from "./definitions";

/** A lock older than this is considered abandoned (crashed worker) and may be taken over. */
const LOCK_STALE_MS = 30 * 60_000;

export function workerId(): string {
  return getConfig().WORKER_ID ?? `${hostname()}:${process.pid}`;
}

/** Seed job rows that do not exist yet; never overwrites admin-edited schedules. */
export async function ensureJobsSeeded(store: AppStore = getAppStore()): Promise<void> {
  const existing = new Set((await store.listJobs()).map((j) => j.key));
  for (const def of JOB_DEFINITIONS) if (!existing.has(def.key)) await store.upsertJob(toRecord(def));
}

export interface RunOptions {
  triggeredBy: string; // "schedule" | "manual:<userId>" | "startup"
  store?: AppStore;
  provider?: DataProvider;
  now?: () => Date;
  owner?: string;
  /** Manual runs may bypass the minimum-interval check but never the overlap lock. */
  ignoreMinInterval?: boolean;
}

/**
 * Runs one job through the audited pipeline (Spec §14.6):
 *   lock → create RUNNING run → read source → save snapshot → SUCCEEDED/FAILED → unlock.
 * A second worker (or a manual trigger during a scheduled run) records SKIPPED_OVERLAP instead of running.
 * Errors are captured as a safe summary; SQL text and connection details never reach the record.
 */
export async function runJob(key: JobKey, opts: RunOptions): Promise<JobRunRecord> {
  const store = opts.store ?? getAppStore();
  const provider = opts.provider ?? getDataProvider();
  const now = opts.now ?? (() => new Date());
  const owner = opts.owner ?? workerId();
  const def = getJobDefinition(key);
  let job = await store.getJob(key);
  if (!job) {
    job = toRecord(def);
    await store.upsertJob(job);
  }

  const startedAt = now();
  const run: JobRunRecord = { id: randomUUID(), jobKey: key, status: "RUNNING", triggeredBy: opts.triggeredBy, startedAt, finishedAt: null, durationMs: null, rowsProcessed: null, errorSummary: null };

  if (!opts.ignoreMinInterval) {
    const [last] = await store.listRuns(key, 1);
    if (last && last.status === "SUCCEEDED" && startedAt.getTime() - last.startedAt.getTime() < job.minIntervalMinutes * 60_000) {
      const skipped = { ...run, status: "SKIPPED_OVERLAP" as const, finishedAt: startedAt, durationMs: 0, errorSummary: `Skipped: last successful run was less than ${job.minIntervalMinutes} minutes ago.` };
      await store.createRun(skipped);
      return skipped;
    }
  }

  const locked = await store.tryLockJob(key, owner, startedAt, LOCK_STALE_MS);
  if (!locked) {
    const skipped = { ...run, status: "SKIPPED_OVERLAP" as const, finishedAt: startedAt, durationMs: 0, errorSummary: "Skipped: another run of this job is in progress." };
    await store.createRun(skipped);
    return skipped;
  }

  await store.createRun(run);
  try {
    const result = await def.run(provider, store);
    const capturedAt = now();
    await store.saveSnapshot({
      id: randomUUID(),
      jobRunId: run.id,
      metricFamily: def.family,
      termKey: result.termKey,
      capturedAt,
      sourceProvider: provider.name,
      payload: result.payload,
      rowCount: result.rowCount,
    });
    const finished = { status: "SUCCEEDED" as const, finishedAt: capturedAt, durationMs: capturedAt.getTime() - startedAt.getTime(), rowsProcessed: result.rowCount, errorSummary: null };
    await store.finishRun(run.id, finished);
    return { ...run, ...finished };
  } catch (err) {
    const finishedAt = now();
    const finished = { status: "FAILED" as const, finishedAt, durationMs: finishedAt.getTime() - startedAt.getTime(), rowsProcessed: null, errorSummary: safeSummary(err) };
    await store.finishRun(run.id, finished);
    console.error(JSON.stringify({ level: "error", job: key, runId: run.id, message: finished.errorSummary }));
    return { ...run, ...finished };
  } finally {
    await store.unlockJob(key, owner);
  }
}

/** Strip anything that could carry SQL, hosts or credentials; keep a short, useful message. */
export function safeSummary(err: unknown): string {
  const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  return msg
    .replace(/(password|pwd)\s*=\s*[^;]+/gi, "$1=***")
    .replace(/(Server|Data Source)\s*=\s*[^;]+/gi, "$1=***")
    .replace(/\s+/g, " ")
    .slice(0, 500);
}
