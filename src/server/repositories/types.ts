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

/** DNR/DNC category (Spec §8). A student belongs to exactly one: the rules are mutually exclusive (A-1). */
export type DnrDncCategory = "DNR" | "DNC";

/**
 * One row of the DNR/DNC population (Spec §8). It is the same StudentRow the drill-downs use, plus the
 * category the A-1 rule assigned. The population is bounded — A-1 includes `AccountBalance > 0`, so it is
 * in the low hundreds — which is why the provider returns it whole and the service filters, sorts,
 * paginates and totals it in one place: the table, the footer total and the export cannot disagree.
 */
export interface DnrDncRow extends StudentRow {
  category: DnrDncCategory;
}

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

/**
 * Inclusive calendar-date window in the institution timezone (ASSUMPTIONS A-10).
 * Providers translate it to their own boundary: SQL `>= start AND < end + 1 day`, mock `toIsoDate()`.
 */
export interface DateRange {
  start: string; // YYYY-MM-DD
  end: string; // YYYY-MM-DD
}

/** One day of the sprint (Spec §7.1). Days with no clearance actions are filled in by the service. */
export interface ClearanceByDateRow {
  date: string; // YYYY-MM-DD
  cleared: number;
}

/** One ClearedBy code in the window (Spec §7.2). Names are resolved from OperatorProfile by the service. */
export interface ClearanceByOperatorRow {
  operatorCode: string;
  cleared: number;
  firstAt: Date | null;
  lastAt: Date | null;
}

/** Drill-down selector for sprint tables: a day, an operator, or a classification bucket within the window. */
export interface SprintStudentFilter {
  range: DateRange;
  date?: string;
  operatorCode?: string;
  /** Bucket code after A-19 / FF→FR / blank→XX mapping, as produced by breakdownCode(). */
  classificationCode?: string;
}

/** Raw per-code counts for the Clearance Breakdown (Spec §7.3); the service builds rows with buildBreakdown(). */
export interface ClassificationCounts {
  /** bucket code (after Incoming Transfer / FF→FR / blank→XX mapping) → count */
  enrolled: Map<string, number>;
  cleared: Map<string, number>;
}

/**
 * Spec §9.2. Totals over every row of tblStudent — the authoritative balance column (A-18).
 * Field names describe the SQL predicate; on screen and in exports these are **debit balances**
 * (positive) and **credit balances** (negative) — the terminology set in A-5.
 */
export interface GlobalBalances {
  positiveTotal: number;
  positiveCount: number;
  /** Absolute value of the negative total. Secondary figure only, never netted (A-5). */
  negativeTotal: number;
  negativeCount: number;
  zeroCount: number;
}

/** Spec §9.3: debit balances grouped by the term code in tblStudent.LastCleared (A-22, A-5). */
export interface ReceivableByTermRow {
  /** Raw term code, resolved to a semester by the service. */
  termKey: string;
  students: number;
  positiveBalance: number;
}

/* ─────────────────────────── Phase 5 — Student subsystem (Bio Spec) ─────────────────────────── */

/**
 * Bio Spec 1.1-1.2. Exactly two shapes of search; both are bounded and neither accepts a bare
 * wildcard. The provider receives already-validated values — escaping of LIKE metacharacters
 * happens in the service, so no provider can forget it.
 */
export interface StudentSearchQuery {
  by: "name" | "id";
  lastName?: string;
  firstName?: string;
  idnumber?: string;
  limit: number;
}

/**
 * Row state behind the search-result icon (Bio Spec 1.3 `icon`). Derived, never stored.
 *
 * `ClearedCurrentSession` is a flag ON the `LastCleared` term, not on today's term (J. Wilson,
 * 2026-09-24 — the column name is misleading). So the flag alone does not mean a student is cleared
 * now: it means they were cleared for whatever semester `LastCleared` names. `cleared-prior` is that
 * case, and it is kept distinct from `cleared` rather than folded into it or into `not-cleared`,
 * because "cleared, but for a semester that has passed" is a different fact from either.
 *
 * Derivation needs the current term, which providers do not have, so it happens in
 * src/server/services/students.ts and nowhere else.
 */
export type StudentSearchState = "cleared" | "cleared-prior" | "not-cleared" | "not-enrolled";

/** Bio Spec 1.3 recordset. `[ID]` in the spec is the row key; `icon` is `state` rendered. */
export interface StudentSearchRow {
  idnumber: StudentKey;
  lastName: string;
  firstName: string;
  email: string;
  phone: string | null;
  lastCleared: TermKey | null;
  accountBalance: number;
  classificationCode: string;
  /** Cleared FOR the `lastCleared` semester — not necessarily for the current one. */
  clearedCurrentSession: boolean;
  enrolledCurrentTerm: boolean;
}

export interface PostalAddress {
  address: string | null;
  city: string | null;
  stateCode: string | null;
  zipCode: string | null;
  country: string | null;
}

/**
 * Bio Spec 1.3 data form. Providers return RAW values; masking of `dob` (A-29) and of
 * `pid` (A-3) is applied in src/server/services/students.ts before anything leaves the server, so an
 * unprivileged response never carries the real value at all.
 */
export interface StudentBio extends StudentSearchRow {
  middleName: string | null;
  pid: string;
  /** ISO date (YYYY-MM-DD) or null. The only masked field on this card (A-29). */
  dob: string | null;
  /**
   * tblStudent.CNP — "Credits Not Posted" (J. Wilson, 2026-09-24): aid or payments awarded but not
   * yet applied to the account. A `money` column, NOT an identifier, so it is never masked.
   */
  cnp: number | null;
  address: PostalAddress;
  /** tblStudent.ClearedOn, stored YYYYMMDD; parsed to ISO by the provider. */
  clearedOn: string | null;
  /**
   * The column's raw text when it held something the YYYYMMDD rule could not parse. A varchar date
   * column will eventually hold a surprise, and a silently blank field is the worst way to find out:
   * the card shows the raw value and says it was not recognised.
   */
  clearedOnRaw: string | null;
}

/** One trans_hist row. `sourceCode` is raw; labels come from Setting.transactionSourceLabels (A-28). */
export interface TransactionRow {
  postedOn: string; // ISO date
  description: string;
  /** TRANS_AMT. Negative = credit (money in the student's favour), positive = debit (A-5). */
  amount: number;
  sourceCode: string;
}

/** Which trans_hist source a transaction request targets (A-24, D-1). */
export type TransactionScope = "current" | "global";

/** Bio Spec 1.5.1 — one row of the Sp_GetFCWorksheetItems recordset. */
export interface WorksheetItemRow {
  description: string;
  amount: number;
  postedOn: string | null;
  sourceCode: string | null;
}

/**
 * The five figures dbo.fn_CostAnalysis returns for one student (A-8, D-2), plus the two inputs it
 * was given. The inputs travel with the answer deliberately: "you must pay $X to clear" is a number
 * somebody will be asked to justify, and the charges and credits it came from are the justification.
 */
export interface CostAnalysisRow {
  /** 80% of charges ('S'). */
  eighty: number;
  /** Balance + (charges − credits) ('T'). */
  amtdue: number;
  /** Amount needed to clear ('D'). */
  needed: number;
  /** Remainder financed ('L'), and that loan divided by five ('P'). */
  loan: number;
  payment: number;
  charges: number;
  credits: number;
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
  /**
   * Enrolled/cleared counts per classification bucket. Without a range this is the whole term
   * (the dashboard card); with one, only clearance actions inside the window count as cleared
   * (the sprint's By Classification tab) — enrolled is always current enrollment.
   */
  getClassificationCounts(range?: DateRange): Promise<ClassificationCounts>;
  /** Clearance actions per calendar date inside the window (Spec §7.1). Sparse: only days with actions. */
  getClearanceByDate(range: DateRange): Promise<ClearanceByDateRow[]>;
  /** Clearance actions per ClearedBy code inside the window (Spec §7.2). */
  getClearanceByOperator(range: DateRange): Promise<ClearanceByOperatorRow[]>;
  getStudentsForPopulation(population: DrillDownPopulation, page: PageRequest): Promise<Page<StudentRow>>;
  /**
   * The whole positive-balance DNR/DNC population (Spec §8), both categories, unsorted.
   * `limit` is a safety cap: if the source ever returns more, the caller is told rather than
   * silently shown a truncated total.
   */
  getDnrDncPopulation(limit?: number): Promise<DnrDncRow[]>;
  /** Spec §9.2 — global positive and negative totals over tblStudent (A-18). */
  getGlobalBalances(): Promise<GlobalBalances>;
  /** Spec §9.3 — positive balances grouped by LastCleared, one row per term code including the sentinel. */
  getReceivablesByTerm(): Promise<ReceivableByTermRow[]>;
  /** Students behind a sprint cell — a day, an operator, or a classification (Spec §7.1–7.3 drill-downs). */
  getSprintStudents(filter: SprintStudentFilter, page: PageRequest): Promise<Page<StudentRow>>;

  /* ── Phase 5 — Student subsystem (Bio Spec) ── */
  /** Bio Spec 1.1–1.2. Bounded by `limit`; the service has already validated and escaped the terms. */
  searchStudents(query: StudentSearchQuery): Promise<StudentSearchRow[]>;
  /** Bio Spec 1.3. Raw values — the service masks dob and pid before responding (A-3, A-29). */
  getStudentBio(id: StudentKey): Promise<StudentBio | null>;
  /**
   * Bio Spec 2. `current` reads the co-located jadi.dbo.trans_hist; `global` reads the TMSEPRD
   * linked server and throws DataSourceUnavailableError until A-24 is confirmed and the path is
   * explicitly enabled. Newest first; the service groups by year and paginates (Bio Spec 2.1).
   */
  getStudentTransactions(id: StudentKey, scope: TransactionScope): Promise<TransactionRow[]>;
  /** Bio Spec 1.5.1 — EXEC dbo.Sp_GetFCWorksheetItems @ID_NUM, @DropClassesDate. */
  getClearanceWorksheetItems(id: StudentKey, dropClassesDate: string): Promise<WorksheetItemRow[]>;
  /** A-8 / D-2 — dbo.fn_CostAnalysis for one student; null when the student has no row. */
  getCostAnalysis(id: StudentKey): Promise<CostAnalysisRow | null>;
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
