import { getConfig } from "../db/config";
import { getDataProvider } from "../repositories";
import type { ChargesCredits, DataProvider, DnrDncSummary, DrillDownPopulation, EnrollmentClearance, Page, PageRequest, ReceivableSummary, StudentRow } from "../repositories/types";
import { getCurrentTerms } from "../metadata/terms";
import { classificationDisplayName } from "../metadata/classifications";
import { getAppStore } from "../store";
import type { AppStore, JobKey, MetricFamily, SnapshotRecord } from "../store/types";
import { maskPid } from "@/lib/format";
import type { ClearanceBreakdownRow } from "../metadata/clearance-breakdown";
import { buildBreakdown } from "../metadata/clearance-breakdown";
import { runJob } from "../jobs/runner";
import type { JobRunRecord } from "../store/types";
import type { Principal } from "../authz/permissions";
import { audit } from "../audit/audit";
import { changeSincePrior, chargesCreditsDelta, clearancePercentage, deltaTreatment, isStale, type DeltaTreatment } from "./calculations";

/**
 * Snapshot-first dashboard (Spec §19: "do not run every dashboard metric directly against
 * operational views on every page load"). Each card reads the latest snapshot of its metric
 * family; when none exists yet it falls back to a live read ONLY for the mock provider
 * (the real views take 40–120 s — see FINDINGS §6), otherwise reports "no snapshot yet".
 */
export type MetricStatus = "ok" | "stale" | "failed" | "pending";

export interface Metric<T> {
  status: MetricStatus;
  value: T | null;
  capturedAt: string | null;
  snapshotId: string | null;
  error?: string;
}

export type PriorChange = { cleared: number | null; enrolled: number | null; priorCapturedAt: string } | null;

export interface CurrentDashboard {
  term: { current: string; previous: string; label: string; currentKeys: string[]; previousKeys: string[] };
  source: { provider: string; store: string; latestCapturedAt: string | null; anyStale: boolean; staleAfterMinutes: number };
  heroCard: Metric<EnrollmentClearance & { clearedPct: number | null; changeSincePrior: PriorChange }>;
  receivable: Metric<ReceivableSummary & { terms: string[] }>;
  chargesCredits: Metric<ChargesCredits & { delta: number; treatment: DeltaTreatment; warningRatio: number }>;
  dnrDnc: Metric<DnrDncSummary>;
  clearanceBreakdown: Metric<ClearanceBreakdownRow[]>;
}

interface Deps {
  provider?: DataProvider;
  store?: AppStore;
  now?: Date;
  /**
   * Families to refresh through the job pipeline before reading when their snapshot is missing or older
   * than `autoRefreshAfterMinutes` (used by the Clearance Breakdown card: "run on screen load").
   */
  autoRefresh?: MetricFamily[];
  autoRefreshAfterMinutes?: number;
}

type Ctx = { provider: DataProvider; store: AppStore; now: Date };

const FAMILY_JOB: Partial<Record<MetricFamily, JobKey>> = {
  clearanceBreakdown: "dashboard.clearanceBreakdown",
  enrollmentClearance: "dashboard.enrollmentClearance",
  currentReceivable: "dashboard.currentReceivable",
  chargesCredits: "dashboard.chargesCredits",
  dnrDnc: "dashboard.dnrDnc",
  historyEnrollment: "history.enrollmentClearance",
  historyBalances: "history.globalBalances",
  historyReceivables: "history.receivablesBySemester",
  terms: "metadata.terms",
};

/** Run the family's job if its latest snapshot is missing or older than the threshold. Failures are swallowed: the card reports them. */
async function autoRefresh(families: MetricFamily[], afterMinutes: number, deps: Ctx, clock?: () => Date): Promise<void> {
  await Promise.all(
    families.map(async (family) => {
      const job = FAMILY_JOB[family];
      if (!job) return;
      const latest = await deps.store.latestSnapshot(family);
      if (latest && deps.now.getTime() - latest.capturedAt.getTime() < afterMinutes * 60_000) return;
      await runJob(job, { triggeredBy: "page-load", store: deps.store, provider: deps.provider, now: clock, ignoreMinInterval: true }).catch(() => undefined);
    }),
  );
}

async function readMetric<T>(family: MetricFamily, live: () => Promise<T>, deps: Ctx): Promise<{ metric: Metric<T>; snapshot: SnapshotRecord<T> | null }> {
  const cfg = getConfig();
  try {
    const snap = await deps.store.latestSnapshot<T>(family);
    if (snap) {
      const stale = isStale(snap.capturedAt, deps.now, cfg.STALE_AFTER_MINUTES);
      return { metric: { status: stale ? "stale" : "ok", value: snap.payload, capturedAt: snap.capturedAt.toISOString(), snapshotId: snap.id }, snapshot: snap };
    }
    if (deps.provider.name === "mock") {
      const value = await live();
      return { metric: { status: "ok", value, capturedAt: deps.now.toISOString(), snapshotId: null }, snapshot: null };
    }
    return { metric: { status: "pending", value: null, capturedAt: null, snapshotId: null, error: "No snapshot has been captured yet. Run the refresh job from Administration → Jobs." }, snapshot: null };
  } catch (err) {
    console.error(JSON.stringify({ level: "error", family, message: err instanceof Error ? err.message : String(err) }));
    return { metric: { status: "failed", value: null, capturedAt: null, snapshotId: null, error: "This metric could not be loaded. The value is unavailable, not zero." }, snapshot: null };
  }
}

export async function getCurrentDashboard(d: Deps = {}): Promise<CurrentDashboard> {
  const deps: Ctx = { provider: d.provider ?? getDataProvider(), store: d.store ?? getAppStore(), now: d.now ?? new Date() };
  const cfg = getConfig();
  const terms = await getCurrentTerms(deps.store, deps.provider);
  if (d.autoRefresh?.length) await autoRefresh(d.autoRefresh, d.autoRefreshAfterMinutes ?? 15, deps, d.now ? () => deps.now : undefined);

  const [hero, recv, cc, dd, cb] = await Promise.all([
    readMetric<EnrollmentClearance>("enrollmentClearance", () => deps.provider.getEnrollmentClearance(), deps),
    readMetric<ReceivableSummary & { terms: string[] }>("currentReceivable", async () => ({ ...(await deps.provider.getCurrentReceivable(terms.currentKeys)), terms: terms.currentKeys }), deps),
    readMetric<ChargesCredits>("chargesCredits", () => deps.provider.getChargesCredits(), deps),
    readMetric<DnrDncSummary>("dnrDnc", () => deps.provider.getDnrDncSummary(), deps),
    readMetric<ClearanceBreakdownRow[]>("clearanceBreakdown", async () => { const c = await deps.provider.getClassificationCounts(); return buildBreakdown(c.enrolled, c.cleared); }, deps),
  ]);

  // Change since the prior snapshot (Spec §6.1 "change since yesterday").
  let priorChange: PriorChange = null;
  if (hero.snapshot) {
    const prior = await deps.store.previousSnapshot<EnrollmentClearance>("enrollmentClearance", hero.snapshot.capturedAt);
    if (prior) {
      priorChange = {
        cleared: changeSincePrior(hero.snapshot.payload.cleared, prior.payload.cleared),
        enrolled: changeSincePrior(hero.snapshot.payload.enrolled, prior.payload.enrolled),
        priorCapturedAt: prior.capturedAt.toISOString(),
      };
    }
  }

  const captured = [hero, recv, cc, dd, cb].map((m) => m.metric.capturedAt).filter((x): x is string => !!x).sort();
  return {
    term: { current: terms.current.tradName, previous: terms.previous.tradName, label: terms.label, currentKeys: terms.currentKeys, previousKeys: terms.previousKeys },
    source: {
      provider: deps.provider.name,
      store: cfg.APP_STORE,
      latestCapturedAt: captured.length ? captured[captured.length - 1] : null,
      anyStale: [hero, recv, cc, dd, cb].some((m) => m.metric.status === "stale"),
      staleAfterMinutes: cfg.STALE_AFTER_MINUTES,
    },
    heroCard: {
      ...hero.metric,
      value: hero.metric.value ? { ...hero.metric.value, clearedPct: clearancePercentage(hero.metric.value.cleared, hero.metric.value.enrolled), changeSincePrior: priorChange } : null,
    },
    receivable: recv.metric,
    chargesCredits: {
      ...cc.metric,
      value: cc.metric.value
        ? { ...cc.metric.value, delta: chargesCreditsDelta(cc.metric.value.charges, cc.metric.value.credits), treatment: deltaTreatment(cc.metric.value.charges, cc.metric.value.credits, cfg.DELTA_WARNING_RATIO), warningRatio: cfg.DELTA_WARNING_RATIO }
        : null,
    },
    dnrDnc: dd.metric,
    clearanceBreakdown: cb.metric,
  };
}

/**
 * "Refresh" on the Clearance Breakdown card (Spec §7.3). Any dashboard viewer may trigger it; it still goes
 * through the audited job pipeline (overlap lock, run record, snapshot) — it is never a live read from the page.
 */
export async function refreshClearanceBreakdown(actor: Principal, correlationId?: string, deps: Pick<Deps, "provider" | "store"> = {}): Promise<JobRunRecord> {
  const run = await runJob("dashboard.clearanceBreakdown", { triggeredBy: `manual:${actor.userId}`, ignoreMinInterval: true, store: deps.store, provider: deps.provider });
  await audit(actor, "dashboard.refresh", { correlationId, targetType: "job", targetId: "dashboard.clearanceBreakdown", metadata: { status: run.status, durationMs: run.durationMs, rows: run.rowsProcessed } });
  return run;
}

/** Drill-down row as exposed to the UI: PID masked, classification resolved via metadata (A-3, A-19). */
export interface DrillDownRow {
  idnumber: string;
  lastName: string;
  firstName: string;
  classificationCode: string;
  classification: string;
  status: StudentRow["status"];
  accountBalance: number;
  email: string;
  pidMasked: string;
  lastCleared: string | null;
  clearedBy: string | null;
  enrolledCurrentTerm: boolean;
}

/**
 * Drill-downs are student-level and are read live (they are paginated, indexed-table queries on
 * tblStudent / VIEW_OURM — not the slow FCA view). Requires student.view (enforced by the caller).
 */
export async function getDrillDown(population: DrillDownPopulation, page: PageRequest, provider: DataProvider = getDataProvider()): Promise<Page<DrillDownRow>> {
  const result = await provider.getStudentsForPopulation(population, page);
  return {
    ...result,
    rows: result.rows.map((s) => ({
      idnumber: s.idnumber,
      lastName: s.lastName,
      firstName: s.firstName,
      classificationCode: s.classificationCode,
      classification: classificationDisplayName(s.classificationCode, s.isIncomingTransfer).displayName,
      status: s.status,
      accountBalance: s.accountBalance,
      email: s.email,
      pidMasked: maskPid(s.pid),
      lastCleared: s.lastCleared,
      clearedBy: s.clearedBy,
      enrolledCurrentTerm: s.enrolledCurrentTerm,
    })),
  };
}
