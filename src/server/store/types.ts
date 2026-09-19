/**
 * AppStore — persistence for application-owned data (PLAN §4): jobs, job runs,
 * snapshots, settings, sprint windows and operator profiles. Two implementations:
 *   - memory/   in-process with optional JSON file persistence (dev, tests, mock mode)
 *   - mssql/    ousadb schema [dash] (db/migrations/*.sql), login jadi_dash — writes only inside [dash]
 * Writes only inside schema [dash]; jadi_dash is DENIED writes on dbo.
 */

export type JobKey =
  | "dashboard.enrollmentClearance"
  | "dashboard.currentReceivable"
  | "dashboard.dnrDnc"
  | "dashboard.chargesCredits"
  | "dashboard.clearanceBreakdown"
  | "sprint.daily"
  | "history.enrollmentClearance"
  | "history.globalBalances"
  | "history.receivablesBySemester"
  | "metadata.terms";

export interface JobDefinitionRecord {
  key: JobKey;
  name: string;
  cronExpression: string;
  isEnabled: boolean;
  /** Safe minimum between runs (Spec §14.6 "safe minimums"). */
  minIntervalMinutes: number;
  lockedAt: Date | null;
  lockedBy: string | null;
}

export type JobRunStatus = "RUNNING" | "SUCCEEDED" | "FAILED" | "SKIPPED_OVERLAP";

export interface JobRunRecord {
  id: string;
  jobKey: JobKey;
  status: JobRunStatus;
  /** "schedule" | "manual:<userId>" | "startup" */
  triggeredBy: string;
  startedAt: Date;
  finishedAt: Date | null;
  durationMs: number | null;
  rowsProcessed: number | null;
  /** Safe summary only — never SQL text, connection details or secrets. */
  errorSummary: string | null;
}

export type MetricFamily =
  | "enrollmentClearance"
  | "currentReceivable"
  | "dnrDnc"
  | "chargesCredits"
  | "clearanceBreakdown"
  | "sprintDaily"
  | "historyEnrollment"
  | "historyBalances"
  | "historyReceivables"
  | "terms";

export interface SnapshotRecord<T = unknown> {
  id: string;
  jobRunId: string;
  metricFamily: MetricFamily;
  /** Current term key at capture time (e.g. FA2026) so history never re-labels itself. */
  termKey: string | null;
  capturedAt: Date;
  sourceProvider: "mock" | "mssql";
  payload: T;
  rowCount: number | null;
}

/**
 * Admin-entered clearance sprint window (ASSUMPTIONS A-10). Dates are calendar dates in the
 * institution timezone, stored as YYYY-MM-DD — never timestamps, so a window does not shift
 * when the server's clock or offset changes. There is no computed default: a term without a
 * row here has no sprint.
 */
export interface SprintWindowRecord {
  termKey: string;
  start: string; // YYYY-MM-DD, inclusive
  end: string; // YYYY-MM-DD, inclusive
  updatedAt: Date;
  updatedBy: string | null;
}

/**
 * ClearedBy code → person (Spec §7.2). Effective dates let a reused code resolve to whoever held
 * it on the date of the clearance action; a row with both dates null is the open-ended mapping.
 */
export interface OperatorProfileRecord {
  id: string;
  sourceCode: string;
  displayName: string;
  email: string | null;
  department: string | null;
  isActive: boolean;
  /** "sa" — automatic clearance, not a person (Spec §10.5). */
  isSystem: boolean;
  effectiveFrom: string | null; // YYYY-MM-DD
  effectiveTo: string | null; // YYYY-MM-DD, inclusive
  updatedAt: Date;
  updatedBy: string | null;
}

export interface AppStore {
  // jobs
  listJobs(): Promise<JobDefinitionRecord[]>;
  getJob(key: JobKey): Promise<JobDefinitionRecord | null>;
  upsertJob(job: JobDefinitionRecord): Promise<void>;
  /** Atomically acquire the job lock; returns false if another worker holds a fresh lock. */
  tryLockJob(key: JobKey, owner: string, now: Date, staleAfterMs: number): Promise<boolean>;
  unlockJob(key: JobKey, owner: string): Promise<void>;
  // runs
  createRun(run: JobRunRecord): Promise<void>;
  finishRun(id: string, patch: Pick<JobRunRecord, "status" | "finishedAt" | "durationMs" | "rowsProcessed" | "errorSummary">): Promise<void>;
  listRuns(jobKey?: JobKey, limit?: number): Promise<JobRunRecord[]>;
  // snapshots
  saveSnapshot(snapshot: SnapshotRecord): Promise<void>;
  latestSnapshot<T = unknown>(family: MetricFamily): Promise<SnapshotRecord<T> | null>;
  /** Snapshot immediately preceding `before` for change-since-prior comparisons (Spec §6.1). */
  previousSnapshot<T = unknown>(family: MetricFamily, before: Date): Promise<SnapshotRecord<T> | null>;
  /** Latest snapshot of a family per term key, newest first — the archive the sprint overlay reads (Spec §7.4). */
  latestSnapshotsByTerm<T = unknown>(family: MetricFamily, limit?: number): Promise<SnapshotRecord<T>[]>;
  // sprint windows (A-10)
  listSprintWindows(): Promise<SprintWindowRecord[]>;
  getSprintWindow(termKey: string): Promise<SprintWindowRecord | null>;
  setSprintWindow(termKey: string, start: string, end: string, updatedBy: string | null): Promise<void>;
  // operator profiles (§7.2)
  listOperatorProfiles(): Promise<OperatorProfileRecord[]>;
  upsertOperatorProfile(record: OperatorProfileRecord): Promise<void>;
  // settings
  getSetting<T = unknown>(key: string): Promise<T | null>;
  setSetting<T = unknown>(key: string, value: T, updatedBy: string | null): Promise<void>;
}
