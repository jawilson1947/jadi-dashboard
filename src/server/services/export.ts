/**
 * Export core (Spec §11, §18; ASSUMPTIONS A-11).
 *
 * CSV only in Phase 3b — XLSX arrives with the report catalog in Phase 7. Three rules matter more
 * than the format:
 *   1. A cell that could be read as a formula is neutralised. Spreadsheets execute `=`, `+`, `-`, `@`
 *      and the two control characters below on open, which is how an exported list becomes an attack
 *      on whoever opens it (CSV injection). Every such cell is prefixed with an apostrophe.
 *   2. The file is UTF-8 with a BOM, because Excel otherwise reads it as the local code page and
 *      mangles names.
 *   3. Exports are capped and audited by the caller — never a silent full-table dump.
 */

/** Characters a spreadsheet may treat as the start of a formula. */
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

export function csvCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (FORMULA_PREFIX.test(text)) text = `'${text}`;
  if (/[",\n\r]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

export interface CsvColumn<T> {
  /** Header text exactly as it should appear in the file. */
  header: string;
  value: (row: T) => string | number | boolean | null | undefined;
}

export interface CsvResult {
  filename: string;
  /** UTF-8 text including the BOM; hand straight to a Response body. */
  body: string;
  rowCount: number;
  /** True when the row cap trimmed the result — the caller must say so in the UI. */
  truncated: boolean;
  columns: string[];
}

export const EXPORT_MAX_ROWS = 10_000;

/** CRLF line endings: the CSV RFC's, and what Excel expects. */
export function toCsv<T>(rows: T[], columns: CsvColumn<T>[], filename: string, maxRows = EXPORT_MAX_ROWS): CsvResult {
  const capped = rows.slice(0, maxRows);
  const lines = [columns.map((c) => csvCell(c.header)).join(",")];
  for (const row of capped) lines.push(columns.map((c) => csvCell(c.value(row))).join(","));
  return {
    filename,
    body: `﻿${lines.join("\r\n")}\r\n`,
    rowCount: capped.length,
    truncated: rows.length > capped.length,
    columns: columns.map((c) => c.header),
  };
}

/** `dnr-dnc-FA2026-20260918-1432.csv` — sortable, and it says what it holds without being opened. */
export function exportFilename(kind: string, termKey: string, now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${kind}-${termKey}-${get("year")}${get("month")}${get("day")}-${get("hour")}${get("minute")}.csv`;
}

/** Headers that make a browser save the file instead of rendering it. */
export function csvHeaders(filename: string): Record<string, string> {
  return {
    "content-type": "text/csv; charset=utf-8",
    "content-disposition": `attachment; filename="${filename.replace(/"/g, "")}"`,
    "cache-control": "no-store",
  };
}
