/**
 * Clearance Breakdown classification rules (Spec §7.3), exactly as in the supplied source query
 * docs/validation-sql/clearance_by_classification.sql:
 *   - "Incoming Transfer" (TEL_WEB_GRP_CDE = 22, FCA/STATS column `what`) → TR, before any other rule
 *   - FF and FR → FR (Freshmen)
 *   - blank / null class → XX (UnClassified)   [the source applies this to Cleared only; Enrolled rows
 *     from VIEW_OURM_FCA already carry ISNULL(CURRENT_CLASS_CDE,'XX') so the outcome is identical]
 *   - fixed display order below; a code outside the list (none observed on staging) is not shown and,
 *     as in the source query, is not part of the Total either.
 */
export interface BreakdownClass {
  cCode: string;
  className: string;
  sortOrder: number;
}

export const BREAKDOWN_CLASSES: readonly BreakdownClass[] = [
  { cCode: "FR", className: "Freshmen", sortOrder: 1 },
  { cCode: "SP", className: "Special", sortOrder: 2 },
  { cCode: "AE", className: "Leap", sortOrder: 3 },
  { cCode: "AD", className: "Academy", sortOrder: 4 },
  { cCode: "XX", className: "UnClassified", sortOrder: 5 },
  { cCode: "JR", className: "Junior", sortOrder: 6 },
  { cCode: "EM", className: "Employee", sortOrder: 7 },
  { cCode: "DI", className: "Dietetic", sortOrder: 8 },
  { cCode: "SO", className: "Sophomore", sortOrder: 9 },
  { cCode: "SR", className: "Senior", sortOrder: 10 },
  { cCode: "TR", className: "Transfer Student", sortOrder: 11 },
  { cCode: "GR", className: "Graduate", sortOrder: 12 },
];

/** Map a raw class code + incoming-transfer flag to a breakdown bucket code. */
export function breakdownCode(rawClass: string | null | undefined, isIncomingTransfer: boolean): string {
  if (isIncomingTransfer) return "TR";
  const c = (rawClass ?? "").trim().toUpperCase();
  if (c === "FF" || c === "FR") return "FR";
  if (c === "") return "XX";
  return c;
}

export interface ClearanceBreakdownRow {
  cCode: string;
  className: string;
  enrolled: number;
  cleared: number;
  notCleared: number;
  /** cleared / enrolled * 100; null when enrolled is 0 (the source prints "0%"). */
  clearedPercent: number | null;
  isTotal: boolean;
}

/** Build the report rows (individual classes + Total) from per-code counts, mirroring ReportData/FinalReport. */
export function buildBreakdown(enrolledByCode: Map<string, number>, clearedByCode: Map<string, number>): ClearanceBreakdownRow[] {
  const rows: ClearanceBreakdownRow[] = BREAKDOWN_CLASSES.map((c) => {
    const enrolled = enrolledByCode.get(c.cCode) ?? 0;
    const cleared = clearedByCode.get(c.cCode) ?? 0;
    return { cCode: c.cCode, className: c.className, enrolled, cleared, notCleared: enrolled - cleared, clearedPercent: pct(cleared, enrolled), isTotal: false };
  });
  const enrolled = rows.reduce((s, r) => s + r.enrolled, 0);
  const cleared = rows.reduce((s, r) => s + r.cleared, 0);
  rows.push({ cCode: "", className: "Total", enrolled, cleared, notCleared: enrolled - cleared, clearedPercent: pct(cleared, enrolled), isTotal: true });
  return rows;
}

function pct(cleared: number, enrolled: number): number | null {
  if (enrolled <= 0) return null;
  return Math.round((cleared * 100 * 100) / enrolled) / 100; // DECIMAL(6,2)
}
