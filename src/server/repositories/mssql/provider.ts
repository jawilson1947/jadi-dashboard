import { getSourcePool, sql } from "../../db/mssql";
import type {
  ChargesCredits,
  ClassificationCounts,
  ClearanceByDateRow,
  ClearanceByOperatorRow,
  DataProvider,
  DateRange,
  DnrDncRow,
  GlobalBalances,
  ReceivableByTermRow,
  SprintStudentFilter,
  DnrDncSummary,
  DrillDownPopulation,
  EnrollmentClearance,
  Page,
  PageRequest,
  ReceivableSummary,
  SourceInfo,
  StudentBio,
  StudentRow,
  StudentSearchQuery,
  StudentSearchRow,
  StudentKey,
  TermKey,
  TermMetadata,
  TransactionRow,
  TransactionScope,
  WorksheetItemRow,
  CostAnalysisRow,
} from "../types";
import { DataSourceUnavailableError, resolveTerms } from "../types";
import { parseCompactDate } from "@/lib/format";
import { escapeLike } from "@/lib/search";
import { Q } from "./sql";
import { QS } from "./student-sql";
import { getConfig } from "../../db/config";

/**
 * SQL Server DataProvider over ousadb (read-only login). Column names and semantics were
 * verified against staging on 2026-09-17 (docs/discovery/FINDINGS.md) and the definitions follow
 * ASSUMPTIONS A-1, A-2, A-16, A-19.
 *
 * Deliberate exclusions:
 *   - never selects tblStudent.SSN, dob, gender, BankAccount, or VIEW_OURM_FCA.PIN
 *   - never touches VIEW_OURM_ACAD or any linked-server view (Phase 5, after DBA confirmation)
 *   - never queries VIEW_OURM_FCA for aggregates (40–120 s); uses VIEW_OURM + tblStudent instead
 * All statements are parameterized; the SQL text lives in ./sql.ts.
 */
export class MssqlDataProvider implements DataProvider {
  readonly name = "mssql" as const;

  private async pool() {
    try {
      return await getSourcePool();
    } catch (err) {
      throw new DataSourceUnavailableError("Cannot connect to the source database.", err);
    }
  }

  async getSourceInfo(): Promise<SourceInfo> {
    await this.pool();
    return { provider: "mssql", capturedAt: new Date(), snapshotId: null };
  }

  async getTermMetadata(): Promise<TermMetadata[]> {
    const r = await (await this.pool()).request().query<RawTerm>(Q.terms);
    return r.recordset.map((t) => ({
      id: t.id,
      semesterName: t.SemesterName,
      tradName: t.JADI_TradName,
      leapName: t.JADI_LeapName,
      yearCode: String(t.JADI_YR_CDE),
      semesterBegins: new Date(t.SemesterBegins),
      semesterEnds: new Date(t.SemesterEnds),
      isCurrent: Boolean(t.isCurrent),
      wasCurrent: Boolean(t.wasCurrent),
      census: t.census === null ? null : Number(t.census),
      financiallyCleared: t.FinanciallyCleared === null ? null : Number(t.FinanciallyCleared),
      dropClassesDate: t.DropClassesDate ? new Date(t.DropClassesDate) : null,
      worksheetFolder: t.WorksheetFolder,
    }));
  }

  async getEnrollmentClearance(): Promise<EnrollmentClearance> {
    const pool = await this.pool();
    const [counts, nightly] = await Promise.all([
      pool.request().query<{ enrolled: number; notCleared: number; cleared: number; clearedNotEnrolled: number }>(Q.enrollmentClearance),
      pool.request().query<{ census: number | null; FinanciallyCleared: number | null }>(Q.nightlyFigures),
    ]);
    const c = last(counts);
    const n = nightly.recordset[0];
    return {
      enrolled: c.enrolled,
      cleared: c.cleared,
      notCleared: c.notCleared,
      clearedNotEnrolled: c.clearedNotEnrolled,
      nightly: n ? { census: n.census === null ? null : Number(n.census), financiallyCleared: n.FinanciallyCleared === null ? null : Number(n.FinanciallyCleared) } : null,
    };
  }

  async getCurrentReceivable(terms: TermKey[]): Promise<ReceivableSummary> {
    const [t1, t2] = [terms[0] ?? "", terms[1] ?? terms[0] ?? ""];
    const r = await (await this.pool()).request().input("t1", sql.VarChar(50), t1).input("t2", sql.VarChar(50), t2).query<{ total: number | null; studentCount: number }>(Q.currentReceivable);
    const row = r.recordset[0];
    return { total: money(row.total), studentCount: row.studentCount };
  }

  async getChargesCredits(): Promise<ChargesCredits> {
    const r = await (await this.pool()).request().query<{ charges: number | null; credits: number | null; afterDropDate: number }>(Q.chargesCredits);
    const row = r.recordset[0];
    return { charges: money(row.charges), credits: money(row.credits), afterDropDate: Boolean(row.afterDropDate) };
  }

  async getDnrDncSummary(): Promise<DnrDncSummary> {
    const r = await (await this.pool()).request().query<{ dncCount: number; dncBalance: number | null; dnrCount: number; dnrBalance: number | null; dnrGuardViolations: number }>(Q.dnrDncSummary);
    const row = last(r);
    return {
      dnc: { count: row.dncCount, positiveBalance: money(row.dncBalance) },
      dnr: { count: row.dnrCount, positiveBalance: money(row.dnrBalance) },
      dnrGuardViolations: row.dnrGuardViolations,
    };
  }

  async getClassificationCounts(range?: DateRange): Promise<ClassificationCounts> {
    const pool = await this.pool();
    const r = range
      ? await (await this.windowed(range)).query<ClassRow>(`${Q.sprintPrelude(true)}${Q.classificationCountsInRange}${Q.sprintEpilogue(true)}`)
      : await pool.request().query<ClassRow>(Q.classificationCounts);
    const enrolled = new Map<string, number>();
    const cleared = new Map<string, number>();
    for (const row of lastSet(r)) (row.kind === "enrolled" ? enrolled : cleared).set(row.code, Number(row.n));
    return { enrolled, cleared };
  }

  /** Spec §7.1 — one row per day inside the window that had a (deduped) clearance action. */
  async getClearanceByDate(range: DateRange): Promise<ClearanceByDateRow[]> {
    const r = await (await this.windowed(range)).query<{ d: Date | string; n: number }>(`${Q.sprintPrelude()}${Q.clearanceByDate}${Q.sprintEpilogue()}`);
    return lastSet(r).map((row) => ({ date: typeof row.d === "string" ? row.d.slice(0, 10) : row.d.toISOString().slice(0, 10), cleared: Number(row.n) }));
  }

  /** Spec §7.2 — per ClearedBy code, with first/last action inside the window. */
  async getClearanceByOperator(range: DateRange): Promise<ClearanceByOperatorRow[]> {
    const r = await (await this.windowed(range)).query<{ code: string; n: number; firstAt: Date | null; lastAt: Date | null }>(
      `${Q.sprintPrelude()}${Q.clearanceByOperator}${Q.sprintEpilogue()}`,
    );
    return lastSet(r).map((row) => ({
      operatorCode: row.code ?? "",
      cleared: Number(row.n),
      firstAt: row.firstAt ? new Date(row.firstAt) : null,
      lastAt: row.lastAt ? new Date(row.lastAt) : null,
    }));
  }

  async getSprintStudents(filter: SprintStudentFilter, page: PageRequest): Promise<Page<StudentRow>> {
    const clauses: string[] = [];
    if (filter.date) clauses.push(Q.sprintWhere.day);
    if (filter.operatorCode !== undefined) clauses.push(Q.sprintWhere.operator);
    if (filter.classificationCode) clauses.push(Q.sprintWhere.classification);
    const where = clauses.length ? clauses.join(" AND ") : Q.sprintWhere.all;
    const sortField = SPRINT_SORT_COLUMNS[page.sort?.field ?? "lastName"] ?? "S.lastname";
    const dir = page.sort?.direction === "desc" ? "DESC" : "ASC";

    const bind = async () => {
      const req = await this.windowed(filter.range);
      if (filter.date) req.input("day", sql.Date, utcDate(filter.date));
      if (filter.operatorCode !== undefined) req.input("operator", sql.VarChar(100), filter.operatorCode);
      if (filter.classificationCode) req.input("classification", sql.VarChar(10), filter.classificationCode);
      return req;
    };
    const [rows, count] = await Promise.all([
      bind().then((req) =>
        req
          .input("offset", sql.Int, (page.page - 1) * page.pageSize)
          .input("pageSize", sql.Int, page.pageSize)
          .query<RawStudent>(`${Q.sprintPrelude(true)}${Q.sprintStudentPage(where, sortField, dir)}${Q.sprintEpilogue(true)}`),
      ),
      bind().then((req) => req.query<{ n: number }>(`${Q.sprintPrelude(true)}${Q.sprintStudentCount(where)}${Q.sprintEpilogue(true)}`)),
    ]);
    return { rows: lastSet(rows).map(mapStudent), page: page.page, pageSize: page.pageSize, totalRows: last(count).n };
  }



  async getStudentsForPopulation(population: DrillDownPopulation, page: PageRequest): Promise<Page<StudentRow>> {
    const pool = await this.pool();
    const where = Q.populationWhere[population];
    const sortField = SORT_COLUMNS[page.sort?.field ?? "lastName"] ?? "S.lastname";
    const dir = page.sort?.direction === "desc" ? "DESC" : "ASC";
    const req = pool.request().input("offset", sql.Int, (page.page - 1) * page.pageSize).input("pageSize", sql.Int, page.pageSize);
    const [rows, count] = await Promise.all([
      req.query<RawStudent>(Q.studentPage(where, sortField, dir)),
      pool.request().query<{ n: number }>(Q.studentCount(where)),
    ]);
    return {
      rows: lastSet(rows).map(mapStudent),
      page: page.page,
      pageSize: page.pageSize,
      totalRows: last(count).n,
    };
  }

  /** A request with the sprint window bound; `@end` is an inclusive calendar date (the SQL adds the day). */
  private async windowed(range: DateRange): Promise<sql.Request> {
    return (await this.pool()).request().input("start", sql.Date, utcDate(range.start)).input("end", sql.Date, utcDate(range.end));
  }

  async getDnrDncPopulation(limit = 5000): Promise<DnrDncRow[]> {
    const r = await (await this.pool()).request().input("limit", sql.Int, limit).query<RawStudent & { category: "DNR" | "DNC" }>(Q.dnrDncPopulation);
    return lastSet(r).map((row) => ({ ...mapStudent(row), category: row.category }));
  }

  async getGlobalBalances(): Promise<GlobalBalances> {
    const r = await (await this.pool()).request().query<{ positiveTotal: number; positiveCount: number; negativeTotal: number; negativeCount: number; zeroCount: number }>(Q.globalBalances);
    const row = r.recordset[0];
    return {
      positiveTotal: money(row.positiveTotal),
      positiveCount: Number(row.positiveCount),
      negativeTotal: money(row.negativeTotal),
      negativeCount: Number(row.negativeCount),
      zeroCount: Number(row.zeroCount),
    };
  }

  async getReceivablesByTerm(): Promise<ReceivableByTermRow[]> {
    const r = await (await this.pool()).request().query<{ termKey: string; students: number; positiveBalance: number }>(Q.receivablesByTerm);
    return r.recordset.map((row) => ({ termKey: (row.termKey ?? "").trim(), students: Number(row.students), positiveBalance: money(row.positiveBalance) }));
  }

  /* ── Phase 5 — Student subsystem (Bio Spec; docs/STUDENT-PLAN.md) ── */

  async searchStudents(query: StudentSearchQuery): Promise<StudentSearchRow[]> {
    const req = (await this.pool()).request().input("limit", sql.Int, query.limit);
    if (query.by === "id") {
      const id = query.idnumber ?? "";
      const r = await req.input("id", sql.VarChar(50), id).input("idPrefix", sql.VarChar(60), `${escapeLike(id)}%`).query<RawSearch>(QS.searchById);
      return r.recordset.map(mapSearch);
    }
    // The service validated the terms; building (and escaping) the LIKE pattern belongs here, in the
    // only module that speaks SQL. ESCAPE '\\' in the statement makes a literal % or _ behave as text.
    const r = await req
      .input("last", sql.VarChar(120), `%${escapeLike(query.lastName ?? "")}%`)
      .input("first", sql.VarChar(120), query.firstName ? `%${escapeLike(query.firstName)}%` : null)
      .query<RawSearch>(QS.searchByName);
    return r.recordset.map(mapSearch);
  }

  async getStudentBio(id: StudentKey): Promise<StudentBio | null> {
    const r = await (await this.pool()).request().input("id", sql.VarChar(50), id).query<RawBio>(QS.bio);
    const row = r.recordset[0];
    if (!row) return null;
    return {
      ...mapSearch(row),
      middleName: row.midname,
      pid: String(row.pid),
      dob: row.dob ? new Date(row.dob).toISOString().slice(0, 10) : null,
      cnp: row.CNP === null || row.CNP === undefined ? null : money(row.CNP),
      address: { address: row.Address, city: row.City, stateCode: row.StateCode, zipCode: row.zipcode, country: row.Country },
      clearedOn: parseCompactDate(row.ClearedOn),
    };
  }

  /**
   * Bio Spec 2. `current` is the co-located jadi copy. `global` goes through the linked server that
   * A-24 flags as possibly production, so it is refused unless an operator has deliberately enabled
   * it — a missing flag is reported as an unavailable source, not silently returned as "no history".
   */
  async getStudentTransactions(id: StudentKey, scope: TransactionScope): Promise<TransactionRow[]> {
    const cfg = getConfig();
    if (scope === "global" && !cfg.TRANS_HIST_GLOBAL_ENABLED) {
      throw new DataSourceUnavailableError(
        "Global transaction history is not enabled: the linked server holding it has not been confirmed as non-production (ASSUMPTIONS A-24).",
      );
    }
    const text = scope === "global" ? QS.globalTransactions(cfg.TRANS_HIST_GLOBAL_SERVER) : QS.currentTermTransactions;
    const r = await (await this.pool()).request().input("id", sql.VarChar(50), id).query<RawTransaction>(text);
    return r.recordset.map(mapTransaction);
  }

  async getClearanceWorksheetItems(id: StudentKey, dropClassesDate: string): Promise<WorksheetItemRow[]> {
    const r = await (await this.pool())
      .request()
      .input("id", sql.VarChar(50), id)
      .input("dropDate", sql.Date, new Date(`${dropClassesDate}T00:00:00Z`))
      .query<RawWorksheetItem>(QS.worksheetItems);
    return lastSet(r).map((row) => ({
      description: row.TRANS_DESC ?? "",
      amount: money(row.TRANS_AMT),
      postedOn: row.TRANS_DTE ? new Date(row.TRANS_DTE).toISOString().slice(0, 10) : null,
      sourceCode: row.SOURCE_CDE ?? null,
    }));
  }

  async getCostAnalysis(id: StudentKey): Promise<CostAnalysisRow | null> {
    const r = await (await this.pool()).request().input("id", sql.VarChar(50), id).query<RawCostAnalysis>(QS.costAnalysis);
    const row = r.recordset[0];
    if (!row) return null;
    return { eighty: money(row.eighty), amtdue: money(row.amtdue), needed: money(row.needed), loan: money(row.loan), payment: money(row.payment) };
  }

  /** Convenience for tests/health: confirms the current/previous term rows resolve. */
  async checkTerms() {
    return resolveTerms(await this.getTermMetadata());
  }
}

/** Multi-statement batches (temp-table prelude) return their SELECT as the final recordset. */
function lastSet<T>(r: sql.IResult<T>): T[] {
  return r.recordsets.length ? (r.recordsets[r.recordsets.length - 1] as unknown as T[]) : r.recordset;
}
function last<T>(r: sql.IResult<T>): T {
  return lastSet(r)[0];
}

/** Whitelisted ORDER BY targets — never interpolate user input into SQL. */
const SORT_COLUMNS: Partial<Record<keyof StudentRow, string>> = {
  lastName: "S.lastname",
  firstName: "S.firstname",
  accountBalance: "S.AccountBalance",
  classificationCode: "S.cCode",
  status: "S.ClearedCurrentSession",
  idnumber: "S.idnumber",
  lastCleared: "S.LastCleared",
};

/** Sprint pages join #first as `f`, so the clearance timestamp sorts from there. */
const SPRINT_SORT_COLUMNS: Partial<Record<keyof StudentRow, string>> = { ...SORT_COLUMNS, clearedAt: "f.DateCleared", clearedBy: "f.ClearedBy" };

interface ClassRow {
  kind: "enrolled" | "cleared";
  code: string;
  n: number;
}

interface RawTerm {
  id: number; SemesterName: string; JADI_TradName: string; JADI_LeapName: string; JADI_YR_CDE: string;
  SemesterBegins: Date; SemesterEnds: Date; isCurrent: boolean; wasCurrent: boolean | null;
  census: number | null; FinanciallyCleared: number | null; DropClassesDate: Date | null; WorksheetFolder: string | null;
}

interface RawStudent {
  idnumber: string; lastname: string | null; firstname: string | null; midname: string | null; pid: number;
  email: string | null; cCode: string; isIncomingTransfer: number; ClearedCurrentSession: boolean | null;
  AccountBalance: number | null; LastCleared: string; ClearedBy: string | null; DateCleared: Date | null; enrolled: number;
}

interface RawSearch {
  idnumber: string; lastname: string | null; firstname: string | null; email: string | null; phone: string | null;
  LastCleared: string | null; AccountBalance: number | null; cCode: string | null; ClearedCurrentSession: boolean | null; enrolled: number;
}

interface RawBio extends RawSearch {
  midname: string | null; pid: number; dob: Date | string | null; CNP: number | null;
  Address: string | null; City: string | null; StateCode: string | null; zipcode: string | null; Country: string | null;
  ClearedOn: string | null;
}

interface RawTransaction {
  TRANS_DTE: Date | string | null; TRANS_DESC: string | null; TRANS_AMT: number | null; SOURCE_CDE: string | null;
}

/** Sp_GetFCWorksheetItems returns trans_hist-shaped rows; the alias documents where they come from. */
type RawWorksheetItem = RawTransaction;

interface RawCostAnalysis { eighty: number | null; amtdue: number | null; needed: number | null; loan: number | null; payment: number | null; }

function mapSearch(r: RawSearch): StudentSearchRow {
  const enrolledCurrentTerm = Boolean(r.enrolled);
  const clearedCurrentSession = Boolean(r.ClearedCurrentSession);
  return {
    idnumber: r.idnumber,
    lastName: r.lastname ?? "",
    firstName: r.firstname ?? "",
    email: r.email ?? "",
    phone: r.phone,
    lastCleared: r.LastCleared ?? null,
    accountBalance: money(r.AccountBalance),
    classificationCode: r.cCode ?? "",
    clearedCurrentSession,
    enrolledCurrentTerm,
    state: !enrolledCurrentTerm ? "not-enrolled" : clearedCurrentSession ? "cleared" : "not-cleared",
  };
}

function mapTransaction(r: RawTransaction): TransactionRow {
  return {
    postedOn: r.TRANS_DTE ? new Date(r.TRANS_DTE).toISOString().slice(0, 10) : "",
    description: (r.TRANS_DESC ?? "").trim(),
    amount: money(r.TRANS_AMT),
    sourceCode: (r.SOURCE_CDE ?? "").trim(),
  };
}

function mapStudent(r: RawStudent): StudentRow {
  return {
    idnumber: r.idnumber,
    lastName: r.lastname ?? "",
    firstName: r.firstname ?? "",
    middleName: r.midname,
    pid: String(r.pid),
    email: r.email ?? "",
    classificationCode: r.cCode ?? "",
    isIncomingTransfer: Boolean(r.isIncomingTransfer),
    status: r.ClearedCurrentSession ? "Cleared" : "Not Cleared",
    accountBalance: money(r.AccountBalance),
    lastCleared: r.LastCleared ?? null,
    clearedBy: r.ClearedBy,
    clearedAt: r.DateCleared ? new Date(r.DateCleared) : null,
    enrolledCurrentTerm: Boolean(r.enrolled),
  };
}

/**
 * Bind a calendar date as an explicit UTC-midnight Date. tedious writes `date` parameters from the
 * value's UTC components, so this sends exactly the day the administrator entered — never a string
 * whose interpretation would depend on the session's language or DATEFORMAT.
 */
function utcDate(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

/** SQL money/numeric arrive as JS numbers from tedious; normalise nulls and rounding. */
function money(v: number | string | null | undefined): number {
  if (v === null || v === undefined) return 0;
  return Math.round(Number(v) * 100) / 100;
}
