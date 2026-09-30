import { getDataProvider } from "../repositories";
import type { DataProvider, StudentContactRow } from "../repositories/types";
import { getAppStore } from "../store";
import type { AppStore, MetricFamily, SnapshotRecord } from "../store/types";
import type { ReportDefinition } from "./definitions";

/**
 * Reading a report snapshot (docs/REPORTS-PLAN.md §2, A-30).
 *
 * The snapshot holds the expensive half — who is in the population, and the codes derived from the
 * slow views. The cheap half, and the half that must never be stale, is joined live: names, emails
 * and balances come from tblStudent on every request. A collection report therefore cannot quote a
 * balance from last night, and `dash` never holds a name or an email at rest.
 *
 * Every page states both times. They are different facts and showing one date would be a lie about
 * the other.
 */

/** How many snapshots of a report family to keep. One: a refresh replaces the population (A-30). */
export const REPORT_SNAPSHOTS_KEPT = 1;

export interface ReportSnapshotMeta {
  capturedAt: Date | null;
  rowCount: number | null;
  sourceProvider: string | null;
  /** True when no capture has run yet — the page offers Refresh instead of an empty table. */
  missing: boolean;
  ageMinutes: number | null;
  stale: boolean;
}

export interface LoadedReport<T> {
  rows: T[];
  meta: ReportSnapshotMeta;
  /** When the live half was read. Always now; carried so the page can print it beside capturedAt. */
  contactsReadAt: Date;
}

/** Minutes after which the page shows a stale banner. Matches the dashboard's default. */
const STALE_AFTER_MINUTES = 24 * 60;

export function describeSnapshot(snap: SnapshotRecord | null, now: Date, staleAfter = STALE_AFTER_MINUTES): ReportSnapshotMeta {
  if (!snap) return { capturedAt: null, rowCount: null, sourceProvider: null, missing: true, ageMinutes: null, stale: true };
  const ageMinutes = Math.max(0, Math.round((now.getTime() - snap.capturedAt.getTime()) / 60_000));
  return {
    capturedAt: snap.capturedAt,
    rowCount: snap.rowCount,
    sourceProvider: snap.sourceProvider,
    missing: false,
    ageMinutes,
    stale: ageMinutes > staleAfter,
  };
}

export interface ReportDeps {
  provider?: DataProvider;
  store?: AppStore;
  now?: Date;
}

/** Read one report's captured population. Returns an empty list (not an error) before the first run. */
export async function loadSnapshotRows<T>(def: ReportDefinition, deps: ReportDeps = {}): Promise<LoadedReport<T>> {
  const store = deps.store ?? getAppStore();
  const now = deps.now ?? new Date();
  if (!def.family) throw new Error(`Report ${def.key} is live and has no snapshot`);
  const snap = await store.latestSnapshot<T[]>(def.family);
  return {
    rows: Array.isArray(snap?.payload) ? snap.payload : [],
    meta: describeSnapshot(snap, now),
    contactsReadAt: now,
  };
}

/**
 * The live join (A-30). Ids come from the snapshot; everything a person reads on the row comes from
 * here. A student who has since left tblStudent simply has no contact row, and the caller decides
 * whether to drop the row or show it with the id alone — dropping silently would change a count the
 * footer has already reported.
 */
export async function loadContacts(ids: string[], deps: ReportDeps = {}): Promise<Map<string, StudentContactRow>> {
  const provider = deps.provider ?? getDataProvider();
  const rows = await provider.getStudentContacts(ids);
  return new Map(rows.map((r) => [r.idnumber, r]));
}

/**
 * Capture a report population into a snapshot, pruning the previous one. Called by the worker job
 * and by the Refresh button, which routes through the same job pipeline so locking, run history and
 * the admin screen all apply to a manual run exactly as they do to a scheduled one.
 */
export async function captureReport(
  def: ReportDefinition,
  provider: DataProvider,
): Promise<{ payload: unknown; rowCount: number }> {
  if (!def.capture) throw new Error(`Report ${def.key} has no capture step`);
  return def.capture(provider);
}

/** Drop superseded snapshots of a student-level family (A-30). Safe to call when none exist. */
export async function pruneReportSnapshots(family: MetricFamily, store?: AppStore): Promise<number> {
  return (store ?? getAppStore()).pruneSnapshots(family, REPORT_SNAPSHOTS_KEPT);
}
