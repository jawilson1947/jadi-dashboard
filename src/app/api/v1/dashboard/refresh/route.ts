import { z } from "zod";
import { getPrincipal } from "@/server/auth/session";
import { requirePermission } from "@/server/authz/permissions";
import { isDashboardRefreshJob, refreshDashboardJob } from "@/server/services/dashboard-refresh";
import { handle, ok, fail } from "@/server/api/respond";

const bodySchema = z.object({ job: z.string().min(1).max(64) });

/**
 * POST /api/v1/dashboard/refresh — re-capture one of the Current Semester dashboard's snapshots.
 *
 * Requires `dashboard.view`, matching the Clearance Breakdown card and the report refresh: the
 * people who read the figures are the people who need them current, and every run is audited.
 *
 * The job must be one the dashboard actually displays. An arbitrary job key here would let any
 * viewer start any scheduled job from the browser, including ones whose figures they cannot see.
 */
export const POST = handle(async (req, { correlationId }) => {
  const principal = requirePermission(await getPrincipal(), "dashboard.view");
  const { job } = bodySchema.parse(await req.json());
  if (!isDashboardRefreshJob(job)) {
    return fail(400, "not_a_dashboard_job", "That job does not back the Current Semester dashboard.", correlationId);
  }

  const result = await refreshDashboardJob(principal, job, correlationId);
  return ok(result, { correlationId }, { status: result.status === "FAILED" ? 502 : 200 });
});
