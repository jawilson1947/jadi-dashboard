import type { Principal } from "../authz/permissions";
import { audit } from "../audit/audit";
import { getConfig } from "../db/config";
import { exportFilename, toCsv, csvHeaders, type CsvColumn, EXPORT_MAX_ROWS } from "./export";
import { toXlsx, xlsxHeaders, type XlsxColumn } from "./xlsx";
import { getCurrentTerms } from "../metadata/terms";
import { getDataProvider } from "../repositories";
import { getAppStore } from "../store";
import type { ReportDefinition } from "../reports/definitions";
import { formatDateTime } from "@/lib/format";
import type { ReportSnapshotMeta } from "../reports/snapshot";

/**
 * Report export (Spec §11, A-11, A-31). One column set per report drives both formats, so the CSV
 * and the XLSX of the same report can never carry different columns — the bug that makes people
 * stop trusting exports.
 *
 * The caller needs export.create OR mailmerge.create (R-D3); the route checks that. PID is never
 * in a column set, in either format.
 */

export type ExportFormat = "csv" | "xlsx";

export interface ReportExportColumn<T> {
  header: string;
  /** Typed value. Dates and numbers stay typed in XLSX; the CSV writer stringifies them. */
  value: (row: T) => string | number | boolean | Date | null | undefined;
  width?: number;
}

export interface ReportExportResult {
  filename: string;
  body: string | Buffer;
  headers: Record<string, string>;
  rowCount: number;
  truncated: boolean;
  columns: string[];
}

/**
 * The caption carried into the file. A downloaded report loses the page around it, so the two
 * timestamps (A-30) travel with it — otherwise a spreadsheet mailed to someone else is a set of
 * numbers with no stated age at all.
 */
function caption(def: ReportDefinition, meta: ReportSnapshotMeta, readAt: Date, timeZone: string, filters: string): string {
  const population = meta.missing || !meta.capturedAt ? "not yet captured" : formatDateTime(meta.capturedAt.toISOString(), timeZone);
  const scope = def.termScope === "current" ? "Current semester only" : "Current and previous semester";
  return `${def.title} (${def.ref}) · ${scope} · Population as of ${population} · Names and balances live at ${formatDateTime(readAt.toISOString(), timeZone)}${filters ? ` · Filters: ${filters}` : ""}`;
}

export async function buildReportExport<T>(
  actor: Principal,
  def: ReportDefinition,
  rows: T[],
  columns: ReportExportColumn<T>[],
  options: {
    format: ExportFormat;
    meta: ReportSnapshotMeta;
    readAt: Date;
    /** Human-readable filter description for the caption and the audit row. */
    filters?: string;
    correlationId?: string;
  },
): Promise<ReportExportResult> {
  const timeZone = getConfig().APP_TIMEZONE;
  const terms = await getCurrentTerms(getAppStore(), getDataProvider());
  const now = new Date();
  const base = exportFilename(def.key, terms.current.tradName, now, timeZone);
  const text = caption(def, options.meta, options.readAt, timeZone, options.filters ?? "");

  let result: ReportExportResult;
  if (options.format === "xlsx") {
    const x = await toXlsx(
      rows,
      columns as XlsxColumn<T>[],
      base.replace(/\.csv$/, ".xlsx"),
      { sheetName: def.title, maxRows: EXPORT_MAX_ROWS, caption: text },
    );
    result = { filename: x.filename, body: x.body, headers: xlsxHeaders(x.filename), rowCount: x.rowCount, truncated: x.truncated, columns: x.columns };
  } else {
    // CSV has nowhere to put a caption without corrupting the header row for a mail merge, which is
    // what this file is for. The timestamps go in the filename and the audit row instead.
    const csvColumns: CsvColumn<T>[] = columns.map((c) => ({
      header: c.header,
      value: (row: T) => {
        const v = c.value(row);
        return v instanceof Date ? formatDateTime(v.toISOString(), timeZone).split(",")[0] : v;
      },
    }));
    const c = toCsv(rows, csvColumns, base, EXPORT_MAX_ROWS);
    result = { filename: c.filename, body: c.body, headers: csvHeaders(c.filename), rowCount: c.rowCount, truncated: c.truncated, columns: c.columns };
  }

  // Counts, filters and column names — never the rows themselves (Spec §18). Exports stay on
  // export.create so there is one export log to read rather than two.
  await audit(actor, "export.create", {
    correlationId: options.correlationId,
    targetType: "report",
    targetId: def.key,
    metadata: {
      ref: def.ref,
      format: options.format,
      rowCount: result.rowCount,
      truncated: result.truncated,
      columns: result.columns.length,
      filters: options.filters ?? "none",
      populationCapturedAt: options.meta.capturedAt?.toISOString() ?? null,
    },
  });

  return result;
}
