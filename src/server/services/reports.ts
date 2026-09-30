import type {
  ClearedActionRow,
  CurrentlyClearedRow,
  EnrolleeBalanceRow,
  FreshmanAnalysisRow,
  StudentContactRow,
  UnclassifiedRow,
} from "../repositories/types";
import { classificationDisplayName } from "../metadata/classifications";
import { getReportDefinition, type ReportDefinition, type ReportKey } from "../reports/definitions";
import { loadContacts, loadSnapshotRows, type ReportDeps, type ReportSnapshotMeta } from "../reports/snapshot";
import { audit } from "../audit/audit";
import type { Principal } from "../authz/permissions";

/**
 * Report services (docs/REPORTS-PLAN.md).
 *
 * Every report follows the same two-step shape: read the captured population, then join the live
 * student rows onto it (A-30). Totals, filters and the exported file are all computed from the same
 * joined array, so the table, the footer and the download cannot disagree — the discipline the
 * DNR/DNC page established in Phase 3b.
 */

/** The columns every report row carries, whatever the report. PID is never among them (A-11). */
export interface ReportRowBase {
  idnumber: string;
  lastName: string;
  firstName: string;
  email: string | null;
  accountBalance: number;
}

function joinContacts<T extends { idnumber: string }>(
  rows: T[],
  contacts: Map<string, StudentContactRow>,
): (T & ReportRowBase)[] {
  return rows.map((r) => {
    const c = contacts.get(r.idnumber);
    return {
      ...r,
      idnumber: r.idnumber,
      // A student present in the captured population but absent from tblStudent keeps their row and
      // their id: dropping them would quietly change a count the summary has already reported.
      lastName: c?.lastName ?? "",
      firstName: c?.firstName ?? "",
      email: c?.email ?? null,
      accountBalance: c?.accountBalance ?? 0,
    };
  });
}

function byName(a: ReportRowBase, b: ReportRowBase): number {
  return a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/* ──────────────────────────── R1 — Unclassified Students ──────────────────────────── */

export type UnclassifiedGroup = "resolvable" | "no-signal";

export interface UnclassifiedTableRow extends UnclassifiedRow, ReportRowBase {
  /** Display name for `resolvableAs`, or null when nothing resolves it. */
  resolvableName: string | null;
  group: UnclassifiedGroup;
}

/** One row per unrecognised code — the finding, as opposed to the worklist (REPORTS-PLAN §4.2). */
export interface UnclassifiedCodeSummary {
  /** The code exactly as stored; "" is rendered "(blank)" by the page, never silently dropped. */
  code: string;
  students: number;
  resolvable: number;
  /**
   * True when the code is non-blank and simply is not in the mapping table — someone has added a
   * class code to the source the application has never heard of. One fix, however many students.
   */
  unknownCode: boolean;
}

export interface UnclassifiedView {
  summary: UnclassifiedCodeSummary[];
  rows: UnclassifiedTableRow[];
  totals: { students: number; codes: number; resolvable: number; noSignal: number; debitBalance: number };
  meta: ReportSnapshotMeta;
  contactsReadAt: Date;
}

/**
 * A record is resolvable when the A-19 reading says something the raw class code does not — today
 * that means TEL_WEB_GRP_CDE = 22 → Transfer Student. Anything else needs a human lookup, which is
 * why the two groups are shown apart and no-signal sorts first (R-D5).
 */
export function unclassifiedGroup(row: UnclassifiedRow): UnclassifiedGroup {
  const raw = (row.classCode ?? "").trim().toUpperCase();
  const resolved = (row.resolvableAs ?? "").trim().toUpperCase();
  return resolved !== "" && resolved !== "XX" && resolved !== raw ? "resolvable" : "no-signal";
}

export function buildUnclassifiedSummary(rows: UnclassifiedTableRow[], known: readonly string[]): UnclassifiedCodeSummary[] {
  const byCode = new Map<string, UnclassifiedCodeSummary>();
  for (const r of rows) {
    const code = (r.classCode ?? "").trim().toUpperCase();
    const entry = byCode.get(code) ?? { code, students: 0, resolvable: 0, unknownCode: code !== "" && !known.includes(code) };
    entry.students += 1;
    if (r.group === "resolvable") entry.resolvable += 1;
    byCode.set(code, entry);
  }
  // Unknown codes first — a code the mapping table has never seen is the more urgent of the two.
  return [...byCode.values()].sort((a, b) => Number(b.unknownCode) - Number(a.unknownCode) || b.students - a.students || a.code.localeCompare(b.code));
}

const KNOWN_CLASS_CODES = ["AD", "AE", "EM", "FF", "FR", "GR", "JR", "SO", "SR", "DI"];

export async function getUnclassifiedView(deps: ReportDeps = {}): Promise<UnclassifiedView> {
  const def = requireReport("unclassified");
  const loaded = await loadSnapshotRows<UnclassifiedRow>(def, deps);
  const contacts = await loadContacts(loaded.rows.map((r) => r.idnumber), deps);
  const rows: UnclassifiedTableRow[] = joinContacts(loaded.rows, contacts)
    .map((r) => {
      const group = unclassifiedGroup(r);
      return {
        ...r,
        group,
        resolvableName: group === "resolvable" ? classificationDisplayName(r.resolvableAs).displayName : null,
      };
    })
    // Worst first: this is a worklist, and the records nobody can resolve from data are the ones
    // that need a person. Then by code, so one bad code's students stay together.
    .sort((a, b) => Number(a.group === "resolvable") - Number(b.group === "resolvable") || a.classCode.localeCompare(b.classCode) || byName(a, b));

  const summary = buildUnclassifiedSummary(rows, KNOWN_CLASS_CODES);
  return {
    summary,
    rows,
    totals: {
      students: rows.length,
      codes: summary.length,
      resolvable: rows.filter((r) => r.group === "resolvable").length,
      noSignal: rows.filter((r) => r.group === "no-signal").length,
      debitBalance: round2(rows.reduce((t, r) => t + Math.max(0, r.accountBalance), 0)),
    },
    meta: loaded.meta,
    contactsReadAt: loaded.contactsReadAt,
  };
}

/* ────────────────────── R2 — Freshman Classification Analysis ────────────────────── */

export interface FreshmanTableRow extends FreshmanAnalysisRow, ReportRowBase {}

/** One bar of the boundary panel: records created in a week, and how many of them mismatch. */
export interface CreationBucket {
  /** Week start, YYYY-MM-DD. */
  weekOf: string;
  created: number;
  mismatches: number;
  /** True for the bucket containing SemesterBegins — where the page draws the line. */
  containsBoundary: boolean;
}

export interface WhatIfPoint {
  /** Candidate SemesterBegins, YYYY-MM-DD. */
  date: string;
  mismatches: number;
}

/**
 * One semester's slice of R2. The report covers the current AND previous term (R-D2a), and each
 * tblOUSA row carries its OWN SemesterBegins, so the boundary chart and the what-if are per-term:
 * moving the current term's start date does nothing to the previous term's mismatches, and a
 * single combined boundary would be a date that belongs to neither.
 */
export interface FreshmanTermGroup {
  semesterName: string;
  isCurrentTerm: boolean;
  semesterBegins: Date | null;
  students: number;
  mismatches: number;
  buckets: CreationBucket[];
  whatIf: WhatIfPoint[];
}

export interface FreshmanView {
  rows: FreshmanTableRow[];
  /** Current term first, then previous. Empty terms are not carried. */
  terms: FreshmanTermGroup[];
  /** Across both terms. */
  mismatches: number;
  meta: ReportSnapshotMeta;
  contactsReadAt: Date;
}

/**
 * Recompute the mismatch count as if SemesterBegins were `candidate` (R-D7).
 *
 * This is the report's most useful output and it costs a loop: DateCreated is already in the
 * captured population, so moving the boundary is arithmetic rather than another 40-second query.
 * It answers the question a bare count cannot — whether the date is wrong or the records are.
 */
export function mismatchesAt(rows: FreshmanAnalysisRow[], candidate: Date): number {
  let n = 0;
  for (const r of rows) {
    if (!r.dateCreated) continue;
    const derived = r.dateCreated > candidate ? "FF" : "FR";
    if (r.classCode.toUpperCase() !== derived) n += 1;
  }
  return n;
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function weekStart(d: Date): Date {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  x.setUTCDate(x.getUTCDate() - x.getUTCDay());
  return x;
}

export function buildCreationBuckets(rows: FreshmanAnalysisRow[], boundary: Date | null): CreationBucket[] {
  const byWeek = new Map<string, CreationBucket>();
  const boundaryWeek = boundary ? isoDay(weekStart(boundary)) : null;
  for (const r of rows) {
    if (!r.dateCreated) continue;
    const key = isoDay(weekStart(r.dateCreated));
    const b = byWeek.get(key) ?? { weekOf: key, created: 0, mismatches: 0, containsBoundary: key === boundaryWeek };
    b.created += 1;
    if (r.mismatch) b.mismatches += 1;
    byWeek.set(key, b);
  }
  return [...byWeek.values()].sort((a, b) => a.weekOf.localeCompare(b.weekOf));
}

/**
 * Candidate boundaries to price: a fortnight either side of the current one, in one-week steps.
 * Deliberately a short list — the page recommends, it does not let someone scan for a minimum,
 * because SemesterBegins is shared with term metadata and the historical pairing (REPORTS-PLAN §9).
 */
export function buildWhatIf(rows: FreshmanAnalysisRow[], boundary: Date | null): WhatIfPoint[] {
  if (!boundary) return [];
  const out: WhatIfPoint[] = [];
  for (const offsetDays of [-14, -7, 0, 7, 14]) {
    const d = new Date(boundary.getTime() + offsetDays * 24 * 3600 * 1000);
    out.push({ date: isoDay(d), mismatches: mismatchesAt(rows, d) });
  }
  return out;
}

export async function getFreshmanView(deps: ReportDeps = {}): Promise<FreshmanView> {
  const def = requireReport("freshman-analysis");
  const loaded = await loadSnapshotRows<FreshmanAnalysisRow>(def, deps);
  // Dates survive JSON as strings; rehydrate before any comparison or the boundary test is a no-op.
  const population = loaded.rows.map((r) => ({
    ...r,
    dateCreated: r.dateCreated ? new Date(r.dateCreated) : null,
    semesterBegins: r.semesterBegins ? new Date(r.semesterBegins) : null,
  }));
  const contacts = await loadContacts(population.map((r) => r.idnumber), deps);
  const rows = joinContacts(population, contacts);
  return {
    rows,
    terms: buildFreshmanTerms(population),
    mismatches: population.filter((r) => r.mismatch).length,
    meta: loaded.meta,
    contactsReadAt: loaded.contactsReadAt,
  };
}

/**
 * Split the population by its tblOUSA row and build each term's own boundary view. Grouping is by
 * semesterName because that is what the user sees; isCurrentTerm only orders the groups.
 */
export function buildFreshmanTerms(population: FreshmanAnalysisRow[]): FreshmanTermGroup[] {
  const byTerm = new Map<string, FreshmanAnalysisRow[]>();
  for (const r of population) {
    const key = r.semesterName || (r.isCurrentTerm ? "Current semester" : "Previous semester");
    const bucket = byTerm.get(key);
    if (bucket) bucket.push(r);
    else byTerm.set(key, [r]);
  }
  return [...byTerm.entries()]
    .map(([semesterName, termRows]) => {
      const begins = termRows.find((r) => r.semesterBegins)?.semesterBegins ?? null;
      return {
        semesterName,
        isCurrentTerm: termRows[0].isCurrentTerm,
        semesterBegins: begins,
        students: termRows.length,
        mismatches: termRows.filter((r) => r.mismatch).length,
        buckets: buildCreationBuckets(termRows, begins),
        // Scoped to this term's rows: pricing a candidate start date against the other term's
        // students would answer a question nobody asked.
        whatIf: buildWhatIf(termRows, begins),
      };
    })
    .sort((a, b) => Number(b.isCurrentTerm) - Number(a.isCurrentTerm) || a.semesterName.localeCompare(b.semesterName));
}

/* ────────────────────── R3 — Students Cleared More Than Once ────────────────────── */

export interface ClearedActionTableRow extends ClearedActionRow, ReportRowBase {
  classification: string;
}

/** Actions grouped under their student, which is how the report is read. */
export interface ClearedMoreThanOnceGroup {
  idnumber: string;
  lastName: string;
  firstName: string;
  classification: string;
  actionCount: number;
  actions: ClearedActionTableRow[];
}

export interface ClearedMoreThanOnceView {
  groups: ClearedMoreThanOnceGroup[];
  totals: { students: number; actions: number };
  meta: ReportSnapshotMeta;
  contactsReadAt: Date;
}

export async function getClearedMoreThanOnceView(deps: ReportDeps = {}): Promise<ClearedMoreThanOnceView> {
  const def = requireReport("cleared-more-than-once");
  const loaded = await loadSnapshotRows<ClearedActionRow>(def, deps);
  const population = loaded.rows.map((r) => ({ ...r, dateCleared: r.dateCleared ? new Date(r.dateCleared) : null }));
  const contacts = await loadContacts(population.map((r) => r.idnumber), deps);
  const rows: ClearedActionTableRow[] = joinContacts(population, contacts).map((r) => ({
    ...r,
    classification: classificationDisplayName(r.classCode).displayName,
  }));

  const groups = new Map<string, ClearedMoreThanOnceGroup>();
  for (const r of rows) {
    const g = groups.get(r.idnumber) ?? {
      idnumber: r.idnumber,
      lastName: r.lastName,
      firstName: r.firstName,
      classification: r.classification,
      actionCount: r.actionCount,
      actions: [],
    };
    g.actions.push(r);
    groups.set(r.idnumber, g);
  }
  const ordered = [...groups.values()].sort(
    (a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName) || a.idnumber.localeCompare(b.idnumber),
  );
  for (const g of ordered) g.actions.sort((a, b) => a.actionNo - b.actionNo);

  return {
    groups: ordered,
    totals: { students: ordered.length, actions: rows.length },
    meta: loaded.meta,
    contactsReadAt: loaded.contactsReadAt,
  };
}

/* ───────────────────────── R4 — Enrollee Account Balance ───────────────────────── */

export interface EnrolleeBalanceTableRow extends EnrolleeBalanceRow, ReportRowBase {
  classification: string;
}

export interface EnrolleeBalanceView {
  rows: EnrolleeBalanceTableRow[];
  /** The whole captured population, before the range — the denominator under the form. */
  populationSize: number;
  range: { min: number; max: number };
  totals: { students: number; debitBalance: number };
  /** Lowest and highest debit balance in the population, so the form can suggest a sane range. */
  bounds: { min: number; max: number } | null;
  meta: ReportSnapshotMeta;
  contactsReadAt: Date;
}

export async function getEnrolleeBalanceView(
  range: { min: number; max: number },
  deps: ReportDeps = {},
): Promise<EnrolleeBalanceView> {
  const def = requireReport("enrollee-balance");
  const loaded = await loadSnapshotRows<EnrolleeBalanceRow>(def, deps);
  const contacts = await loadContacts(loaded.rows.map((r) => r.idnumber), deps);
  const all: EnrolleeBalanceTableRow[] = joinContacts(loaded.rows, contacts).map((r) => ({
    ...r,
    classification: classificationDisplayName(r.classCode).displayName,
  }));
  // The balance is live, so the range filters what the student owes now — not what they owed when
  // the population was captured. That is the point of the split (A-30), and it means a student can
  // fall out of the range between two page loads without the population having been recaptured.
  const rows = all.filter((r) => r.accountBalance >= range.min && r.accountBalance <= range.max).sort(byName);
  const balances = all.map((r) => r.accountBalance).filter((b) => b > 0);
  return {
    rows,
    populationSize: all.length,
    range,
    totals: { students: rows.length, debitBalance: round2(rows.reduce((t, r) => t + r.accountBalance, 0)) },
    bounds: balances.length ? { min: Math.min(...balances), max: Math.max(...balances) } : null,
    meta: loaded.meta,
    contactsReadAt: loaded.contactsReadAt,
  };
}

/* ───────────────────────────── R6 — Currently Cleared ───────────────────────────── */

export interface CurrentlyClearedTableRow extends CurrentlyClearedRow, ReportRowBase {
  classification: string;
}

export interface CurrentlyClearedView {
  rows: CurrentlyClearedTableRow[];
  totals: { students: number };
  byClassification: { code: string; name: string; students: number }[];
  meta: ReportSnapshotMeta;
  contactsReadAt: Date;
}

export async function getCurrentlyClearedView(deps: ReportDeps = {}): Promise<CurrentlyClearedView> {
  const def = requireReport("currently-cleared");
  const loaded = await loadSnapshotRows<CurrentlyClearedRow>(def, deps);
  const population = loaded.rows.map((r) => ({ ...r, dateCleared: r.dateCleared ? new Date(r.dateCleared) : null }));
  const contacts = await loadContacts(population.map((r) => r.idnumber), deps);
  const rows: CurrentlyClearedTableRow[] = joinContacts(population, contacts)
    .map((r) => ({ ...r, classification: classificationDisplayName(r.classCode).displayName }))
    .sort((a, b) => a.classCode.localeCompare(b.classCode) || byName(a, b));

  const counts = new Map<string, { code: string; name: string; students: number }>();
  for (const r of rows) {
    const c = counts.get(r.classCode) ?? { code: r.classCode, name: r.classification, students: 0 };
    c.students += 1;
    counts.set(r.classCode, c);
  }

  return {
    rows,
    totals: { students: rows.length },
    byClassification: [...counts.values()].sort((a, b) => a.code.localeCompare(b.code)),
    meta: loaded.meta,
    contactsReadAt: loaded.contactsReadAt,
  };
}

/* ─────────────────────────────────── shared ─────────────────────────────────── */

function requireReport(key: ReportKey): ReportDefinition {
  const def = getReportDefinition(key);
  if (!def) throw new Error(`Unknown report ${key}`);
  return def;
}

/**
 * Audit a report view (A-30). The report key and the row count are recorded; the rows never are.
 * Exports keep using `export.create` rather than a second action, so there is one export log to
 * read rather than two (PLAN §4 made the same call for ExportLog).
 */
export async function auditReportView(actor: Principal, def: ReportDefinition, rowCount: number, correlationId: string): Promise<void> {
  await audit(actor, "report.view", {
    targetType: "report",
    targetId: def.key,
    correlationId,
    metadata: { ref: def.ref, rowCount },
  });
}
