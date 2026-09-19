import { getConfig } from "../db/config";
import { getDataProvider } from "../repositories";
import type { DataProvider, DnrDncCategory, DnrDncRow } from "../repositories/types";
import { getAppStore } from "../store";
import type { AppStore } from "../store/types";
import { getCurrentTerms } from "../metadata/terms";
import { classificationDisplayName } from "../metadata/classifications";
import { breakdownCode } from "../metadata/clearance-breakdown";
import { audit } from "../audit/audit";
import type { Principal } from "../authz/permissions";
import { maskPid } from "@/lib/format";
import { exportFilename, toCsv, type CsvColumn, type CsvResult } from "./export";

/**
 * DNR/DNC Analysis (Spec §8).
 *
 * The population comes from the provider whole — A-1 scopes it to positive balances, so it is in the
 * low hundreds — and every derived number is computed here: the filtered table, the receivable total
 * in the footer and the exported file all read the same rows, so they cannot disagree.
 *
 * Definitions are A-1's, decided 2026-09-17: DNC = rolled to the current term with the clearance flag
 * still 0; DNR = left on the previous term with the flag still 1 and absent from current enrollment;
 * both require `AccountBalance > 0`. The categories are mutually exclusive.
 */

export interface DnrDncFilter {
  category?: DnrDncCategory;
  /** Bucket code after the A-19 transfer rule (TR, FR, SO, …). */
  classification?: string;
  minBalance?: number;
  maxBalance?: number;
  /**
   * A term code inside the population (Spec §8 "semester" / "last cleared"). Decided 2026-09-18: this
   * narrows within the current-vs-previous population, it does not recompute the rule for a past term.
   */
  lastCleared?: string;
}

export type DnrDncSortField = "default" | "category" | "classification" | "lastName" | "firstName" | "accountBalance" | "idnumber" | "lastCleared";

/** The ten columns Spec §8 requires, plus the resolved classification name (A-11). PID is masked here and absent from exports. */
export interface DnrDncTableRow {
  category: DnrDncCategory;
  classificationCode: string;
  classification: string;
  idnumber: string;
  lastName: string;
  firstName: string;
  accountBalance: number;
  email: string;
  lastCleared: string | null;
  enrolledCurrentTerm: boolean;
  clearedCurrentSession: boolean;
  pidMasked: string;
}

export interface DnrDncView {
  term: { current: string; previous: string; label: string; currentKeys: string[]; previousKeys: string[] };
  /** Both categories over the whole population, unfiltered — the two summary cards. */
  summary: Record<DnrDncCategory, { count: number; positiveBalance: number }>;
  rows: DnrDncTableRow[];
  page: number;
  pageSize: number;
  /** Rows matching the filter (not just this page). */
  totalRows: number;
  /** Spec §8 footer: total positive receivable for the filtered population. */
  filteredReceivable: number;
  filterOptions: {
    classifications: Array<{ code: string; name: string; count: number }>;
    lastCleared: Array<{ code: string; count: number }>;
    balance: { min: number; max: number };
  };
  /** True when the provider's safety cap trimmed the population — shown, never hidden. */
  capped: boolean;
  source: { provider: string; readAt: string };
}

interface Deps {
  provider?: DataProvider;
  store?: AppStore;
  now?: Date;
}

const POPULATION_CAP = 5000;

/** Map a source row to its display shape (A-3 masking, A-19 classification). */
export function toTableRow(s: DnrDncRow): DnrDncTableRow {
  return {
    category: s.category,
    classificationCode: breakdownCode(s.classificationCode, s.isIncomingTransfer),
    classification: classificationDisplayName(s.classificationCode, s.isIncomingTransfer).displayName,
    idnumber: s.idnumber,
    lastName: s.lastName,
    firstName: s.firstName,
    accountBalance: s.accountBalance,
    email: s.email,
    lastCleared: s.lastCleared,
    enrolledCurrentTerm: s.enrolledCurrentTerm,
    clearedCurrentSession: s.status === "Cleared",
    pidMasked: maskPid(s.pid),
  };
}

export function applyFilter(rows: DnrDncTableRow[], f: DnrDncFilter): DnrDncTableRow[] {
  return rows.filter((r) => {
    if (f.category && r.category !== f.category) return false;
    if (f.classification && r.classificationCode !== f.classification) return false;
    if (f.minBalance !== undefined && r.accountBalance < f.minBalance) return false;
    if (f.maxBalance !== undefined && r.accountBalance > f.maxBalance) return false;
    if (f.lastCleared && (r.lastCleared ?? "") !== f.lastCleared) return false;
    return true;
  });
}

/**
 * Spec §8 default order: category, then classification, then last name, then first name.
 * Any single-column sort keeps that order as its tie-breaker, so the table never looks shuffled.
 */
export function sortRows(rows: DnrDncTableRow[], field: DnrDncSortField, direction: "asc" | "desc"): DnrDncTableRow[] {
  const dir = direction === "desc" ? -1 : 1;
  const byDefault = (a: DnrDncTableRow, b: DnrDncTableRow) =>
    a.category.localeCompare(b.category) || a.classification.localeCompare(b.classification) || a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName);
  return [...rows].sort((a, b) => {
    if (field === "default") return byDefault(a, b);
    const primary =
      field === "accountBalance"
        ? a.accountBalance - b.accountBalance
        : String(a[field] ?? "").localeCompare(String(b[field] ?? ""));
    return primary * dir || byDefault(a, b);
  });
}

export function receivableOf(rows: DnrDncTableRow[]): number {
  return Math.round(rows.reduce((sum, r) => sum + Math.max(0, r.accountBalance), 0) * 100) / 100;
}

async function loadPopulation(deps: Deps): Promise<{ rows: DnrDncTableRow[]; capped: boolean; provider: string }> {
  const provider = deps.provider ?? getDataProvider();
  const raw = await provider.getDnrDncPopulation(POPULATION_CAP);
  return { rows: raw.map(toTableRow), capped: raw.length >= POPULATION_CAP, provider: provider.name };
}

export async function getDnrDncView(
  params: { filter?: DnrDncFilter; page?: number; pageSize?: number; sort?: DnrDncSortField; direction?: "asc" | "desc" } = {},
  deps: Deps = {},
): Promise<DnrDncView> {
  const now = deps.now ?? new Date();
  const store = deps.store ?? getAppStore();
  const provider = deps.provider ?? getDataProvider();
  const terms = await getCurrentTerms(store, provider);
  const { rows: all, capped, provider: providerName } = await loadPopulation({ ...deps, provider });

  const summary: DnrDncView["summary"] = {
    DNC: { count: 0, positiveBalance: 0 },
    DNR: { count: 0, positiveBalance: 0 },
  };
  for (const r of all) {
    summary[r.category].count += 1;
    summary[r.category].positiveBalance += Math.max(0, r.accountBalance);
  }
  for (const k of ["DNC", "DNR"] as const) summary[k].positiveBalance = Math.round(summary[k].positiveBalance * 100) / 100;

  const filtered = applyFilter(all, params.filter ?? {});
  const sorted = sortRows(filtered, params.sort ?? "default", params.direction ?? "asc");
  const page = params.page ?? 1;
  const pageSize = params.pageSize ?? 50;
  const start = (page - 1) * pageSize;

  return {
    term: { current: terms.current.tradName, previous: terms.previous.tradName, label: terms.label, currentKeys: terms.currentKeys, previousKeys: terms.previousKeys },
    summary,
    rows: sorted.slice(start, start + pageSize),
    page,
    pageSize,
    totalRows: filtered.length,
    filteredReceivable: receivableOf(filtered),
    filterOptions: buildFilterOptions(all),
    capped,
    source: { provider: providerName, readAt: now.toISOString() },
  };
}

/** Options are derived from the population itself, so a filter can never select an empty set by mistake. */
export function buildFilterOptions(rows: DnrDncTableRow[]): DnrDncView["filterOptions"] {
  const classifications = new Map<string, { code: string; name: string; count: number }>();
  const lastCleared = new Map<string, number>();
  let min = Number.POSITIVE_INFINITY;
  let max = 0;
  for (const r of rows) {
    const c = classifications.get(r.classificationCode) ?? { code: r.classificationCode, name: r.classification, count: 0 };
    c.count += 1;
    classifications.set(r.classificationCode, c);
    const lc = r.lastCleared ?? "";
    lastCleared.set(lc, (lastCleared.get(lc) ?? 0) + 1);
    min = Math.min(min, r.accountBalance);
    max = Math.max(max, r.accountBalance);
  }
  return {
    classifications: [...classifications.values()].sort((a, b) => a.name.localeCompare(b.name)),
    lastCleared: [...lastCleared.entries()].map(([code, count]) => ({ code, count })).sort((a, b) => a.code.localeCompare(b.code)),
    balance: { min: rows.length ? Math.floor(min) : 0, max: rows.length ? Math.ceil(max) : 0 },
  };
}

/** The approved export column list (A-11, decided 2026-09-18). PID appears in no export, in any format. */
export const DNR_DNC_EXPORT_COLUMNS: CsvColumn<DnrDncTableRow>[] = [
  { header: "Category", value: (r) => r.category },
  { header: "Classification code", value: (r) => r.classificationCode },
  { header: "Classification", value: (r) => r.classification },
  { header: "Student ID", value: (r) => r.idnumber },
  { header: "Last name", value: (r) => r.lastName },
  { header: "First name", value: (r) => r.firstName },
  { header: "Account balance", value: (r) => r.accountBalance.toFixed(2) },
  { header: "Email", value: (r) => r.email },
  { header: "Last cleared semester", value: (r) => r.lastCleared ?? "" },
  { header: "Currently enrolled", value: (r) => (r.enrolledCurrentTerm ? "Yes" : "No") },
  { header: "Currently cleared", value: (r) => (r.clearedCurrentSession ? "Yes" : "No") },
];

/**
 * Export the filtered population (Spec §11). Requires export.create, enforced by the caller; the row
 * count, the filter and the column list are audited — never the rows themselves (Spec §18).
 */
export async function exportDnrDnc(
  actor: Principal,
  params: { filter?: DnrDncFilter; sort?: DnrDncSortField; direction?: "asc" | "desc" },
  correlationId?: string,
  deps: Deps = {},
): Promise<CsvResult & { filteredReceivable: number }> {
  const now = deps.now ?? new Date();
  const cfg = getConfig();
  const store = deps.store ?? getAppStore();
  const provider = deps.provider ?? getDataProvider();
  const terms = await getCurrentTerms(store, provider);
  const { rows: all } = await loadPopulation({ ...deps, provider });
  const rows = sortRows(applyFilter(all, params.filter ?? {}), params.sort ?? "default", params.direction ?? "asc");

  const result = toCsv(rows, DNR_DNC_EXPORT_COLUMNS, exportFilename("dnr-dnc", terms.current.tradName, now, cfg.APP_TIMEZONE));
  await audit(actor, "export.create", {
    correlationId,
    targetType: "dnrDnc",
    targetId: terms.current.tradName,
    metadata: {
      kind: "csv",
      rowCount: result.rowCount,
      truncated: result.truncated,
      columns: result.columns.length,
      category: params.filter?.category ?? "all",
      classification: params.filter?.classification ?? "all",
      lastCleared: params.filter?.lastCleared ?? "all",
      minBalance: params.filter?.minBalance ?? null,
      maxBalance: params.filter?.maxBalance ?? null,
    },
  });
  return { ...result, filteredReceivable: receivableOf(rows) };
}
