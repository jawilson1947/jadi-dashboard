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
  UnclassifiedRow,
  FreshmanAnalysisRow,
  ClearedActionRow,
  EnrolleeBalanceRow,
  CurrentlyClearedRow,
  StudentContactRow,
  ReclaimDiagnostic,
  ReclaimResult,
  ReclaimOutcome,
  SemesterUpdateResult,
  SemesterUpdateOutcome,
} from "../types";
import { DataSourceUnavailableError, resolveTerms } from "../types";
import { parseCompactDate } from "@/lib/format";
import { escapeLike } from "@/lib/search";
import { Q } from "./sql";
import { QS } from "./student-sql";
import { RQ } from "./report-sql";
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
/** How long the cross-server global history query may take before the card gives up (A-24). */
const GLOBAL_TIMEOUT_MS = 20_000;

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
      clearedOnRaw: parseCompactDate(row.ClearedOn) === null && (row.ClearedOn ?? "").trim() !== "" ? (row.ClearedOn ?? "").trim() : null,
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
    const req = (await this.pool()).request().input("id", sql.VarChar(50), id);

    /**
     * The global query crosses a linked server, so it can fail in ways a local query cannot: the
     * remote host may be unreachable, asleep, or on a subnet this server cannot route to. The pool's
     * 5-minute requestTimeout exists for background snapshot jobs and is far too long for a card on
     * a page someone is waiting in front of, so this one is cancelled after GLOBAL_TIMEOUT_MS.
     *
     * Any failure here is reported as DataSourceUnavailableError, which the profile page already
     * renders as an "unavailable" card. Previously a transport error (tedious RequestError, e.g.
     * "TCP Provider: The wait operation timed out") escaped that check and took down the whole
     * profile — reached most easily by a reclaimed student, whose LastCleared of 'XX0000' routes
     * them to the global card automatically.
     */
    if (scope === "global") {
      const timer = setTimeout(() => req.cancel(), GLOBAL_TIMEOUT_MS);
      try {
        const r = await req.query<RawTransaction>(text);
        return r.recordset.map(mapTransaction);
      } catch (err) {
        throw new DataSourceUnavailableError(
          `The global transaction archive did not respond within ${Math.round(GLOBAL_TIMEOUT_MS / 1000)}s. It is read through a linked server (ASSUMPTIONS A-24); check that the host is reachable from the SQL Server.`,
          err,
        );
      } finally {
        clearTimeout(timer);
      }
    }

    const r = await req.query<RawTransaction>(text);
    return r.recordset.map(mapTransaction);
  }

  async getClearanceWorksheetItems(id: StudentKey, dropClassesDate: string): Promise<WorksheetItemRow[]> {
    const r = await (await this.pool())
      .request()
      .input("id", sql.VarChar(50), id)
      .input("dropDate", sql.Date, new Date(`${dropClassesDate}T00:00:00Z`))
      .query<RawWorksheetItem>(QS.worksheetItems);
    const raw = lastNonEmptySet(r);
    const rows: WorksheetItemRow[] = raw.map((row) => ({
      description: row.TRANS_DESC ?? "",
      amount: money(row.TRANS_AMT),
      postedOn: row.TRANS_DTE ? new Date(row.TRANS_DTE).toISOString().slice(0, 10) : null,
      sourceCode: row.SOURCE_CDE ?? null,
      itemType: pickItemType(row),
    }));
    // If the procedure's item-type column is not where we looked, every row would silently count as
    // a debit. Say so once, with the column names it actually returned, rather than showing a wrong
    // net amount quietly.
    if (rows.length > 0 && rows.every((r) => r.itemType === null)) {
      console.warn(
        `[clearance] Sp_GetFCWorksheetItems returned no item-type column for ${id}; columns were: ${Object.keys(raw[0] ?? {}).join(", ")}`,
      );
    }
    return rows;
  }

  async getCostAnalysis(id: StudentKey): Promise<CostAnalysisRow | null> {
    try {
      const r = await (await this.pool()).request().input("id", sql.VarChar(50), id).query<RawCostAnalysis>(QS.costAnalysis);
      const row = r.recordset[0];
      if (!row) return null;
      return {
        eighty: money(row.eighty),
        amtdue: money(row.amtdue),
        needed: money(row.needed),
        loan: money(row.loan),
        payment: money(row.payment),
        charges: money(row.charges),
        credits: money(row.credits),
      };
    } catch (err) {
      // The rest of the clearance card — worksheet items, net amount, total monies due — is still
      // correct without this, and the card has an explicit "cannot be stated" state for exactly this
      // case. Returning null shows that state instead of replacing the whole page with an error.
      // The failure is logged rather than swallowed: a missing function is a deployment problem.
      console.error(JSON.stringify({ level: "error", msg: "fn_CostAnalysis unavailable", student: id, error: err instanceof Error ? err.message : String(err) }));
      return null;
    }
  }

  /** Convenience for tests/health: confirms the current/previous term rows resolve. */
  async checkTerms() {
    return resolveTerms(await this.getTermMetadata());
  }
  /* ── Phase 7a — Report populations (docs/REPORTS-PLAN.md) ── */

  async getUnclassifiedPopulation(): Promise<UnclassifiedRow[]> {
    const r = await (await this.pool()).request().query<RawUnclassified>(RQ.unclassified);
    return r.recordset.map((x) => ({
      idnumber: String(x.idnumber),
      classCode: x.classCode ?? "",
      resolvableAs: x.resolvableAs ?? "",
      status: x.status,
      source: x.source,
    }));
  }

  async getFreshmanAnalysis(): Promise<FreshmanAnalysisRow[]> {
    const r = await (await this.pool()).request().query<RawFreshman>(RQ.freshmanAnalysis);
    return r.recordset.map((x) => ({
      idnumber: String(x.idnumber),
      classCode: x.classCode ?? "",
      webCode: x.webCode ?? null,
      mostRecentYearEnrolled: text(x.mostRecentYearEnrolled),
      currentClassCode: x.currentClassCode ?? "",
      dateCreated: x.dateCreated ? new Date(x.dateCreated) : null,
      semesterBegins: x.semesterBegins ? new Date(x.semesterBegins) : null,
      derivedClass: x.derivedClass,
      mismatch: Boolean(x.mismatch),
    }));
  }

  async getClearedMoreThanOncePopulation(): Promise<ClearedActionRow[]> {
    const r = await (await this.pool()).request().query<RawClearedAction>(RQ.clearedMoreThanOnce);
    return r.recordset.map((x) => ({
      idnumber: String(x.idnumber),
      classCode: x.classCode ?? "",
      dateCleared: x.dateCleared ? new Date(x.dateCleared) : null,
      clearedBy: x.clearedBy ?? null,
      actionNo: Number(x.actionNo),
      actionCount: Number(x.actionCount),
    }));
  }

  async getEnrolleeBalancePopulation(): Promise<EnrolleeBalanceRow[]> {
    const r = await (await this.pool()).request().query<RawEnrolleeBalance>(RQ.enrolleeBalancePopulation);
    return r.recordset.map((x) => ({
      idnumber: String(x.idnumber),
      classCode: x.classCode ?? "",
      rawClassCode: x.rawClassCode ?? "",
    }));
  }

  async getCurrentlyClearedPopulation(): Promise<CurrentlyClearedRow[]> {
    const r = await (await this.pool()).request().query<RawCurrentlyCleared>(RQ.currentlyCleared);
    return r.recordset.map((x) => ({
      idnumber: String(x.idnumber),
      classCode: x.classCode ?? "",
      rawClassCode: x.rawClassCode ?? "",
      dateCleared: x.dateCleared ? new Date(x.dateCleared) : null,
    }));
  }

  /**
   * The live half of a report row (A-30). Ids are bound as individual parameters in batches rather
   * than interpolated into an IN list: the values come from a snapshot this application wrote, but
   * a parameterised query is the rule here regardless of how trustworthy the source looks today.
   */
  async getStudentContacts(ids: string[]): Promise<StudentContactRow[]> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return [];
    const out: StudentContactRow[] = [];
    const BATCH = 500;
    for (let i = 0; i < unique.length; i += BATCH) {
      const chunk = unique.slice(i, i + BATCH);
      const req = (await this.pool()).request();
      const names = chunk.map((id, n) => {
        req.input(`id${n}`, sql.VarChar(50), id);
        return `@id${n}`;
      });
      const r = await req.query<RawContact>(
        `SELECT idnumber, lastname, firstname, email, AccountBalance
         FROM dbo.tblStudent WHERE idnumber IN (${names.join(", ")});`,
      );
      for (const x of r.recordset) {
        out.push({
          idnumber: String(x.idnumber),
          lastName: x.lastname ?? "",
          firstName: x.firstname ?? "",
          email: text(x.email),
          accountBalance: money(x.AccountBalance),
        });
      }
    }
    return out;
  }


  /* ── Student reclaim (docs/STUDENT-RECLAIM-PLAN.md) ── */

  async getReclaimDiagnostic(id: StudentKey): Promise<ReclaimDiagnostic> {
    const r = await (await this.pool()).request().input("id", sql.VarChar(50), id).query<RawDiagnostic>(QS.reclaimDiagnostic);
    const x = r.recordset[0];
    if (!x) throw new DataSourceUnavailableError("The reclaim diagnostic returned no row.");
    return {
      idnumber: String(id),
      inTblStudent: Boolean(x.inTblStudent),
      hasStudentMaster: Boolean(x.hasStudentMaster),
      hasNameRecord: Boolean(x.hasNameRecord),
      hasBiograph: Boolean(x.hasBiograph),
      addressRows: Number(x.addressRows ?? 0),
      qualifyingAddressRows: Number(x.qualifyingAddressRows ?? 0),
      addressCodes: text(x.addressCodes),
      proposed: {
        lastName: text(x.lastName),
        firstName: text(x.firstName),
        middleName: text(x.middleName),
        email: text(x.email),
        city: text(x.city),
        stateCode: text(x.stateCode),
      },
    };
  }

  /**
   * EXEC only. The application has no INSERT privilege on dbo and must not acquire one (S-D1);
   * everything the caller reports comes from the procedure's own result row rather than from a
   * row count, so an unexpected shape is an error rather than a silent "probably worked".
   */
  async reclaimStudent(id: StudentKey, actor: string, allowPartial: boolean): Promise<ReclaimResult> {
    try {
      const r = await (await this.pool())
        .request()
        .input("id", sql.VarChar(50), id)
        .input("actor", sql.VarChar(200), actor)
        .input("allowPartial", sql.Bit, allowPartial)
        .query<RawReclaim>(QS.reclaimExecute);
      const x = r.recordset[0];
      if (!x) throw new DataSourceUnavailableError("The reclaim procedure returned no outcome.");
      return {
        outcome: x.outcome as ReclaimOutcome,
        hasStudentMaster: Boolean(x.hasStudentMaster),
        hasNameRecord: Boolean(x.hasNameRecord),
        hasBiograph: Boolean(x.hasBiograph),
        hasQualifyingAddress: Boolean(x.hasQualifyingAddress),
        addressRows: Number(x.addressRows ?? 0),
        rowsInserted: Number(x.rowsInserted ?? 0),
      };
    } catch (err) {
      // Until a DBA runs db/production/10_usp_reclaim_student.sql the procedure does not exist, and
      // that is the expected state rather than a fault. Surfacing it as "unavailable" lets the page
      // show the diagnostic — which is the useful half — with the offer explained away.
      const msg = err instanceof Error ? err.message : String(err);
      if (/Could not find stored procedure|permission was denied|EXECUTE permission/i.test(msg)) {
        throw new DataSourceUnavailableError("The reclaim procedure is not installed or not granted.", err);
      }
      throw err;
    }
  }

  async updateStudentSemester(id: StudentKey, actor: string): Promise<SemesterUpdateResult> {
    try {
      const r = await (await this.pool())
        .request()
        .input("id", sql.VarChar(50), id)
        .input("actor", sql.VarChar(200), actor)
        .query<RawSemesterUpdate>(QS.updateSemester);
      const x = r.recordset[0];
      if (!x) throw new DataSourceUnavailableError("The semester update procedure returned no outcome.");
      return {
        outcome: x.outcome as SemesterUpdateOutcome,
        lastCleared: text(x.lastCleared),
        exPeriod: text(x.exPeriod),
        rowsUpdated: Number(x.rowsUpdated ?? 0),
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/Could not find stored procedure|permission was denied|EXECUTE permission/i.test(msg)) {
        throw new DataSourceUnavailableError("The semester update procedure is not installed or not granted.", err);
      }
      throw err;
    }
  }

}

/** Multi-statement batches (temp-table prelude) return their SELECT as the final recordset. */
/**
 * Sp_GetFCWorksheetItems can emit more than one recordset (the live-table pass and the frozen
 * backup pass), and whichever branch did not fire comes back empty. Taking the LAST set blindly
 * would then show an empty worksheet, so take the last set that actually has rows.
 */
function lastNonEmptySet<T>(r: sql.IResult<T>): T[] {
  for (let i = r.recordsets.length - 1; i >= 0; i--) {
    const set = r.recordsets[i] as unknown as T[];
    if (set?.length) return set;
  }
  return r.recordset ?? [];
}

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

/**
 * Sp_GetFCWorksheetItems returns trans_hist-shaped rows plus an item-type column carrying
 * 'Debit' / 'Credit', which is what decides the sign of a row in the net amount (D-3).
 */
interface RawWorksheetItem extends RawTransaction {
  [column: string]: unknown;
}

/**
 * Read the item-type column without hard-coding one spelling of its name. The procedure's own
 * casing has been reported as both ITEM_TYPE and ItemType, and a single wrong guess silently blanks
 * the column and — worse — makes every credit count as a debit. So: match any column whose name
 * reduces to "itemtype" (or a bare "type"), ignoring case, underscores and spaces.
 */
const ITEM_TYPE_COLUMNS = new Set(["itemtype", "type"]);

export function pickItemType(row: Record<string, unknown>): string | null {
  for (const [key, value] of Object.entries(row)) {
    if (!ITEM_TYPE_COLUMNS.has(key.replace(/[^a-z0-9]/gi, "").toLowerCase())) continue;
    const text = value == null ? "" : String(value).trim();
    if (text) return text;
  }
  return null;
}

interface RawCostAnalysis { eighty: number | null; amtdue: number | null; needed: number | null; loan: number | null; payment: number | null; charges: number | null; credits: number | null; }

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

interface RawUnclassified { idnumber: string | number; classCode: string; resolvableAs: string; status: string; source: "enrolled" | "cleared" }
interface RawFreshman { idnumber: string | number; classCode: string; webCode: number | null; mostRecentYearEnrolled: string | number | null; currentClassCode: string; dateCreated: string | Date | null; semesterBegins: string | Date | null; derivedClass: "FF" | "FR"; mismatch: boolean | number }
interface RawClearedAction { idnumber: string | number; classCode: string; dateCleared: string | Date | null; clearedBy: string | null; actionNo: number; actionCount: number }
interface RawEnrolleeBalance { idnumber: string | number; classCode: string; rawClassCode: string }
interface RawCurrentlyCleared { idnumber: string | number; classCode: string; rawClassCode: string; dateCleared: string | Date | null }
interface RawDiagnostic { inTblStudent: number; hasStudentMaster: number; hasNameRecord: number; hasBiograph: number; addressRows: number; qualifyingAddressRows: number; addressCodes: string | null; lastName: string | null; firstName: string | null; middleName: string | null; email: string | null; city: string | null; stateCode: string | null }
interface RawReclaim { outcome: string; hasStudentMaster: number; hasNameRecord: number; hasBiograph: number; hasQualifyingAddress: number; addressRows: number; rowsInserted: number }
interface RawSemesterUpdate { outcome: string; lastCleared: string | number | null; exPeriod: string | number | null; rowsUpdated: number }
interface RawContact { idnumber: string | number; lastname: string | null; firstname: string | null; email: string | number | null; AccountBalance: number | string | null }

/**
 * Bind a calendar date as an explicit UTC-midnight Date. tedious writes `date` parameters from the
 * value's UTC components, so this sends exactly the day the administrator entered — never a string
 * whose interpretation would depend on the session's language or DATEFORMAT.
 */
function utcDate(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

/**
 * Trim a column that may not be a string. Several Jenzabar columns are numeric or char(n) depending
 * on the object, and calling .trim() on a number throws at runtime rather than at compile time —
 * which is exactly how this surfaced on the Freshman report's MOST_RECNT_YR_ENR.
 */
function text(v: string | number | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

/** SQL money/numeric arrive as JS numbers from tedious; normalise nulls and rounding. */
function money(v: number | string | null | undefined): number {
  if (v === null || v === undefined) return 0;
  return Math.round(Number(v) * 100) / 100;
}
