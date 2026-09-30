import { z } from "zod";
import type { Principal } from "../authz/permissions";
import { getReportDefinition, type ReportDefinition, type ReportKey } from "./definitions";
import type { ReportSnapshotMeta } from "./snapshot";
import {
  getUnclassifiedView,
  getFreshmanView,
  getClearedMoreThanOnceView,
  getEnrolleeBalanceView,
  getCurrentlyClearedView,
  auditReportView,
} from "../services/reports";
import { getDnrDncView, toTableRow } from "../services/dnr-dnc";
import type { ReportExportColumn } from "../services/report-export";
import type { ReportDeps } from "./snapshot";

/**
 * One place that maps a report key to its rows, its export columns and its filter description.
 *
 * The page and the export route both come through here, which is the point: they cannot end up
 * showing and downloading different things, because there is only one function that decides what
 * the rows are.
 */

export const reportParamsSchema = z.object({
  // R4's only parameters. Every other report ignores them.
  minBalance: z.coerce.number().min(0).optional(),
  maxBalance: z.coerce.number().min(0).optional(),
  /** R1's triage filter. */
  group: z.enum(["all", "resolvable", "no-signal"]).default("all"),
  /** R2's "mismatches only" toggle. */
  mismatchesOnly: z
    .union([z.literal("1"), z.literal("true"), z.literal("on"), z.literal(""), z.undefined()])
    .transform((v) => v === "1" || v === "true" || v === "on")
    .optional(),
});

export type ReportParams = z.infer<typeof reportParamsSchema>;

export interface ResolvedReport {
  definition: ReportDefinition;
  rows: Record<string, unknown>[];
  columns: ReportExportColumn<Record<string, unknown>>[];
  meta: ReportSnapshotMeta;
  readAt: Date;
  /** Human-readable, for the export caption and the audit row. */
  filters: string;
}

const LIVE_META: ReportSnapshotMeta = {
  capturedAt: null,
  rowCount: null,
  sourceProvider: null,
  missing: false,
  ageMinutes: 0,
  stale: false,
};

/**
 * Export column sets (A-11). PID appears in none of them, in any format. Dates stay Date objects so
 * XLSX writes a real date cell; the CSV writer formats them on the way out.
 */
type Col = ReportExportColumn<Record<string, unknown>>;
const col = (header: string, key: string, width?: number): Col =>
  ({ header, value: (r) => r[key] as string | number | boolean | Date | null | undefined, width });

export async function resolveReport(
  key: ReportKey,
  params: ReportParams,
  actor: Principal,
  correlationId: string,
  deps: ReportDeps = {},
): Promise<ResolvedReport> {
  const definition = getReportDefinition(key);
  if (!definition) throw new Error(`Unknown report ${key}`);

  let rows: Record<string, unknown>[] = [];
  let columns: Col[] = [];
  let meta: ReportSnapshotMeta = LIVE_META;
  let readAt = new Date();
  let filters = "";

  switch (key) {
    case "unclassified": {
      const view = await getUnclassifiedView(deps);
      const all = view.rows;
      rows = (params.group === "all" ? all : all.filter((r) => r.group === params.group)) as unknown as Record<string, unknown>[];
      columns = [
        col("Class code", "classCode", 12),
        col("Student ID", "idnumber", 14),
        col("Last name", "lastName", 20),
        col("First name", "firstName", 20),
        col("Resolvable as", "resolvableName", 20),
        col("Status", "status", 14),
        col("Balance", "accountBalance", 14),
        col("Email", "email", 32),
      ];
      meta = view.meta;
      readAt = view.contactsReadAt;
      filters = params.group === "all" ? "" : `group=${params.group}`;
      break;
    }
    case "freshman-analysis": {
      const view = await getFreshmanView(deps);
      const all = view.rows;
      rows = (params.mismatchesOnly ? all.filter((r) => r.mismatch) : all) as unknown as Record<string, unknown>[];
      columns = [
        col("Class code", "classCode", 12),
        col("Student ID", "idnumber", 14),
        col("Last name", "lastName", 20),
        col("First name", "firstName", 20),
        col("Balance", "accountBalance", 14),
        col("Web code", "webCode", 10),
        col("Most recent year enrolled", "mostRecentYearEnrolled", 14),
        col("Current class code", "currentClassCode", 14),
        col("Date created", "dateCreated", 14),
        col("Semester start", "semesterBegins", 14),
        col("Derived class", "derivedClass", 12),
        { header: "Mismatch", value: (r) => (r.mismatch ? "Yes" : "No"), width: 10 },
      ];
      meta = view.meta;
      readAt = view.contactsReadAt;
      filters = params.mismatchesOnly ? "mismatches only" : "";
      break;
    }
    case "cleared-more-than-once": {
      const view = await getClearedMoreThanOnceView(deps);
      rows = view.groups.flatMap((g) => g.actions) as unknown as Record<string, unknown>[];
      columns = [
        col("Class", "classification", 18),
        col("Student ID", "idnumber", 14),
        col("Last name", "lastName", 20),
        col("First name", "firstName", 20),
        col("Action", "actionNo", 8),
        col("Of", "actionCount", 8),
        col("Date cleared", "dateCleared", 14),
        col("Cleared by", "clearedBy", 16),
      ];
      meta = view.meta;
      readAt = view.contactsReadAt;
      break;
    }
    case "enrollee-balance": {
      const range = { min: params.minBalance ?? 0.01, max: params.maxBalance ?? Number.MAX_SAFE_INTEGER };
      const view = await getEnrolleeBalanceView(range, deps);
      rows = view.rows as unknown as Record<string, unknown>[];
      columns = [
        col("Student ID", "idnumber", 14),
        col("Class", "classification", 18),
        col("Last name", "lastName", 20),
        col("First name", "firstName", 20),
        col("Balance", "accountBalance", 14),
        col("Email", "email", 32),
      ];
      meta = view.meta;
      readAt = view.contactsReadAt;
      filters = `balance ${range.min} to ${range.max === Number.MAX_SAFE_INTEGER ? "unlimited" : range.max}`;
      break;
    }
    case "dnc-dnr-collection": {
      // R-D6: the shipped DNR/DNC population, not a seventh query, so the letters and the dashboard
      // card can never disagree. pageSize is the population cap — this report is the whole list.
      const view = await getDnrDncView({ page: 1, pageSize: 5000 }, deps);
      rows = view.rows as unknown as Record<string, unknown>[];
      columns = [
        col("Category", "category", 10),
        col("Student ID", "idnumber", 14),
        col("Last name", "lastName", 20),
        col("First name", "firstName", 20),
        col("Email", "email", 32),
        col("Balance", "accountBalance", 14),
        col("Last cleared", "lastCleared", 14),
      ];
      readAt = new Date(view.source.readAt);
      break;
    }
    case "currently-cleared": {
      const view = await getCurrentlyClearedView(deps);
      rows = view.rows as unknown as Record<string, unknown>[];
      columns = [
        col("Class", "classification", 18),
        col("Class code", "rawClassCode", 12),
        col("Student ID", "idnumber", 14),
        col("Last name", "lastName", 20),
        col("First name", "firstName", 20),
        col("Date cleared", "dateCleared", 14),
        col("Email", "email", 32),
      ];
      meta = view.meta;
      readAt = view.contactsReadAt;
      break;
    }
  }

  await auditReportView(actor, definition, rows.length, correlationId);
  return { definition, rows, columns, meta, readAt, filters };
}

export { toTableRow };
