import type { DataProvider } from "../repositories/types";
import type { JobKey, MetricFamily } from "../store/types";

/**
 * The report catalog (docs/REPORTS-PLAN.md §4.1). One definition per report; the shared page,
 * the catalog, the routes and the worker jobs are all driven from this list, so report seven is
 * a definition rather than another page.
 *
 * `capture` is the slow half — it runs in the worker and produces the snapshot payload (an ID list
 * plus derived codes, A-30). The live half, and everything the page computes from it, lives in
 * src/server/services/reports.ts.
 */

export const REPORT_KEYS = [
  "unclassified",
  "freshman-analysis",
  "cleared-more-than-once",
  "enrollee-balance",
  "dnc-dnr-collection",
  "currently-cleared",
] as const;

export type ReportKey = (typeof REPORT_KEYS)[number];

export interface ReportDefinition {
  key: ReportKey;
  /** Report number in the Report Spec, used in headings and file names. */
  ref: "R1" | "R2" | "R3" | "R4" | "R5" | "R6";
  title: string;
  /** One line for the catalog card. */
  blurb: string;
  /** The supplied script this was derived from, kept verbatim in docs/validation-sql/reports/. */
  sourceScript: string;
  /**
   * Which terms the report can cover (R-D2). `current` means the source objects are scoped to
   * tblOUSA.isCurrent = 1 and no previous-term variant is possible; the page says so rather than
   * offering a selector that would silently return current-term data.
   */
  termScope: "current" | "current+previous";
  /**
   * Snapshot-backed reports name their family and job. A `live` report reads a fast query on every
   * request and has neither — R5 reuses the DNR/DNC population, which is already sub-second.
   */
  family: MetricFamily | null;
  jobKey: JobKey | null;
  defaultCron: string | null;
  minIntervalMinutes: number;
  capture: ((provider: DataProvider) => Promise<{ payload: unknown; rowCount: number }>) | null;
}

export const REPORT_DEFINITIONS: readonly ReportDefinition[] = [
  {
    key: "unclassified",
    ref: "R1",
    title: "Unclassified Students",
    blurb: "Accounts whose classification is missing or unrecognised",
    sourceScript: "GetUnclassifiedStudents.sql",
    termScope: "current",
    family: "reportUnclassified",
    jobKey: "report.unclassified",
    // 02:15 — the slowest of the five, run well away from the 21:00 SQL Agent job.
    defaultCron: "15 2 * * *",
    minIntervalMinutes: 10,
    async capture(provider) {
      const rows = await provider.getUnclassifiedPopulation();
      return { payload: rows, rowCount: rows.length };
    },
  },
  {
    key: "freshman-analysis",
    ref: "R2",
    title: "Freshman Classification Analysis",
    blurb: "FF/FR codes against the Global Student Code in Student Master",
    sourceScript: "FreshmanWebCodeAnalysis.sql",
    // Current AND previous: R2 reads tblStudent/student_master against tblOUSA directly, never the
    // current-term-only VIEW_OURM_* views, so widening the tblOUSA join to isCurrent = 1 OR
    // wasCurrent = 1 genuinely covers both terms (R-D2a). Each term keeps its own SemesterBegins.
    termScope: "current+previous",
    family: "reportFreshmanAnalysis",
    jobKey: "report.freshmanAnalysis",
    // Cheap, and classification churns through registration.
    defaultCron: "0 */4 * * *",
    minIntervalMinutes: 30,
    async capture(provider) {
      const rows = await provider.getFreshmanAnalysis();
      return { payload: rows, rowCount: rows.length };
    },
  },
  {
    key: "cleared-more-than-once",
    ref: "R3",
    title: "Students Cleared More Than Once",
    blurb: "Students with more than one clearance action this term",
    sourceScript: "StudentsClearedMoreThanOnce.sql",
    termScope: "current",
    family: "reportClearedMoreThanOnce",
    jobKey: "report.clearedMoreThanOnce",
    defaultCron: "35 2 * * *",
    minIntervalMinutes: 10,
    async capture(provider) {
      const rows = await provider.getClearedMoreThanOncePopulation();
      return { payload: rows, rowCount: rows.length };
    },
  },
  {
    key: "enrollee-balance",
    ref: "R4",
    title: "Enrollee Account Balance",
    blurb: "Not-cleared enrollees within a debit balance range",
    sourceScript: "fcaAccountBalanceMailMerge.sql",
    termScope: "current",
    family: "reportEnrolleeBalance",
    jobKey: "report.enrolleeBalance",
    defaultCron: "45 2 * * *",
    minIntervalMinutes: 10,
    async capture(provider) {
      const rows = await provider.getEnrolleeBalancePopulation();
      return { payload: rows, rowCount: rows.length };
    },
  },
  {
    key: "dnc-dnr-collection",
    ref: "R5",
    title: "DNC/DNR Collection",
    blurb: "Debit balances that did not clear or did not return",
    sourceScript: "DNC_DNR_CollectionMailMerge.sql",
    // The only report that covers both terms: it reads tblStudent.LastCleared against the
    // isCurrent and wasCurrent rows rather than the current-term-only views (R-D2).
    termScope: "current+previous",
    // Live: reuses the shipped DNR/DNC population so the letters and the dashboard card can never
    // disagree about who owes money (R-D6). No snapshot, no job.
    family: null,
    jobKey: null,
    defaultCron: null,
    minIntervalMinutes: 0,
    capture: null,
  },
  {
    key: "currently-cleared",
    ref: "R6",
    title: "Currently Cleared",
    blurb: "Financially cleared students, by classification",
    sourceScript: "CurrentlyCleared.sql",
    termScope: "current",
    family: "reportCurrentlyCleared",
    jobKey: "report.currentlyCleared",
    // Watched closely during the sprint; the admin screen is where that gets turned up.
    defaultCron: "55 2 * * *",
    minIntervalMinutes: 10,
    async capture(provider) {
      const rows = await provider.getCurrentlyClearedPopulation();
      return { payload: rows, rowCount: rows.length };
    },
  },
];

export function getReportDefinition(key: string): ReportDefinition | null {
  return REPORT_DEFINITIONS.find((r) => r.key === key) ?? null;
}

/** Snapshot-backed reports only — what the worker schedules and the catalog shows an age for. */
export function snapshotReports(): ReportDefinition[] {
  return REPORT_DEFINITIONS.filter((r) => r.family !== null && r.jobKey !== null);
}
