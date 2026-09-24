import { getDataProvider } from "../repositories";
import { getAppStore } from "../store";
import type { AppStore } from "../store/types";
import type { DataProvider, StudentKey, TransactionRow, TransactionScope } from "../repositories/types";

/**
 * Transaction cards (Spec §10.3, Bio Spec card 2).
 *
 * Two sources, deliberately (D-1): `current` is the co-located jadi copy, `global` is the whole
 * history behind the linked server A-24 has not yet cleared. Both arrive as raw rows; the source-code
 * labels are an admin-editable setting rather than a CASE in SQL (A-28), so a new code can be named
 * without a deployment — and an unmapped code shows as itself rather than being folded into
 * "Miscellaneous", where it would disappear.
 */

export const SOURCE_LABELS_SETTING = "transactionSourceLabels";

/** Rows per page within a year (Bio Spec 2.1). Ten, by decision 2026-09-24 (Jim). */
export const TRANSACTIONS_PAGE_SIZE = 10;

/**
 * Seeded from the Bio Spec's CASE. The spec's `'IV’` carries a typographic quote; the code is `IV`.
 *
 * The last two are NOT in the spec — its CASE ends `else SOURCE_CDE`, so they were rendering as raw
 * codes. They were named from the data during 5c validation (2026-09-24): `JL` posts adjustments and
 * their reversals against prior-year aid, `CV` carries pre-2010 rows that look like ordinary tuition,
 * fees and refunds and stop when the legacy system did. The names are descriptive only: the cash and
 * financial-aid RATIOS still key on `RC` and `FA` alone, so an old account whose aid was posted under
 * `CV` or adjusted under `JL` reports a financial-aid ratio lower than reality. Changing that needs a
 * business decision, not a label.
 */
export const DEFAULT_SOURCE_LABELS: Record<string, string> = {
  FA: "Financial Aid",
  RC: "Cash or Credit Card",
  CG: "Tuition Related Charge",
  BN: "Incidentals",
  LB: "Payroll Deduction",
  IV: "Refund",
  MS: "Miscellaneous",
  JL: "Journal Adjustment",
  CV: "Converted (legacy system)",
};

export async function getSourceLabels(store: AppStore = getAppStore()): Promise<Record<string, string>> {
  const stored = await store.getSetting<Record<string, string>>(SOURCE_LABELS_SETTING);
  return { ...DEFAULT_SOURCE_LABELS, ...(stored ?? {}) };
}

export function labelFor(sourceCode: string, labels: Record<string, string>): string {
  const code = (sourceCode ?? "").trim().toUpperCase();
  return labels[code] ?? (code || "—");
}

export interface TransactionViewRow extends TransactionRow {
  sourceLabel: string;
  /** True when the code has no mapping — rendered as the raw code and counted in `unmappedCodes`. */
  unmapped: boolean;
}

export interface TransactionYear {
  year: string;
  rows: number;
  debits: number;
  credits: number;
}

export interface TransactionsView {
  scope: TransactionScope;
  /** Rows for the selected year and page, newest first. */
  rows: TransactionViewRow[];
  /** Bio Spec 2.1 — one entry per year present in the history, newest first. */
  years: TransactionYear[];
  year: string | null;
  page: number;
  pageSize: number;
  totalRows: number;
  /** Totals over the WHOLE history, not the page — a page total would mislead. */
  allRows: number;
  unmappedCodes: string[];
}

export interface TransactionsQuery {
  scope: TransactionScope;
  year?: string;
  page?: number;
  pageSize?: number;
}

export async function getTransactionsView(
  id: StudentKey,
  query: TransactionsQuery,
  provider: DataProvider = getDataProvider(),
  store: AppStore = getAppStore(),
): Promise<TransactionsView> {
  const [raw, labels] = await Promise.all([provider.getStudentTransactions(id, query.scope), getSourceLabels(store)]);
  const rows = raw
    .map((r) => {
      const code = (r.sourceCode ?? "").trim().toUpperCase();
      const known = Object.prototype.hasOwnProperty.call(labels, code);
      return { ...r, sourceLabel: labelFor(code, labels), unmapped: !known && code !== "" };
    })
    .sort((a, b) => b.postedOn.localeCompare(a.postedOn));

  const years = summarizeYears(rows);
  // Bio Spec 2.1: pagination is per year of transactions. Default to the newest year with activity.
  const year = query.year ?? years[0]?.year ?? null;
  const inYear = year ? rows.filter((r) => r.postedOn.slice(0, 4) === year) : rows;
  const pageSize = Math.min(Math.max(query.pageSize ?? TRANSACTIONS_PAGE_SIZE, 5), 200);
  const page = Math.max(query.page ?? 1, 1);
  const start = (page - 1) * pageSize;

  return {
    scope: query.scope,
    rows: inYear.slice(start, start + pageSize),
    years,
    year,
    page,
    pageSize,
    totalRows: inYear.length,
    allRows: rows.length,
    unmappedCodes: [...new Set(rows.filter((r) => r.unmapped).map((r) => r.sourceCode.trim().toUpperCase()))].sort(),
  };
}

export function summarizeYears(rows: TransactionRow[]): TransactionYear[] {
  const byYear = new Map<string, TransactionYear>();
  for (const r of rows) {
    const year = r.postedOn.slice(0, 4);
    if (!year) continue;
    const entry = byYear.get(year) ?? { year, rows: 0, debits: 0, credits: 0 };
    entry.rows += 1;
    if (r.amount >= 0) entry.debits = round2(entry.debits + r.amount);
    else entry.credits = round2(entry.credits + Math.abs(r.amount));
    byYear.set(year, entry);
  }
  return [...byYear.values()].sort((a, b) => b.year.localeCompare(a.year));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
