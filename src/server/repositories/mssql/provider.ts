import { getSourcePool, sql } from "../../db/mssql";
import type {
  ChargesCredits,
  ClassificationCounts,
  DataProvider,
  DnrDncSummary,
  DrillDownPopulation,
  EnrollmentClearance,
  Page,
  PageRequest,
  ReceivableSummary,
  SourceInfo,
  StudentRow,
  TermKey,
  TermMetadata,
} from "../types";
import { DataSourceUnavailableError, resolveTerms } from "../types";
import { Q } from "./sql";

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

  async getClassificationCounts(): Promise<ClassificationCounts> {
    const r = await (await this.pool()).request().query<{ kind: "enrolled" | "cleared"; code: string; n: number }>(Q.classificationCounts);
    const enrolled = new Map<string, number>();
    const cleared = new Map<string, number>();
    for (const row of lastSet(r)) (row.kind === "enrolled" ? enrolled : cleared).set(row.code, Number(row.n));
    return { enrolled, cleared };
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

/** SQL money/numeric arrive as JS numbers from tedious; normalise nulls and rounding. */
function money(v: number | string | null | undefined): number {
  if (v === null || v === undefined) return 0;
  return Math.round(Number(v) * 100) / 100;
}
