import { breakdownCode } from "../../metadata/clearance-breakdown";
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
import { resolveTerms } from "../types";
import { generateSyntheticDataset, type SyntheticDataset } from "./synthetic";

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
  async getClassificationCounts(): Promise<ClassificationCounts> {
    const enrolled = new Map<string, number>();
    const cleared = new Map<string, number>();
    for (const s of this.enrolled()) {
      const k = breakdownCode(s.classificationCode, s.isIncomingTransfer);
      enrolled.set(k, (enrolled.get(k) ?? 0) + 1);
    }
    for (const s of this.clearanceActions()) {
      const k = breakdownCode(s.classificationCode, s.isIncomingTransfer);
      cleared.set(k, (cleared.get(k) ?? 0) + 1);
    }
    return { enrolled, cleared };
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
