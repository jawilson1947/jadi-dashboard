import { getConfig } from "../db/config";
import { getDataProvider } from "../repositories";
import type { DataProvider, DateRange, Page, PageRequest, SprintStudentFilter } from "../repositories/types";
import { getAppStore } from "../store";
import type { AppStore, OperatorProfileRecord, SprintWindowRecord } from "../store/types";
import type { TermMetadata } from "../repositories/types";
import { getCurrentTerms } from "../metadata/terms";
import { buildBreakdown, type ClearanceBreakdownRow } from "../metadata/clearance-breakdown";
import { classificationDisplayName } from "../metadata/classifications";
import { resolveOperator, type OperatorRange, type OperatorResolution } from "../metadata/operators";
import { runJob } from "../jobs/runner";
import { isStale } from "./calculations";
import type { Metric, MetricStatus } from "./dashboard";
import { dayOfSprint, daysBetween, eachDate, toIsoDate, todayIso } from "@/lib/dates";
import { maskPid } from "@/lib/format";

/**
 * Clearance Sprint (Spec §7).
 *
 * The sprint window is admin-entered per semester (ASSUMPTIONS A-10) — there is no computed default,
 * so every function here treats "no window" as a first-class state rather than guessing dates.
 *
 * Like the dashboard, the page reads SNAPSHOTS (Spec §19): one `sprintDaily` snapshot per term holds
 * the whole sprint (by date, by operator, by classification). That snapshot is also what the
 * prior-semester overlay reads — the source views are scoped to the current term (FINDINGS §3), so
 * comparisons can only use sprints this application has captured.
 */

/** Snapshot payload for the `sprintDaily` family. Aggregates only — never student rows. */
export interface SprintSnapshotPayload {
  termKey: string;
  termLabel: string;
  /** Null when no sprint window was configured at capture time. */
  window: { start: string; end: string } | null;
  byDate: Array<{ date: string; cleared: number }>;
  byOperator: Array<{ operatorCode: string; cleared: number; firstAt: string | null; lastAt: string | null }>;
  byClassification: ClearanceBreakdownRow[];
  totalCleared: number;
}

export interface SprintDayRow {
  date: string;
  /** 1-based position inside the window — the x-axis prior semesters are aligned on (§7.4). */
  dayOfSprint: number;
  cleared: number;
  /** Running total to this day, i.e. the "total to date" column (§7.1). */
  cumulative: number;
  isToday: boolean;
  isFuture: boolean;
}

export interface SprintOperatorRow {
  code: string;
  displayName: string;
  isSystem: boolean;
  mapped: boolean;
  /** Why it did or did not resolve — "no profile" and "dates exclude these actions" are not the same. */
  reason: OperatorResolution;
  /** Effective ranges that exist for the code when `reason` is "out-of-range". */
  ranges: OperatorRange[];
  cleared: number;
  sharePct: number | null;
  firstAt: string | null;
  lastAt: string | null;
}

export interface SprintComparisonSeries {
  termKey: string;
  capturedAt: string;
  total: number;
  windowDays: number;
  points: Array<{ dayOfSprint: number; cumulative: number }>;
}

/**
 * Prior-semester benchmark (Spec §7.4). The nightly 9 pm `tblOUSA.FinanciallyCleared` capture is the
 * official historical figure (A-2), so it is what the sprint is measured against. It is a TOTAL, not a
 * curve: `tblStudent.LastCleared` carries a term but no date, so an earlier sprint's daily shape cannot
 * be reconstructed (FINDINGS §8.8). Only semesters of the same season are offered — comparing a Fall
 * sprint with a Spring one compares different intakes.
 */
export interface SprintBenchmark {
  termKey: string;
  label: string;
  financiallyCleared: number;
  census: number | null;
  /** Nightly cleared as a share of that semester's census. */
  clearedPctOfCensus: number | null;
  /** Where this sprint stands against that semester's final figure. */
  currentVsBenchmarkPct: number | null;
}

export interface SprintView {
  term: { key: string; label: string };
  /** Null = an administrator has not set the sprint dates for this term yet (A-10). */
  window: SprintWindowRecord | null;
  metric: Metric<SprintSnapshotPayload>;
  /** Every day in the window, zero-filled, with running totals. */
  byDate: SprintDayRow[];
  byOperator: SprintOperatorRow[];
  byClassification: ClearanceBreakdownRow[];
  totals: { cleared: number; days: number; elapsedDays: number; peak: SprintDayRow | null; averagePerElapsedDay: number | null };
  comparison: SprintComparisonSeries[];
  /** Current term's own cumulative curve, for the overlay. */
  currentSeries: SprintComparisonSeries | null;
  /** Same-season prior semesters with their official nightly cleared totals (A-2). */
  benchmarks: SprintBenchmark[];
  source: { provider: string; staleAfterMinutes: number };
}

interface Deps {
  provider?: DataProvider;
  store?: AppStore;
  now?: Date;
  /** Refresh the sprint snapshot on screen load when it is missing or older than this (0 disables). */
  autoRefreshAfterMinutes?: number;
}

/**
 * Read the source once and build the whole sprint payload. Called by the `sprint.daily` job only —
 * pages never call it directly, because the underlying view scan is not a page-load operation.
 */
export async function captureSprint(provider: DataProvider, store: AppStore): Promise<{ payload: SprintSnapshotPayload; rowCount: number | null }> {
  const terms = await getCurrentTerms(store, provider);
  const termKey = terms.current.tradName;
  const window = await store.getSprintWindow(termKey);
  if (!window) {
    // Not an error: A-10 leaves the window unset until an administrator enters it.
    return { payload: { termKey, termLabel: terms.label, window: null, byDate: [], byOperator: [], byClassification: [], totalCleared: 0 }, rowCount: null };
  }

  const range: DateRange = { start: window.start, end: window.end };
  const [byDate, byOperator, counts] = await Promise.all([
    provider.getClearanceByDate(range),
    provider.getClearanceByOperator(range),
    provider.getClassificationCounts(range),
  ]);
  const byClassification = buildBreakdown(counts.enrolled, counts.cleared);
  const totalCleared = byDate.reduce((sum, r) => sum + r.cleared, 0);
  return {
    payload: {
      termKey,
      termLabel: terms.label,
      window: { start: window.start, end: window.end },
      byDate,
      byOperator: byOperator.map((o) => ({ operatorCode: o.operatorCode, cleared: o.cleared, firstAt: o.firstAt?.toISOString() ?? null, lastAt: o.lastAt?.toISOString() ?? null })),
      byClassification,
      totalCleared,
    },
    rowCount: totalCleared,
  };
}

/** Current term plus its configured window (null when unset) — used by pages that must not trigger a refresh. */
export async function getCurrentSprintWindow(d: Pick<Deps, "provider" | "store"> = {}): Promise<{ termKey: string; label: string; window: SprintWindowRecord | null }> {
  const provider = d.provider ?? getDataProvider();
  const store = d.store ?? getAppStore();
  const terms = await getCurrentTerms(store, provider);
  return { termKey: terms.current.tradName, label: terms.label, window: await store.getSprintWindow(terms.current.tradName) };
}

export async function getSprintView(d: Deps = {}): Promise<SprintView> {
  const provider = d.provider ?? getDataProvider();
  const store = d.store ?? getAppStore();
  const now = d.now ?? new Date();
  const cfg = getConfig();
  const terms = await getCurrentTerms(store, provider);
  const termKey = terms.current.tradName;
  const window = await store.getSprintWindow(termKey);

  const base = {
    term: { key: termKey, label: terms.label },
    window,
    source: { provider: provider.name, staleAfterMinutes: cfg.STALE_AFTER_MINUTES },
  };

  if (!window) {
    return {
      ...base,
      metric: { status: "pending", value: null, capturedAt: null, snapshotId: null, error: "Sprint dates have not been set for this semester. An administrator can set them under Administration → Semester metadata." },
      byDate: [],
      byOperator: [],
      byClassification: [],
      totals: { cleared: 0, days: 0, elapsedDays: 0, peak: null, averagePerElapsedDay: null },
      comparison: [],
      currentSeries: null,
      benchmarks: [],
    };
  }

  const refreshAfter = d.autoRefreshAfterMinutes ?? 15;
  if (refreshAfter > 0) {
    const latest = await store.latestSnapshot<SprintSnapshotPayload>("sprintDaily");
    const windowChanged = latest?.payload.window?.start !== window.start || latest?.payload.window?.end !== window.end;
    const old = !latest || now.getTime() - latest.capturedAt.getTime() >= refreshAfter * 60_000;
    // A window edit invalidates the snapshot immediately: its rows describe a different date range.
    if (old || windowChanged || latest?.payload.termKey !== termKey) {
      await runJob("sprint.daily", { triggeredBy: "page-load", store, provider, ignoreMinInterval: true, now: d.now ? () => now : undefined }).catch(() => undefined);
    }
  }

  const snap = await store.latestSnapshot<SprintSnapshotPayload>("sprintDaily");
  const metric: Metric<SprintSnapshotPayload> = snap
    ? {
        status: (isStale(snap.capturedAt, now, cfg.STALE_AFTER_MINUTES) ? "stale" : "ok") as MetricStatus,
        value: snap.payload,
        capturedAt: snap.capturedAt.toISOString(),
        snapshotId: snap.id,
      }
    : { status: "pending", value: null, capturedAt: null, snapshotId: null, error: "No sprint snapshot has been captured yet. Run “Clearance sprint” from Administration → Jobs." };

  const payload = snap?.payload ?? null;
  const today = todayIso(cfg.APP_TIMEZONE, now);
  const byDate = buildDaySeries(payload?.byDate ?? [], window, today);
  const profiles = await store.listOperatorProfiles();
  const byOperator = buildOperatorRows(payload?.byOperator ?? [], profiles, payload?.totalCleared ?? 0);

  const elapsedDays = Math.min(byDate.length, Math.max(0, daysBetween(window.start, today) + 1));
  const peak = byDate.reduce<SprintDayRow | null>((best, r) => (best === null || r.cleared > best.cleared ? r : best), null);
  const cleared = payload?.totalCleared ?? 0;

  const comparison = await buildComparison(store, termKey);
  const benchmarks = buildBenchmarks(terms.all, terms.current, cleared);
  const currentSeries: SprintComparisonSeries | null = payload
    ? { termKey, capturedAt: metric.capturedAt ?? now.toISOString(), total: cleared, windowDays: byDate.length, points: byDate.filter((r) => !r.isFuture).map((r) => ({ dayOfSprint: r.dayOfSprint, cumulative: r.cumulative })) }
    : null;

  return {
    ...base,
    metric,
    byDate,
    byOperator,
    byClassification: payload?.byClassification ?? [],
    totals: {
      cleared,
      days: byDate.length,
      elapsedDays,
      peak: peak && peak.cleared > 0 ? peak : null,
      averagePerElapsedDay: elapsedDays > 0 ? cleared / elapsedDays : null,
    },
    comparison,
    currentSeries,
    benchmarks,
  };
}

/**
 * Same-season prior semesters, newest first, from the nightly figures already on each tblOUSA row.
 * Rows without a captured figure are skipped rather than shown as zero (Spec §5: never render a
 * missing value as 0).
 */
export function buildBenchmarks(all: TermMetadata[], current: TermMetadata, currentCleared: number, limit = 3): SprintBenchmark[] {
  const season = current.semesterName.split(" ")[0];
  return all
    .filter((t) => t.semesterName.startsWith(season) && t.semesterBegins < current.semesterBegins && (t.financiallyCleared ?? 0) > 0)
    .sort((a, b) => b.semesterBegins.getTime() - a.semesterBegins.getTime())
    .slice(0, limit)
    .map((t) => ({
      termKey: t.tradName,
      label: t.semesterName,
      financiallyCleared: t.financiallyCleared!,
      census: t.census,
      clearedPctOfCensus: t.census && t.census > 0 ? (t.financiallyCleared! / t.census) * 100 : null,
      currentVsBenchmarkPct: t.financiallyCleared! > 0 ? (currentCleared / t.financiallyCleared!) * 100 : null,
    }));
}

/** Zero-fill every day of the window and carry the running total (Spec §7.1 "total-to-date"). */
export function buildDaySeries(rows: Array<{ date: string; cleared: number }>, window: { start: string; end: string }, today: string): SprintDayRow[] {
  const counts = new Map(rows.map((r) => [r.date, r.cleared]));
  let cumulative = 0;
  return eachDate(window.start, window.end).map((date) => {
    const cleared = counts.get(date) ?? 0;
    cumulative += cleared;
    return { date, dayOfSprint: dayOfSprint(date, window.start, window.end) ?? 0, cleared, cumulative, isToday: date === today, isFuture: date > today };
  });
}

/** Resolve ClearedBy codes to people; unmapped codes and the blank code keep their own rows (§7.2). */
export function buildOperatorRows(rows: Array<{ operatorCode: string; cleared: number; firstAt: string | null; lastAt: string | null }>, profiles: OperatorProfileRecord[], total: number): SprintOperatorRow[] {
  return rows
    .map((r) => {
      const asOf = r.lastAt ? r.lastAt.slice(0, 10) : null;
      const resolved = resolveOperator(r.operatorCode, asOf, profiles);
      return {
        code: r.operatorCode,
        displayName: resolved.displayName,
        isSystem: resolved.isSystem,
        mapped: resolved.mapped,
        reason: resolved.reason,
        ranges: resolved.ranges,
        cleared: r.cleared,
        sharePct: total > 0 ? (r.cleared / total) * 100 : null,
        firstAt: r.firstAt,
        lastAt: r.lastAt,
      };
    })
    .sort((a, b) => b.cleared - a.cleared || a.displayName.localeCompare(b.displayName));
}

/**
 * Prior-semester overlays (Spec §7.4) come from archived `sprintDaily` snapshots, aligned on
 * day-of-sprint rather than calendar date. Terms the application never captured cannot appear:
 * VIEW_OURM_CLEARED only exposes the current term (FINDINGS §3), so there is no way to reconstruct
 * an earlier sprint after the fact.
 */
async function buildComparison(store: AppStore, currentTermKey: string): Promise<SprintComparisonSeries[]> {
  const snaps = await store.latestSnapshotsByTerm<SprintSnapshotPayload>("sprintDaily", 12);
  return snaps
    .filter((s) => s.termKey !== null && s.termKey !== currentTermKey && s.payload?.window)
    .map((s) => {
      const window = s.payload.window!;
      const series = buildDaySeries(s.payload.byDate, window, window.end);
      return {
        termKey: s.termKey!,
        capturedAt: s.capturedAt.toISOString(),
        total: s.payload.totalCleared,
        windowDays: series.length,
        points: series.map((r) => ({ dayOfSprint: r.dayOfSprint, cumulative: r.cumulative })),
      };
    })
    .sort((a, b) => b.termKey.localeCompare(a.termKey));
}

/** One student row behind a sprint cell. PID masked, classification and operator resolved (A-3, A-19, §7.2). */
export interface SprintStudentRow {
  idnumber: string;
  lastName: string;
  firstName: string;
  classification: string;
  clearedOn: string | null;
  clearedAt: string | null;
  operatorCode: string | null;
  operator: string;
  accountBalance: number;
  status: "Cleared" | "Not Cleared";
  email: string;
  pidMasked: string;
  enrolledCurrentTerm: boolean;
}

export async function getSprintDrillDown(
  filter: SprintStudentFilter,
  page: PageRequest,
  d: Pick<Deps, "provider" | "store"> = {},
): Promise<Page<SprintStudentRow>> {
  const provider = d.provider ?? getDataProvider();
  const store = d.store ?? getAppStore();
  const tz = getConfig().APP_TIMEZONE;
  const [result, profiles] = await Promise.all([provider.getSprintStudents(filter, page), store.listOperatorProfiles()]);
  return {
    ...result,
    rows: result.rows.map((s) => {
      const clearedOn = s.clearedAt ? toIsoDate(s.clearedAt, tz) : null;
      const operator = resolveOperator(s.clearedBy, clearedOn, profiles);
      return {
        idnumber: s.idnumber,
        lastName: s.lastName,
        firstName: s.firstName,
        classification: classificationDisplayName(s.classificationCode, s.isIncomingTransfer).displayName,
        clearedOn,
        clearedAt: s.clearedAt?.toISOString() ?? null,
        operatorCode: s.clearedBy,
        operator: operator.displayName,
        accountBalance: s.accountBalance,
        status: s.status,
        email: s.email,
        pidMasked: maskPid(s.pid),
        enrolledCurrentTerm: s.enrolledCurrentTerm,
      };
    }),
  };
}
