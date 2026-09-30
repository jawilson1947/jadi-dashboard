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
  | "metadata.terms"
  // Phase 7a report snapshots (A-30). Each captures one report's population.
  | "report.unclassified"
  | "report.freshmanAnalysis"
  | "report.clearedMoreThanOnce"
  | "report.enrolleeBalance"
  | "report.currentlyCleared";

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
  | "terms"
  // Phase 7a (A-30). Unlike every family above, these payloads carry student IDs plus derived
  // codes — never names, emails, balances or PID, which the page joins live from dbo.tblStudent.
  | "reportUnclassified"
  | "reportFreshmanAnalysis"
  | "reportClearedMoreThanOnce"
  | "reportEnrolleeBalance"
  | "reportCurrentlyCleared";

/** The families whose payloads carry student identifiers (A-30) and are therefore pruned on refresh. */
export const STUDENT_LEVEL_FAMILIES: readonly MetricFamily[] = [
  "reportUnclassified",
  "reportFreshmanAnalysis",
  "reportClearedMoreThanOnce",
  "reportEnrolleeBalance",
  "reportCurrentlyCleared",
] as const;

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

/**
 * A student reclaimed from Jenzabar (STUDENT-RECLAIM-PLAN §4.3). Written by
 * dbo.usp_ReclaimStudentFromJenzabar inside the same transaction as the insert, so a reclaimed
 * record cannot exist without its log row. The app reads it to warn that a record is incomplete.
 */
export interface ReclaimedStudentRecord {
  idnumber: string;
  reclaimedAt: Date;
  reclaimedBy: string;
  hadNameRecord: boolean;
  hadBiograph: boolean;
  hadQualifyingAddress: boolean;
  source: string;
  resolvedAt: Date | null;
  resolvedBy: string | null;
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
  /**
   * Delete all but the newest `keep` snapshots of a family (A-30). Report families carry student
   * identifiers, so a refresh replaces rather than accumulates; aggregate families are never pruned.
   * Returns the number of snapshots removed.
   */
  pruneSnapshots(family: MetricFamily, keep: number): Promise<number>;
  // sprint windows (A-10)
  listSprintWindows(): Promise<SprintWindowRecord[]>;
  getSprintWindow(termKey: string): Promise<SprintWindowRecord | null>;
  setSprintWindow(termKey: string, start: string, end: string, updatedBy: string | null): Promise<void>;
  // operator profiles (§7.2)
  listOperatorProfiles(): Promise<OperatorProfileRecord[]>;
  /** An update carrying a known `id` may change `effectiveFrom`; without one the row is keyed on (code, from). */
  upsertOperatorProfile(record: OperatorProfileRecord): Promise<void>;
  /** Returns false when no profile has that id — a delete of something already gone is not an error. */
  deleteOperatorProfile(id: string): Promise<boolean>;
  // reclaimed students (A-32)
  /** Null when the student was not reclaimed by this application — the normal case. */
  getReclaimedStudent(idnumber: string): Promise<ReclaimedStudentRecord | null>;
  /** Open reclaims (gaps not yet filled), newest first — the follow-up worklist. */
  listReclaimedStudents(onlyUnresolved?: boolean, limit?: number): Promise<ReclaimedStudentRecord[]>;
  /**
   * Fallback used only when the stored procedure could not write the row itself (an older
   * procedure, or a store that is not the ousadb dash schema). Never the primary path.
   */
  recordReclaimedStudent(record: ReclaimedStudentRecord): Promise<void>;

  // settings
  getSetting<T = unknown>(key: string): Promise<T | null>;
  setSetting<T = unknown>(key: string, value: T, updatedBy: string | null): Promise<void>;
}
