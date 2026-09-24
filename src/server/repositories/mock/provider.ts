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
