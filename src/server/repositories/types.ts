/**
 * DataProvider — the single seam between the application and the source data.
 *
 * Two implementations exist:
 *   - mock/   synthetic, deterministic data (default; no database required)
 *   - mssql/  read-only queries against ousadb (Phase 2+, fast objects only)
 *
 * All values are RAW TYPED values (numbers, Dates, strings). No formatting here —
 * currency, percentages and thousands separators are applied in src/lib/format.ts
 * (Spec §15). Monetary amounts are JS numbers in dollars (SQL money/numeric → number).
 *
 * Definitions below follow ASSUMPTIONS A-1, A-2, A-16 as decided 2026-09-17.
 */

/** Canonical semester key = tblOUSA.JADI_TradName, e.g. "FA2026"; LEAP = JADI_LeapName, e.g. "LF2026". */
export type TermKey = string;

/** Canonical student key — tblStudent.idnumber (varchar). */
export type StudentKey = string;

/** FCA Status has exactly two values (CASE ClearedCurrentSession WHEN 1 ...). */
export type ClearanceStatus = "Cleared" | "Not Cleared";

/**
 * One tblOUSA row (institutional semester metadata — not student data).
 * `isCurrent` / `wasCurrent` mark the current and previous semester.
 * `census` / `financiallyCleared` are the nightly 9 pm captures of the two live metrics (A-2).
 */
export interface TermMetadata {
  id: number;
  semesterName: string; // "Fall 2026"
  tradName: TermKey; // "FA2026"
  leapName: TermKey; // "LF2026"
  yearCode: string; // JADI_YR_CDE
  semesterBegins: Date;
  semesterEnds: Date;
  isCurrent: boolean;
  wasCurrent: boolean;
  census: number | null;
  financiallyCleared: number | null;
  dropClassesDate: Date | null;
  worksheetFolder: string | null;
}

export interface StudentRow {
  idnumber: StudentKey;
  lastName: string;
  firstName: string;
  middleName: string | null;
  /** tblStudent.pid — masked by the service layer before it reaches the UI (A-3). */
  pid: string;
  email: string;
  /** Raw class code (tblStudent.cCode / STATS.Class): FR, FF, SO, JR, SR, GR, AE, AD, EM, DI, XX, blank. */
  classificationCode: string;
  /** TEL_WEB_GRP_CDE = 22 — "Incoming Transfer" (A-19). */
  isIncomingTransfer: boolean;
  status: ClearanceStatus;
  /** tblStudent.AccountBalance. Positive = owes; negative = credit balance. */
  accountBalance: number;
  /** tblStudent.LastCleared — the term the record was last rolled to (A-1). */
  lastCleared: TermKey | null;
  /** VIEW_OURM_STATS.ClearedBy ("sa" = automatic) — null when no clearance action this term. */
  clearedBy: string | null;
  clearedAt: Date | null;
  /** Present in VIEW_OURM (registered for the current term). */
  enrolledCurrentTerm: boolean;
}

/** Hero-card figures per A-2. */
export interface EnrollmentClearance {
  /** COUNT(*) FROM VIEW_OURM_FCA (≡ VIEW_OURM). */
  enrolled: number;
  /** COUNT(DISTINCT idnumber) FROM VIEW_OURM_STATS. */
  cleared: number;
  /** COUNT(*) FROM VIEW_OURM_FCA WHERE Status <> 'Cleared'. */
  notCleared: number;
  /** Students with a clearance action this term who are NOT in current enrollment (reconciliation line). */
  clearedNotEnrolled: number;
  /** Nightly figures from tblOUSA for the current row, when available. */
  nightly: { census: number | null; financiallyCleared: number | null } | null;
}

export interface ReceivableSummary {
  total: number;
  studentCount: number;
}

export interface ChargesCredits {
  charges: number;
  credits: number;
  /** 'yes' when the views read the frozen post-drop-date copy (tblFCA_TRANS_HIST). */
  afterDropDate: boolean;
}

/** DNC/DNR per A-1: positive balance is part of the definition. */
export interface DnrDncSummary {
  dnc: { count: number; positiveBalance: number };
  dnr: { count: number; positiveBalance: number };
  /** DNR students that ARE present in current enrollment — guard count, expected 0. */
  dnrGuardViolations: number;
}

export type DrillDownPopulation = "enrolled" | "cleared" | "notCleared" | "receivable" | "dnc" | "dnr";

export interface PageRequest {
  page: number;
  pageSize: number;
  sort?: { field: keyof StudentRow; direction: "asc" | "desc" };
}

export interface Page<T> {
  rows: T[];
  page: number;
  pageSize: number;
  totalRows: number;
}

/** Metadata about a live read from the source (snapshots carry their own capturedAt). */
export interface SourceInfo {
  provider: "mock" | "mssql";
  capturedAt: Date;
  snapshotId: string | null;
}

/** Raw per-code counts for the Clearance Breakdown (Spec §7.3); the service builds rows with buildBreakdown(). */
export interface ClassificationCounts {
  /** bucket code (after Incoming Transfer / FF→FR / blank→XX mapping) → count */
  enrolled: Map<string, number>;
  cleared: Map<string, number>;
}

export interface DataProvider {
  readonly name: SourceInfo["provider"];
  getSourceInfo(): Promise<SourceInfo>;
  /** All tblOUSA rows. */
  getTermMetadata(): Promise<TermMetadata[]>;
  getEnrollmentClearance(): Promise<EnrollmentClearance>;
  getCurrentReceivable(terms: TermKey[]): Promise<ReceivableSummary>;
  getChargesCredits(): Promise<ChargesCredits>;
  getDnrDncSummary(): Promise<DnrDncSummary>;
  getClassificationCounts(): Promise<ClassificationCounts>;
  getStudentsForPopulation(population: DrillDownPopulation, page: PageRequest): Promise<Page<StudentRow>>;
}

/** Thrown by a provider when the underlying source cannot be reached or is misconfigured. */
export class DataSourceUnavailableError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "DataSourceUnavailableError";
  }
}

/** Resolve current/previous term keys from metadata (single source of truth, Spec §15). */
export function resolveTerms(meta: TermMetadata[]): {
  current: TermMetadata;
  previous: TermMetadata;
  currentKeys: TermKey[];
  previousKeys: TermKey[];
} {
  const currents = meta.filter((m) => m.isCurrent);
  const previouses = meta.filter((m) => m.wasCurrent);
  if (currents.length !== 1) throw new Error(`tblOUSA must have exactly one isCurrent row (found ${currents.length})`);
  if (previouses.length !== 1) throw new Error(`tblOUSA must have exactly one wasCurrent row (found ${previouses.length})`);
  return {
    current: currents[0],
    previous: previouses[0],
    currentKeys: [currents[0].tradName, currents[0].leapName],
    previousKeys: [previouses[0].tradName, previouses[0].leapName],
  };
}
