/**
 * AppStore — persistence for application-owned data (PLAN §4): jobs, job runs,
 * snapshots, settings. Two implementations:
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

export type MetricFamily = "enrollmentClearance" | "currentReceivable" | "dnrDnc" | "chargesCredits" | "clearanceBreakdown" | "terms";

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
  // settings
  getSetting<T = unknown>(key: string): Promise<T | null>;
  setSetting<T = unknown>(key: string, value: T, updatedBy: string | null): Promise<void>;
}
