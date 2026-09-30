import { runJob } from "../jobs/runner";
import { audit } from "../audit/audit";
import type { Principal } from "../authz/permissions";
import type { JobKey } from "../store/types";

/**
 * What "refresh this page" means on the Current Semester dashboard (Spec §6).
 *
 * The list is here rather than in the component so the button, the API route and the audit row
 * cannot disagree about what was refreshed. Every entry is a snapshot family the dashboard
 * actually reads — refreshing anything else would re-run an expensive source query for a figure
 * that is not on screen.
 *
 * Order matters to the person watching: the hero figures move first, because they are what the
 * eye goes to, and the breakdown last because it is the slowest.
 */
export const DASHBOARD_REFRESH_JOBS: { key: JobKey; label: string }[] = [
  { key: "dashboard.enrollmentClearance", label: "Enrolled vs. cleared" },
  { key: "dashboard.currentReceivable", label: "Current receivable" },
  { key: "dashboard.dnrDnc", label: "DNC / DNR" },
  { key: "dashboard.chargesCredits", label: "Charges and credits" },
  { key: "dashboard.clearanceBreakdown", label: "Clearance breakdown" },
];

export function isDashboardRefreshJob(key: string): key is JobKey {
  return DASHBOARD_REFRESH_JOBS.some((j) => j.key === key);
}

export interface DashboardRefreshResult {
  key: string;
  label: string;
  status: string;
  rowsProcessed: number | null;
  durationMs: number | null;
  errorSummary: string | null;
}

/**
 * Refresh one of the dashboard's jobs.
 *
 * ONE JOB PER CALL, deliberately. The button walks the list so the person sees which figure is
 * being recomputed rather than a spinner over an opaque wait — these are 40-120 s source queries
 * (FINDINGS §6) and a single blind request would look like a hang. It also means one job failing
 * does not discard the four that succeeded.
 *
 * Gated at the route on `dashboard.view`, following the Clearance Breakdown card and the report
 * refresh: the people who read the figures are the people who need them current. The run goes
 * through runJob, so the job lock, the run history and the admin screen apply exactly as they do
 * to the nightly schedule — a manual refresh is not a second code path that can drift.
 */
export async function refreshDashboardJob(
  actor: Principal,
  key: JobKey,
  correlationId: string,
): Promise<DashboardRefreshResult> {
  const entry = DASHBOARD_REFRESH_JOBS.find((j) => j.key === key)!;
  // No ignoreMinInterval: the job's own minimum interval is the rate limit, so leaning on the
  // button returns SKIPPED_OVERLAP rather than starting another scan of the slow views.
  const run = await runJob(key, { triggeredBy: `manual:${actor.userId}` });
  await audit(actor, "dashboard.refresh", {
    correlationId,
    targetType: "job",
    targetId: key,
    metadata: { status: run.status, durationMs: run.durationMs, rows: run.rowsProcessed, via: "page-refresh" },
  });
  return {
    key,
    label: entry.label,
    status: run.status,
    rowsProcessed: run.rowsProcessed,
    durationMs: run.durationMs,
    errorSummary: run.errorSummary,
  };
}
