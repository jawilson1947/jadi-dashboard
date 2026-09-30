import ExcelJS from "exceljs";
import type { CsvColumn } from "./export";

/**
 * XLSX export (A-31, Spec §11). The CSV writer in ./export.ts stays the reference for the rules;
 * this applies the same three to a workbook.
 *
 * Formula injection is handled differently here, and the difference matters. CSV has no types, so
 * a dangerous cell is neutralised by prefixing an apostrophe. A worksheet cell has a type, so the
 * same cell is written as an explicit **string** cell: Excel then displays the text and never
 * evaluates it, and — unlike the CSV trick — the apostrophe is not part of the value the recipient
 * sees or pastes. Both produce a file that cannot attack whoever opens it.
 *
 * PID is never exported, in any format (A-11). That is enforced by the column sets the callers
 * pass, and asserted in tests rather than left to review.
 */

/** Characters a spreadsheet may treat as the start of a formula — same set as the CSV writer. */
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

export interface XlsxResult {
  filename: string;
  body: Buffer;
  rowCount: number;
  truncated: boolean;
  columns: string[];
}

export interface XlsxOptions {
  /** Worksheet name. Excel forbids : \ / ? * [ ] and caps it at 31 characters. */
  sheetName?: string;
  maxRows?: number;
  /** Printed above the header as a note — used for the snapshot/live timestamps (A-30). */
  caption?: string;
}

function sanitizeSheetName(name: string): string {
  return (name.replace(/[:\\/?*[\]]/g, " ").trim() || "Report").slice(0, 31);
}

/**
 * Typed cells where the value is typed. A number written as a number sorts and sums in Excel;
 * written as text it does neither, which is the most common complaint about exported reports.
 */
function writeCell(cell: ExcelJS.Cell, value: string | number | boolean | Date | null | undefined): void {
  if (value === null || value === undefined) {
    cell.value = null;
    return;
  }
  if (value instanceof Date) {
    cell.value = value;
    cell.numFmt = "mm/dd/yyyy";
    return;
  }
  if (typeof value === "number") {
    cell.value = Number.isFinite(value) ? value : null;
    return;
  }
  if (typeof value === "boolean") {
    cell.value = value;
    return;
  }
  // A string that could be read as a formula is written as a string cell, which Excel never
  // evaluates. `cell.value = "=..."` alone would be stored as text by ExcelJS, but being explicit
  // here is what makes the guarantee reviewable instead of incidental.
  cell.value = FORMULA_PREFIX.test(value) ? { richText: [{ text: value }] } : value;
}

export interface XlsxColumn<T> extends Omit<CsvColumn<T>, "value"> {
  value: (row: T) => string | number | boolean | Date | null | undefined;
  /** Approximate character width; ExcelJS has no autofit. */
  width?: number;
}

export async function toXlsx<T>(
  rows: T[],
  columns: XlsxColumn<T>[],
  filename: string,
  options: XlsxOptions = {},
): Promise<XlsxResult> {
  const maxRows = options.maxRows ?? 10_000;
  const capped = rows.slice(0, maxRows);

  const wb = new ExcelJS.Workbook();
  wb.created = new Date();
  const ws = wb.addWorksheet(sanitizeSheetName(options.sheetName ?? "Report"));

  if (options.caption) {
    // The caption carries the two timestamps a report page shows (A-30). Without it a downloaded
    // file loses the distinction between a captured population and a live balance entirely.
    const note = ws.addRow([options.caption]);
    note.font = { italic: true, size: 9 };
    ws.addRow([]);
  }

  const header = ws.addRow(columns.map((c) => c.header));
  header.font = { bold: true };
  header.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFEFEF" } };
  });
  ws.views = [{ state: "frozen", ySplit: header.number }];
  ws.autoFilter = { from: { row: header.number, column: 1 }, to: { row: header.number, column: columns.length } };
  columns.forEach((c, i) => {
    ws.getColumn(i + 1).width = c.width ?? Math.max(12, Math.min(40, c.header.length + 4));
  });

  for (const row of capped) {
    const added = ws.addRow([]);
    columns.forEach((c, i) => writeCell(added.getCell(i + 1), c.value(row)));
  }

  const buffer = await wb.xlsx.writeBuffer();
  return {
    filename,
    body: Buffer.from(buffer),
    rowCount: capped.length,
    truncated: rows.length > capped.length,
    columns: columns.map((c) => c.header),
  };
}

/** Headers that make a browser save the workbook rather than try to render it. */
export function xlsxHeaders(filename: string): Record<string, string> {
  return {
    "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "content-disposition": `attachment; filename="${filename.replace(/"/g, "")}"`,
    "cache-control": "no-store",
  };
}
