import { getPrincipal } from "@/server/auth/session";
import { requirePermission } from "@/server/authz/permissions";
import { refreshClearanceBreakdown } from "@/server/services/dashboard";
import { handle, ok } from "@/server/api/respond";

/**
 * POST /api/v1/dashboard/clearance-breakdown/refresh — the card's Refresh button (Spec §7.3).
 * Requires dashboard.view (not schedule.manage): viewers may refresh this one card; the run is audited.
 */
export const POST = handle(async (_req, { correlationId }) => {
  const principal = requirePermission(await getPrincipal(), "dashboard.view");
  const run = await refreshClearanceBreakdown(principal, correlationId);
  return ok({ status: run.status, finishedAt: run.finishedAt, rowsProcessed: run.rowsProcessed, errorSummary: run.errorSummary }, { correlationId }, { status: run.status === "FAILED" ? 502 : 200 });
});
