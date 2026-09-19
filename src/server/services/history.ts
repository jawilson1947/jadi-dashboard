import { getConfig } from "../db/config";
import { getDataProvider } from "../repositories";
import type { DataProvider, GlobalBalances, ReceivableByTermRow, TermMetadata } from "../repositories/types";
import { getAppStore } from "../store";
import type { AppStore, MetricFamily } from "../store/types";
import { getCurrentTerms, academicYearOf } from "../metadata/terms";
import { buildSemesterIndex, isSummerCode, isSummerTerm, resolveSemester, NEVER_CLEARED, type ResolvedSemester } from "../metadata/semesters";
import { clearancePercentage, isStale } from "./calculations";
import type { Metric } from "./dashboard";

/**
 * Historical Analysis (Spec §9).
 *
 * Everything here is arithmetic over metadata the institution already keeps: §9.1 reads the nightly
 * `census` / `FinanciallyCleared` figures stored per semester (A-2 makes them the official historical
 * numbers), and §9.2/§9.3 are aggregates over the authoritative balance column (A-18). Nothing touches
 * the slow views.
 *
 * Two decisions shape the output (2026-09-18): summer terms are omitted (A-23), and negative balances
 * are a secondary figure that is never netted against receivables (A-5).
 */

export interface TermFigures {
  termKey: string;
  semesterName: string;
  census: number | null;
  cleared: number | null;
  clearedPct: number | null;
  /** False when the nightly figure was never captured for this term — rendered "—", never 0. */
  captured: boolean;
}

export interface AcademicYearRow {
  academicYear: string;
  fall: TermFigures | null;
  spring: TermFigures | null;
  totalCensus: number | null;
  totalCleared: number | null;
  clearedPct: number | null;
}

/**
 * §9.1: Fall YYYY pairs with the following Spring. Summer is omitted entirely (A-23).
 * A census or cleared figure of 0 is treated as "never captured" rather than as a real zero —
 * no semester in this institution's history had nobody enrolled, so a 0 line would be a lie.
 */
export function buildAcademicYears(terms: TermMetadata[], range?: { from?: string; to?: string }): AcademicYearRow[] {
  const byYear = new Map<string, AcademicYearRow>();
  for (const t of terms) {
    if (isSummerTerm(t)) continue;
    const academicYear = academicYearOf(t);
    const row = byYear.get(academicYear) ?? { academicYear, fall: null, spring: null, totalCensus: null, totalCleared: null, clearedPct: null };
    const figures = toFigures(t);
    if (t.semesterName.trim().toLowerCase().startsWith("fall")) row.fall = figures;
    else if (t.semesterName.trim().toLowerCase().startsWith("spring")) row.spring = figures;
    else continue;
    byYear.set(academicYear, row);
  }

  return [...byYear.values()]
    .filter((r) => (!range?.from || r.academicYear >= range.from) && (!range?.to || r.academicYear <= range.to))
    .map((r) => {
      const captured = [r.fall, r.spring].filter((f): f is TermFigures => !!f && f.captured);
      const totalCensus = captured.length ? captured.reduce((s, f) => s + (f.census ?? 0), 0) : null;
      const totalCleared = captured.length ? captured.reduce((s, f) => s + (f.cleared ?? 0), 0) : null;
      return { ...r, totalCensus, totalCleared, clearedPct: totalCensus === null || totalCleared === null ? null : clearancePercentage(totalCleared, totalCensus) };
    })
    .sort((a, b) => a.academicYear.localeCompare(b.academicYear));
}

function toFigures(t: TermMetadata): TermFigures {
  const census = t.census && t.census > 0 ? t.census : null;
  const cleared = t.financiallyCleared && t.financiallyCleared > 0 ? t.financiallyCleared : null;
  return {
    termKey: t.tradName,
    semesterName: t.semesterName,
    census,
    cleared,
    clearedPct: census === null || cleared === null ? null : clearancePercentage(cleared, census),
    captured: census !== null || cleared !== null,
  };
}

/** One semester on the full-history trends (Spec §9.1 charts): census and cleared, oldest to newest. */
export interface TermSeriesPoint {
  termKey: string;
  label: string;
  academicYear: string;
  begins: string;
  census: number | null;
  cleared: number | null;
  clearedPct: number | null;
}

/**
 * Every semester the institution has figures for, in chronological order — the whole record, not the
 * range picker's slice, because the two trend charts are explicitly "from the beginning to now".
 * Summer is omitted (A-23) and terms with no captured figure are left out rather than drawn as zero.
 */
export function buildTermSeries(terms: TermMetadata[]): TermSeriesPoint[] {
  return terms
    .filter((t) => !isSummerTerm(t))
    .map((t) => ({ term: t, figures: toFigures(t) }))
    .filter(({ figures }) => figures.captured)
    .sort((a, b) => a.term.semesterBegins.getTime() - b.term.semesterBegins.getTime())
    .map(({ term, figures }) => ({
      termKey: term.tradName,
      label: term.semesterName,
      academicYear: academicYearOf(term),
      begins: term.semesterBegins.toISOString(),
      census: figures.census,
      cleared: figures.cleared,
      clearedPct: figures.clearedPct,
    }));
}

export interface ReceivableSemesterRow {
  key: string;
  label: string;
  academicYear: string;
  students: number;
  positiveBalance: number;
  isCurrent: boolean;
}

export interface ReceivablesView {
  groupBy: "semester" | "schoolYear";
  rows: ReceivableSemesterRow[];
  /** Summer terms, omitted from the rows but kept so the money still adds up (A-23). */
  excluded: { students: number; positiveBalance: number; terms: string[] };
  /** Never-cleared sentinel and codes with no matching semester — shown, never dropped. */
  neverCleared: { students: number; positiveBalance: number };
  unknown: { students: number; positiveBalance: number; terms: string[] };
  /** Rows + excluded + neverCleared + unknown. Equals the §9.2 Global Receivables figure. */
  total: number;
  totalStudents: number;
}

/**
 * §9.3: group positive balances by the semester each student's LastCleared points at.
 * The three lines below the table exist so that semesters + excluded + unmatched always equals the
 * global receivable figure — a chart that does not reconcile with the headline number is how people
 * stop trusting a dashboard.
 */
export function buildReceivables(rows: ReceivableByTermRow[], index: Map<string, ResolvedSemester>, groupBy: "semester" | "schoolYear"): ReceivablesView {
  const grouped = new Map<string, ReceivableSemesterRow>();
  const excluded = { students: 0, positiveBalance: 0, terms: [] as string[] };
  const neverCleared = { students: 0, positiveBalance: 0 };
  const unknown = { students: 0, positiveBalance: 0, terms: [] as string[] };

  for (const r of rows) {
    const resolved = resolveSemester(r.termKey, index);
    if (!resolved.matched) {
      const bucket = resolved.reason === "never-cleared" ? neverCleared : unknown;
      bucket.students += r.students;
      bucket.positiveBalance = round2(bucket.positiveBalance + r.positiveBalance);
      if (resolved.reason === "unknown") unknown.terms.push(r.termKey);
      continue;
    }
    if (resolved.isSummer || isSummerCode(r.termKey)) {
      excluded.students += r.students;
      excluded.positiveBalance = round2(excluded.positiveBalance + r.positiveBalance);
      if (!excluded.terms.includes(r.termKey)) excluded.terms.push(r.termKey);
      continue;
    }
    const key = groupBy === "schoolYear" ? resolved.academicYear : resolved.termKey;
    const label = groupBy === "schoolYear" ? resolved.academicYear : resolved.program === "LEAP" ? `${resolved.semesterName} (LEAP)` : resolved.semesterName;
    const row = grouped.get(key) ?? { key, label, academicYear: resolved.academicYear, students: 0, positiveBalance: 0, isCurrent: false };
    row.students += r.students;
    row.positiveBalance = round2(row.positiveBalance + r.positiveBalance);
    row.isCurrent = row.isCurrent || resolved.isCurrent;
    grouped.set(key, row);
  }

  const semesterRows = [...grouped.values()].sort((a, b) => a.academicYear.localeCompare(b.academicYear) || a.label.localeCompare(b.label));
  const total = round2(semesterRows.reduce((s, r) => s + r.positiveBalance, 0) + excluded.positiveBalance + neverCleared.positiveBalance + unknown.positiveBalance);
  const totalStudents = semesterRows.reduce((s, r) => s + r.students, 0) + excluded.students + neverCleared.students + unknown.students;
  return { groupBy, rows: semesterRows, excluded, neverCleared, unknown, total, totalStudents };
}

export interface HistoryView {
  range: { from: string; to: string; available: string[] };
  /** Full record, oldest to newest, for the census and clearance trend charts. Ignores the range picker. */
  series: TermSeriesPoint[];
  enrollment: Metric<AcademicYearRow[]>;
  balances: Metric<GlobalBalances>;
  receivables: Metric<ReceivablesView>;
  /** True when §9.3 adds up to §9.2 — surfaced on the page rather than assumed. */
  reconciles: boolean | null;
  labels: { credits: string };
  source: { provider: string; staleAfterMinutes: number };
}

interface Deps {
  provider?: DataProvider;
  store?: AppStore;
  now?: Date;
}

/** Snapshot-first, with a live read only in mock mode — the same rule the dashboard follows (Spec §19). */
async function readMetric<T>(family: MetricFamily, live: () => Promise<T>, deps: Required<Deps>): Promise<Metric<T>> {
  const cfg = getConfig();
  try {
    const snap = await deps.store.latestSnapshot<T>(family);
    if (snap) {
      return {
        status: isStale(snap.capturedAt, deps.now, cfg.STALE_AFTER_MINUTES) ? "stale" : "ok",
        value: snap.payload,
        capturedAt: snap.capturedAt.toISOString(),
        snapshotId: snap.id,
      };
    }
    if (deps.provider.name === "mock") return { status: "ok", value: await live(), capturedAt: deps.now.toISOString(), snapshotId: null };
    return { status: "pending", value: null, capturedAt: null, snapshotId: null, error: "No snapshot has been captured yet. Run the history jobs from Administration → Jobs." };
  } catch (err) {
    console.error(JSON.stringify({ level: "error", family, message: err instanceof Error ? err.message : String(err) }));
    return { status: "failed", value: null, capturedAt: null, snapshotId: null, error: "This metric could not be loaded. The value is unavailable, not zero." };
  }
}

export async function getHistoryView(params: { from?: string; to?: string; groupBy?: "semester" | "schoolYear" } = {}, d: Deps = {}): Promise<HistoryView> {
  const deps = { provider: d.provider ?? getDataProvider(), store: d.store ?? getAppStore(), now: d.now ?? new Date() };
  const cfg = getConfig();
  const terms = await getCurrentTerms(deps.store, deps.provider);
  const index = buildSemesterIndex(terms.all);

  const allYears = buildAcademicYears(terms.all);
  const available = allYears.map((y) => y.academicYear);
  const from = params.from && available.includes(params.from) ? params.from : available[0] ?? "";
  const to = params.to && available.includes(params.to) ? params.to : available.at(-1) ?? "";
  const groupBy = params.groupBy ?? "semester";

  const [enrollmentAll, balances, receivableRows] = await Promise.all([
    readMetric<AcademicYearRow[]>("historyEnrollment", async () => buildAcademicYears(terms.all), deps),
    readMetric<GlobalBalances>("historyBalances", () => deps.provider.getGlobalBalances(), deps),
    readMetric<ReceivableByTermRow[]>("historyReceivables", () => deps.provider.getReceivablesByTerm(), deps),
  ]);

  // The range picker filters the captured series; it never changes what was captured.
  const enrollment: Metric<AcademicYearRow[]> = {
    ...enrollmentAll,
    value: enrollmentAll.value ? enrollmentAll.value.filter((y) => (!from || y.academicYear >= from) && (!to || y.academicYear <= to)) : null,
  };
  const receivables: Metric<ReceivablesView> = {
    ...receivableRows,
    value: receivableRows.value ? buildReceivables(receivableRows.value, index, groupBy) : null,
  };
  const reconciles = balances.value && receivables.value ? Math.abs(balances.value.positiveTotal - receivables.value.total) < 0.01 : null;

  return {
    range: { from, to, available },
    series: enrollmentAll.value ? buildTermSeries(terms.all) : [],
    enrollment,
    balances,
    receivables,
    reconciles,
    // A-5: negative balances are shown as credit balances, never as payments.
    labels: { credits: "Credit balances" },
    source: { provider: deps.provider.name, staleAfterMinutes: cfg.STALE_AFTER_MINUTES },
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export { NEVER_CLEARED };
