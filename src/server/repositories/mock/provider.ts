import { breakdownCode } from "../../metadata/clearance-breakdown";
import { getConfig } from "../../db/config";
import { toIsoDate } from "@/lib/dates";
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
  SemesterUpdateResult,
  ClearanceCheckResult,
  ReceivableDecompositionRow,
  UnmatchedTermRow,
} from "../types";
import { resolveTerms } from "../types";
import { generateSyntheticDataset, generateTransactions, type SyntheticDataset } from "./synthetic";

/**
 * Mock DataProvider. Implements the SAME definitions as the mssql provider (A-1, A-2):
 *
 *   VIEW_OURM / VIEW_OURM_FCA  ≈ students where enrolledCurrentTerm
 *   VIEW_OURM_STATS            ≈ students with a clearance action this term (clearedBy != null)
 *   tblStudent                 ≈ all students (AccountBalance, LastCleared, ClearedCurrentSession = status)
 *   tblOUSA                    ≈ terms
 */
export class MockDataProvider implements DataProvider {
  readonly name = "mock" as const;
  private readonly data: SyntheticDataset;
  private readonly capturedAt: Date | null;

  constructor(data: SyntheticDataset = generateSyntheticDataset(), capturedAt?: Date) {
    this.data = data;
    this.capturedAt = capturedAt ?? null;
  }

  async getSourceInfo(): Promise<SourceInfo> {
    return { provider: "mock", capturedAt: this.capturedAt ?? new Date(), snapshotId: null };
  }

  async getTermMetadata(): Promise<TermMetadata[]> {
    return this.data.terms;
  }

  private terms() {
    return resolveTerms(this.data.terms);
  }

  /** VIEW_OURM rows. */
  private enrolled(): StudentRow[] {
    return this.data.students.filter((s) => s.enrolledCurrentTerm);
  }

  /** VIEW_OURM_STATS rows (one per student — the [rows] = 1 rule is already applied). */
  private clearanceActions(): StudentRow[] {
    return this.data.students.filter((s) => s.clearedBy !== null);
  }

  async getEnrollmentClearance(): Promise<EnrollmentClearance> {
    const enrolled = this.enrolled();
    const actions = this.clearanceActions();
    const enrolledIds = new Set(enrolled.map((s) => s.idnumber));
    const { current } = this.terms();
    return {
      enrolled: enrolled.length,
      cleared: new Set(actions.map((s) => s.idnumber)).size,
      notCleared: enrolled.filter((s) => s.status !== "Cleared").length,
      clearedNotEnrolled: actions.filter((s) => !enrolledIds.has(s.idnumber)).length,
      nightly: { census: current.census, financiallyCleared: current.financiallyCleared },
    };
  }

  async getCurrentReceivable(terms: TermKey[]): Promise<ReceivableSummary> {
    const rows = this.data.students.filter((s) => s.lastCleared !== null && terms.includes(s.lastCleared) && s.accountBalance > 0);
    return { total: round2(rows.reduce((sum, s) => sum + s.accountBalance, 0)), studentCount: rows.length };
  }

  async getChargesCredits(): Promise<ChargesCredits> {
    return { charges: this.data.charges, credits: this.data.credits, afterDropDate: this.data.afterDropDate };
  }

  async getDnrDncSummary(): Promise<DnrDncSummary> {
    const dnc = this.population("dnc");
    const dnr = this.population("dnr");
    return {
      dnc: { count: dnc.length, positiveBalance: round2(sum(dnc)) },
      dnr: { count: dnr.length, positiveBalance: round2(sum(dnr)) },
      dnrGuardViolations: this.dnrCandidates().filter((s) => s.enrolledCurrentTerm).length,
    };
  }

  /** Enrolled from VIEW_OURM rows; Cleared from clearance actions (both mapped with breakdownCode). */
  async getClassificationCounts(range?: DateRange): Promise<ClassificationCounts> {
    const enrolled = new Map<string, number>();
    const cleared = new Map<string, number>();
    for (const s of this.enrolled()) {
      const k = breakdownCode(s.classificationCode, s.isIncomingTransfer);
      enrolled.set(k, (enrolled.get(k) ?? 0) + 1);
    }
    for (const s of this.clearanceActions()) {
      if (range && !this.inRange(s.clearedAt, range)) continue;
      const k = breakdownCode(s.classificationCode, s.isIncomingTransfer);
      cleared.set(k, (cleared.get(k) ?? 0) + 1);
    }
    return { enrolled, cleared };
  }

  /** Spec §7.1 — one row per day that had at least one clearance action. */
  async getClearanceByDate(range: DateRange): Promise<ClearanceByDateRow[]> {
    const byDate = new Map<string, number>();
    for (const s of this.clearanceActionsIn(range)) {
      const day = this.day(s.clearedAt!);
      byDate.set(day, (byDate.get(day) ?? 0) + 1);
    }
    return [...byDate.entries()].map(([date, cleared]) => ({ date, cleared })).sort((a, b) => a.date.localeCompare(b.date));
  }

  /** Spec §7.2 — per ClearedBy code, with first/last action for operator effective-date seeding. */
  async getClearanceByOperator(range: DateRange): Promise<ClearanceByOperatorRow[]> {
    const rows = new Map<string, ClearanceByOperatorRow>();
    for (const s of this.clearanceActionsIn(range)) {
      const code = s.clearedBy ?? "";
      const at = s.clearedAt!;
      const row = rows.get(code) ?? { operatorCode: code, cleared: 0, firstAt: at, lastAt: at };
      row.cleared += 1;
      if (row.firstAt === null || at < row.firstAt) row.firstAt = at;
      if (row.lastAt === null || at > row.lastAt) row.lastAt = at;
      rows.set(code, row);
    }
    return [...rows.values()].sort((a, b) => b.cleared - a.cleared || a.operatorCode.localeCompare(b.operatorCode));
  }

  async getSprintStudents(filter: SprintStudentFilter, page: PageRequest): Promise<Page<StudentRow>> {
    const all = this.clearanceActionsIn(filter.range).filter((s) => {
      if (filter.date && this.day(s.clearedAt!) !== filter.date) return false;
      if (filter.operatorCode !== undefined && (s.clearedBy ?? "") !== filter.operatorCode) return false;
      if (filter.classificationCode && breakdownCode(s.classificationCode, s.isIncomingTransfer) !== filter.classificationCode) return false;
      return true;
    });
    const sorted = sortRows(all, page.sort);
    const start = (page.page - 1) * page.pageSize;
    return { rows: sorted.slice(start, start + page.pageSize), page: page.page, pageSize: page.pageSize, totalRows: all.length };
  }

  /** Clearance actions with a timestamp inside the window (undated actions cannot be placed on a day). */
  private clearanceActionsIn(range: DateRange): StudentRow[] {
    return this.clearanceActions().filter((s) => this.inRange(s.clearedAt, range));
  }

  private inRange(at: Date | null, range: DateRange): boolean {
    if (!at) return false;
    const day = this.day(at);
    return day >= range.start && day <= range.end;
  }

  /** Calendar date of an action in the institution timezone — the same boundary the SQL provider uses. */
  private day(at: Date): string {
    return toIsoDate(at, getConfig().APP_TIMEZONE);
  }

  /** Spec §8: DNC first, then DNR; both already positive-balance by the A-1 rule. */
  async getDnrDncPopulation(limit = 5000): Promise<DnrDncRow[]> {
    const rows: DnrDncRow[] = [
      ...this.population("dnc").map((s) => ({ ...s, category: "DNC" as const })),
      ...this.population("dnr").map((s) => ({ ...s, category: "DNR" as const })),
    ];
    return rows.slice(0, limit);
  }

  async getGlobalBalances(): Promise<GlobalBalances> {
    let positiveTotal = 0;
    let positiveCount = 0;
    let negativeTotal = 0;
    let negativeCount = 0;
    let zeroCount = 0;
    for (const s of this.data.students) {
      if (s.accountBalance > 0) {
        positiveTotal += s.accountBalance;
        positiveCount += 1;
      } else if (s.accountBalance < 0) {
        negativeTotal += Math.abs(s.accountBalance);
        negativeCount += 1;
      } else zeroCount += 1;
    }
    return { positiveTotal: round2(positiveTotal), positiveCount, negativeTotal: round2(negativeTotal), negativeCount, zeroCount };
  }

  async getReceivablesByTerm(): Promise<ReceivableByTermRow[]> {
    const rows = new Map<string, ReceivableByTermRow>();
    for (const s of this.data.students) {
      if (s.accountBalance <= 0) continue;
      const termKey = s.lastCleared ?? "";
      const row = rows.get(termKey) ?? { termKey, students: 0, positiveBalance: 0 };
      row.students += 1;
      row.positiveBalance = round2(row.positiveBalance + s.accountBalance);
      rows.set(termKey, row);
    }
    return [...rows.values()].sort((a, b) => a.termKey.localeCompare(b.termKey));
  }

  async getStudentsForPopulation(population: DrillDownPopulation, page: PageRequest): Promise<Page<StudentRow>> {
    const all = this.population(population);
    const sorted = sortRows(all, page.sort);
    const start = (page.page - 1) * page.pageSize;
    return { rows: sorted.slice(start, start + page.pageSize), page: page.page, pageSize: page.pageSize, totalRows: all.length };
  }

  /** Supplied DNR query before the enrollment guard (A-1). */
  private dnrCandidates(): StudentRow[] {
    const { previousKeys } = this.terms();
    return this.data.students.filter((s) => s.lastCleared !== null && previousKeys.includes(s.lastCleared) && s.status === "Cleared" && s.accountBalance > 0);
  }

  private population(population: DrillDownPopulation): StudentRow[] {
    const { currentKeys } = this.terms();
    switch (population) {
      case "enrolled":
        return this.enrolled();
      case "cleared":
        return this.clearanceActions();
      case "notCleared":
        return this.enrolled().filter((s) => s.status !== "Cleared");
      case "receivable":
        return this.data.students.filter((s) => s.lastCleared !== null && currentKeys.includes(s.lastCleared) && s.accountBalance > 0);
      case "dnc":
        // LastCleared = current term AND ClearedCurrentSession = 0 AND AccountBalance > 0
        return this.data.students.filter((s) => s.lastCleared !== null && currentKeys.includes(s.lastCleared) && s.status === "Not Cleared" && s.accountBalance > 0);
      case "dnr":
        // LastCleared = previous term AND ClearedCurrentSession = 1 AND AccountBalance > 0 AND NOT EXISTS (VIEW_OURM)
        return this.dnrCandidates().filter((s) => !s.enrolledCurrentTerm);
    }
  }
  /* ── Phase 5 — Student subsystem (Bio Spec) ── */

  /** Bio Spec 1.1–1.2. The service has already rejected empty/wildcard-only terms and escaped LIKE metacharacters. */
  async searchStudents(query: StudentSearchQuery): Promise<StudentSearchRow[]> {
    const contains = (haystack: string, needle?: string) => needle === undefined || haystack.toLowerCase().includes(needle.toLowerCase());
    const matches = this.data.students.filter((s) => {
      if (query.by === "id") return query.idnumber !== undefined && s.idnumber.startsWith(query.idnumber);
      return contains(s.lastName, query.lastName) && contains(s.firstName, query.firstName);
    });
    return matches
      .sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName) || a.idnumber.localeCompare(b.idnumber))
      .slice(0, query.limit)
      .map((s) => this.searchRow(s));
  }

  async getStudentBio(id: StudentKey): Promise<StudentBio | null> {
    const s = this.data.students.find((r) => r.idnumber === id);
    if (!s) return null;
    const bio = this.data.bios.get(id);
    return {
      ...this.searchRow(s),
      middleName: s.middleName,
      pid: s.pid,
      dob: bio?.dob ?? null,
      cnp: bio?.cnp ?? null,
      address: bio?.address ?? { address: null, city: null, stateCode: null, zipCode: null, country: null },
      clearedOn: bio?.clearedOn ?? null,
      clearedOnRaw: null,
    };
  }

  /** Bio Spec 2. Both scopes are generated here; the real provider reads two different servers (D-1). */
  async getStudentTransactions(id: StudentKey, scope: TransactionScope): Promise<TransactionRow[]> {
    const s = this.data.students.find((r) => r.idnumber === id);
    if (!s) return [];
    const { current } = this.terms();
    return generateTransactions(s, scope, current.semesterBegins);
  }

  /**
   * Bio Spec 1.5.1. The sproc returns the items still outstanding for the term; the mock derives them
   * from the current-term transactions so the net amount the clearance card computes is consistent
   * with the transactions card the user can see beside it.
   */
  async getClearanceWorksheetItems(id: StudentKey, _dropClassesDate: string): Promise<WorksheetItemRow[]> {
    void _dropClassesDate;
    const rows = await this.getStudentTransactions(id, "current");
    // The procedure hands back an unsigned amount plus ITEM_TYPE; the mock mirrors that shape, so a
    // credit here is a positive amount tagged 'Credit' exactly as staging returns it (D-3).
    return rows.map((r) => ({
      description: r.description,
      amount: Math.abs(r.amount),
      postedOn: r.postedOn,
      sourceCode: r.sourceCode,
      itemType: r.amount < 0 ? "Credit" : "Debit",
    }));
  }

  /**
   * A-8 / D-2 — the institution's fn_CostAnalysis, reproduced from its published source
   * (FINDINGS §8.5, function dated 2013, "eighty" fixed to 80% in 2023):
   *
   *   cost   = charges − credits          amtdue = balance + cost          eighty = charges × 0.8
   *   when amtdue > 0:
   *     credits > eighty + balance  →  nothing to clear; the whole amount due is financed
   *     otherwise                   →  needed = eighty + (balance − credits); loan = amtdue − needed
   *   payment = loan ÷ 5;  when amtdue ≤ 0 every figure is zero
   *
   * Reproducing it here rather than approximating it is what makes the D-2 equivalence test
   * meaningful: on real data the figures come from the function itself, never from this arithmetic.
   */
  async getCostAnalysis(id: StudentKey): Promise<CostAnalysisRow | null> {
    const s = this.data.students.find((r) => r.idnumber === id);
    if (!s) return null;
    const rows = await this.getStudentTransactions(id, "current");
    const charges = round2(rows.filter((r) => r.amount > 0).reduce((t, r) => t + r.amount, 0));
    const credits = round2(rows.filter((r) => r.amount < 0).reduce((t, r) => t + Math.abs(r.amount), 0));
    const balance = s.accountBalance;

    const amtdue = round2(balance + (charges - credits));
    if (amtdue <= 0) return { eighty: 0, amtdue: 0, needed: 0, loan: 0, payment: 0, charges, credits };

    const eighty = round2(charges * 0.8);
    const needed = credits > eighty + balance ? 0 : round2(eighty + (balance - credits));
    const loan = round2(amtdue - needed);
    return { eighty, amtdue, needed, loan, payment: round2(loan / 5), charges, credits };
  }

  /** Bio Spec 1.3 recordset shape, shared by search and the bio card so the two cannot disagree. */
  private searchRow(s: StudentRow): StudentSearchRow {
    const bio = this.data.bios.get(s.idnumber);
    return {
      idnumber: s.idnumber,
      lastName: s.lastName,
      firstName: s.firstName,
      email: s.email,
      phone: bio?.phone ?? null,
      lastCleared: s.lastCleared,
      accountBalance: s.accountBalance,
      classificationCode: s.classificationCode,
      clearedCurrentSession: s.status === "Cleared",
      enrolledCurrentTerm: s.enrolledCurrentTerm,
    };
  }

  /* ── Phase 7a — Report populations (docs/REPORTS-PLAN.md) ── */

  /**
   * The synthetic dataset uses the same definitions as the mssql provider, so these mirror the
   * rewritten SQL rather than the supplied scripts: enrolled = enrolledCurrentTerm, cleared = has a
   * clearance action (clearedBy != null), raw class code = classificationCode, A-19 bucket via
   * breakdownCode(). A report that works here works there, and the tests can run with no database.
   */
  async getUnclassifiedPopulation(): Promise<UnclassifiedRow[]> {
    const unknown = (s: StudentRow) => !KNOWN_CLASS_CODES.includes(s.classificationCode.toUpperCase() as (typeof KNOWN_CLASS_CODES)[number]);
    const rows = new Map<string, UnclassifiedRow>();
    // Enrolled first, then cleared — the supplied script's source_priority, which decides only
    // which row survives the dedup, never anything shown on the page.
    for (const s of this.data.students.filter((s) => s.enrolledCurrentTerm && unknown(s))) {
      rows.set(s.idnumber, {
        idnumber: s.idnumber,
        classCode: s.classificationCode.toUpperCase(),
        resolvableAs: breakdownCode(s.classificationCode, s.isIncomingTransfer),
        status: s.status,
        source: "enrolled",
      });
    }
    for (const s of this.data.students.filter((s) => s.clearedBy !== null && unknown(s))) {
      if (rows.has(s.idnumber)) continue;
      rows.set(s.idnumber, {
        idnumber: s.idnumber,
        classCode: s.classificationCode.toUpperCase(),
        resolvableAs: breakdownCode(s.classificationCode, s.isIncomingTransfer),
        status: "Cleared",
        source: "cleared",
      });
    }
    return [...rows.values()];
  }

  async getFreshmanAnalysis(): Promise<FreshmanAnalysisRow[]> {
    const terms = resolveTerms(this.data.terms);
    // Both terms (R-D2a), each against its OWN SemesterBegins — the point of the widening is that
    // the two boundaries differ, so mock mode has to reproduce two of them or the page's per-term
    // panels are never exercised outside production.
    const scopes = [
      { term: terms.current, keys: terms.currentKeys, isCurrentTerm: true },
      { term: terms.previous, keys: terms.previousKeys, isCurrentTerm: false },
    ];
    const freshmen = this.data.students.filter((s) => ["FR", "FF"].includes(s.classificationCode.toUpperCase()));
    return scopes
      .flatMap(({ term, keys, isCurrentTerm }) => {
        const begins = term.semesterBegins ? new Date(term.semesterBegins) : null;
        return freshmen
          .filter((s) => s.lastCleared !== null && keys.includes(s.lastCleared))
          .map((s) => {
            // Synthetic stand-in for student_master.DateCreated: deterministic per student, spread
            // either side of the boundary so the mismatch pattern the page draws is visible in mock mode.
            const created = syntheticCreated(s.idnumber, begins);
            const derivedClass: "FF" | "FR" = begins && created && created > begins ? "FF" : "FR";
            return {
              idnumber: s.idnumber,
              classCode: s.classificationCode.toUpperCase(),
              webCode: s.isIncomingTransfer ? 22 : 1,
              mostRecentYearEnrolled: term.yearCode || null,
              currentClassCode: s.classificationCode.toUpperCase(),
              dateCreated: created,
              semesterName: term.semesterName,
              isCurrentTerm,
              semesterBegins: begins,
              derivedClass,
              mismatch: s.classificationCode.toUpperCase() !== derivedClass,
            };
          })
          .sort((a, b) => (a.dateCreated?.getTime() ?? 0) - (b.dateCreated?.getTime() ?? 0) || a.idnumber.localeCompare(b.idnumber));
      });
  }

  async getClearedMoreThanOncePopulation(): Promise<ClearedActionRow[]> {
    // The synthetic set holds one action per student, so a deterministic slice is given a second
    // one — without it the report would always be empty in mock mode and nothing would exercise
    // the grouped layout. Seven students, matching what staging showed on 2026-09-17.
    const cleared = this.data.students.filter((s) => s.clearedBy !== null && s.clearedAt !== null);
    const dupes = cleared.filter((_, i) => i % 97 === 0).slice(0, 7);
    const out: ClearedActionRow[] = [];
    for (const s of dupes) {
      const first = s.clearedAt as Date;
      const second = new Date(first.getTime() + 36 * 3600 * 1000);
      out.push(
        { idnumber: s.idnumber, classCode: breakdownCode(s.classificationCode, s.isIncomingTransfer), dateCleared: first, clearedBy: s.clearedBy, actionNo: 1, actionCount: 2 },
        { idnumber: s.idnumber, classCode: breakdownCode(s.classificationCode, s.isIncomingTransfer), dateCleared: second, clearedBy: "sa", actionNo: 2, actionCount: 2 },
      );
    }
    return out.sort((a, b) => a.idnumber.localeCompare(b.idnumber) || a.actionNo - b.actionNo);
  }

  async getEnrolleeBalancePopulation(): Promise<EnrolleeBalanceRow[]> {
    return this.data.students
      .filter((s) => s.enrolledCurrentTerm && s.status !== "Cleared" && s.accountBalance > 0)
      .map((s) => ({
        idnumber: s.idnumber,
        classCode: breakdownCode(s.classificationCode, s.isIncomingTransfer),
        rawClassCode: s.classificationCode.toUpperCase(),
      }));
  }

  async getCurrentlyClearedPopulation(): Promise<CurrentlyClearedRow[]> {
    return this.data.students
      .filter((s) => s.clearedBy !== null)
      .map((s) => ({
        idnumber: s.idnumber,
        classCode: breakdownCode(s.classificationCode, s.isIncomingTransfer),
        rawClassCode: s.classificationCode.toUpperCase(),
        dateCleared: s.clearedAt,
      }));
  }

  async getStudentContacts(ids: string[]): Promise<StudentContactRow[]> {
    const want = new Set(ids);
    return this.data.students
      .filter((s) => want.has(s.idnumber))
      .map((s) => ({
        idnumber: s.idnumber,
        lastName: s.lastName,
        firstName: s.firstName,
        email: s.email || null,
        accountBalance: s.accountBalance,
      }));
  }


  /* ── Student reclaim (docs/STUDENT-RECLAIM-PLAN.md) ── */

  /**
   * Mock mode has no Jenzabar, so the synthetic dataset stands in for it: a student the dataset
   * knows about but that is marked as not loaded plays the part of a record present in
   * student_master and absent from tblStudent.
   *
   * The three gap shapes are generated deterministically from the id so the panel, the warnings
   * and the refusal paths can all be demonstrated without a database — including the case that
   * matters most, an address that exists under a code the loader ignores.
   */
  async getReclaimDiagnostic(id: StudentKey): Promise<ReclaimDiagnostic> {
    const existing = this.data.students.find((s) => s.idnumber === id);
    if (existing) {
      return {
        idnumber: id,
        inTblStudent: true,
        hasStudentMaster: true,
        hasNameRecord: true,
        hasBiograph: true,
        addressRows: 1,
        qualifyingAddressRows: 1,
        addressCodes: "LHP",
        proposed: { lastName: existing.lastName, firstName: existing.firstName, middleName: existing.middleName, email: existing.email || null, city: null, stateCode: null },
      };
    }
    // An id that is not numeric, or outside the synthetic range, stands for "not in Jenzabar".
    const n = Number(id);
    if (!Number.isFinite(n) || String(Math.trunc(n)).length < 4) {
      return { idnumber: id, inTblStudent: false, hasStudentMaster: false, hasNameRecord: false, hasBiograph: false, addressRows: 0, qualifyingAddressRows: 0, addressCodes: null, proposed: { lastName: null, firstName: null, middleName: null, email: null, city: null, stateCode: null } };
    }
    // Otherwise: present in Jenzabar, with a gap shape chosen by the id so every branch is reachable.
    const shape = Math.trunc(n) % 4;
    const hasBiograph = shape !== 1 && shape !== 3;
    const qualifying = shape === 2 || shape === 3 ? 0 : 1;
    // Always true: the mock has no "missing name" shape, because that path is a refusal rather than
    // a gap and is covered by the unit tests. An earlier version wrote `shape !== 3 || true`, which
    // is just `true` with a misleading condition attached.
    const hasName = true;
    return {
      idnumber: id,
      inTblStudent: false,
      hasStudentMaster: true,
      hasNameRecord: hasName,
      hasBiograph,
      addressRows: qualifying === 0 ? 2 : 1,
      qualifyingAddressRows: qualifying,
      // The realistic failure: addresses exist, but under codes the loader's WHERE clause ignores.
      addressCodes: qualifying === 0 ? "PRM, BIL" : "LHP",
      proposed: {
        lastName: "SYNTHETIC",
        firstName: "STUDENT",
        middleName: "",
        email: `student${Math.trunc(n)}@example.edu`,
        city: qualifying ? "Huntsville" : null,
        stateCode: qualifying ? "AL" : null,
      },
    };
  }

  /** Mock mode never writes anything; it reports the outcome the rules would produce. */
  async reclaimStudent(id: StudentKey, _actor: string, allowPartial: boolean): Promise<ReclaimResult> {
    const d = await this.getReclaimDiagnostic(id);
    const base = {
      hasStudentMaster: d.hasStudentMaster,
      hasNameRecord: d.hasNameRecord,
      hasBiograph: d.hasBiograph,
      hasQualifyingAddress: d.qualifyingAddressRows > 0,
      addressRows: d.addressRows,
      rowsInserted: 0,
    };
    if (d.inTblStudent) return { ...base, outcome: "already_exists" };
    if (!d.hasStudentMaster) return { ...base, outcome: "not_in_jenzabar" };
    if (!d.hasNameRecord) return { ...base, outcome: "no_name_record" };
    if ((!d.hasBiograph || d.qualifyingAddressRows === 0) && !allowPartial) return { ...base, outcome: "partial_not_allowed" };
    return { ...base, outcome: "inserted", rowsInserted: 1 };
  }

  /**
   * Mock mode never writes. The outcome is derived so every branch the UI must handle is reachable:
   * a student already on the current term updates, one with an id ending 7 stands for "registered
   * nowhere this term" (the No Semester Info found path), and an unknown id is no_student.
   */
  async updateStudentSemester(id: StudentKey, _actor: string): Promise<SemesterUpdateResult> {
    const student = this.data.students.find((s) => s.idnumber === id);
    if (!student) return { outcome: "no_student", lastCleared: null, exPeriod: null, rowsUpdated: 0 };
    if (id.endsWith("7")) return { outcome: "no_registration", lastCleared: null, exPeriod: null, rowsUpdated: 0 };
    const terms = resolveTerms(this.data.terms);
    return {
      outcome: "updated",
      // The same source the app matches against, mirroring what the procedure does.
      lastCleared: terms.current.tradName,
      exPeriod: `${terms.current.yearCode}FA`,
      rowsUpdated: 1,
    };
  }

  async checkStudentClearance(id: StudentKey, _actor: string): Promise<ClearanceCheckResult> {
    const student = this.data.students.find((s) => s.idnumber === id);
    if (!student) return { outcome: "no_student", lastCleared: null, clearedOn: null, clearedBy: null, rowsUpdated: 0 };

    // The mock's stand-in for VIEW_OURM_CLEARED: clearedBy is non-null exactly for the students the
    // synthetic set treats as having a clearance action this term (see the view map above).
    if (!student.clearedBy) {
      return { outcome: "no_clearance_record", lastCleared: null, clearedOn: null, clearedBy: null, rowsUpdated: 0 };
    }

    const terms = resolveTerms(this.data.terms);
    // The procedure takes ClearedOn from the clearance action's own date, so the mock does too.
    const when = student.clearedAt ?? terms.current.semesterBegins;
    return {
      outcome: "cleared",
      lastCleared: terms.current.tradName,
      clearedOn: when ? new Date(when).toISOString().slice(0, 10).replace(/-/g, "") : null,
      clearedBy: student.clearedBy,
      rowsUpdated: 1,
    };
  }

  /* ── Phase 8 — AI analyses (docs/AI-ANALYSIS-PLAN.md) ── */

  async getReceivableDecomposition(): Promise<ReceivableDecompositionRow[]> {
    const terms = resolveTerms(this.data.terms);
    const enrolled = new Set(this.data.students.filter((s) => s.enrolledCurrentTerm).map((s) => s.idnumber));
    const byTerm = new Map<string, ReceivableDecompositionRow>();

    for (const student of this.data.students) {
      if (student.accountBalance <= 0 || !student.lastCleared) continue;
      const term = this.data.terms.find((t) => student.lastCleared === t.tradName || student.lastCleared === t.leapName);
      if (!term) continue; // the A-42 residue; getUnmatchedTermResidue reports it separately
      const row = byTerm.get(term.semesterName) ?? {
        semesterName: term.semesterName,
        termBegins: term.semesterBegins ? new Date(term.semesterBegins) : null,
        students: 0, owed: 0, stillEnrolled: 0, owedByEnrolled: 0,
        owedByNotEnrolled: 0, owedClearedNotReturned: 0, owedNeverClearedGone: 0,
      };
      const live = enrolled.has(student.idnumber);
      const cleared = student.status === "Cleared";
      row.students += 1;
      row.owed = round2(row.owed + student.accountBalance);
      if (live) {
        row.stillEnrolled += 1;
        row.owedByEnrolled = round2(row.owedByEnrolled + student.accountBalance);
      } else {
        row.owedByNotEnrolled = round2(row.owedByNotEnrolled + student.accountBalance);
        if (cleared) row.owedClearedNotReturned = round2(row.owedClearedNotReturned + student.accountBalance);
        else row.owedNeverClearedGone = round2(row.owedNeverClearedGone + student.accountBalance);
      }
      byTerm.set(term.semesterName, row);
    }
    void terms;
    return [...byTerm.values()].sort((a, b) => (a.termBegins?.getTime() ?? 0) - (b.termBegins?.getTime() ?? 0));
  }

  async getUnmatchedTermResidue(): Promise<UnmatchedTermRow[]> {
    const byKey = new Map<string, UnmatchedTermRow>();
    for (const student of this.data.students) {
      if (student.accountBalance <= 0) continue;
      const matched = this.data.terms.some((t) => student.lastCleared === t.tradName || student.lastCleared === t.leapName);
      if (matched) continue;
      const key = student.lastCleared ?? "";
      const row = byKey.get(key) ?? { termKey: key, students: 0, owed: 0 };
      row.students += 1;
      row.owed = round2(row.owed + student.accountBalance);
      byKey.set(key, row);
    }
    return [...byKey.values()].sort((a, b) => b.owed - a.owed);
  }

}

/** Classification codes the application recognises — mirrors KNOWN_CLASS_CODES in the report SQL. */
const KNOWN_CLASS_CODES = ["AD", "AE", "EM", "FF", "FR", "GR", "JR", "SO", "SR", "DI"] as const;

/**
 * Deterministic stand-in for student_master.DateCreated in mock mode: a stable offset of -60..+29
 * days around the semester start, derived from the id so the same student always lands on the same
 * day. Roughly a third fall after the boundary, which is what makes R2's mismatch pattern visible
 * without a database.
 */
function syntheticCreated(id: string, begins: Date | null): Date | null {
  if (!begins) return null;
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % 90;
  return new Date(begins.getTime() + (h - 60) * 24 * 3600 * 1000);
}

function sum(rows: StudentRow[]): number {
  return rows.reduce((t, r) => t + r.accountBalance, 0);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function sortRows(rows: StudentRow[], sort: PageRequest["sort"]): StudentRow[] {
  if (!sort) return [...rows].sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName));
  const dir = sort.direction === "desc" ? -1 : 1;
  return [...rows].sort((a, b) => {
    const av = a[sort.field];
    const bv = b[sort.field];
    if (av === bv) return 0;
    if (av === null || av === undefined) return 1;
    if (bv === null || bv === undefined) return -1;
    return (av < bv ? -1 : 1) * dir;
  });
}
