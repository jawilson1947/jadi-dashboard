import { getPrincipal } from "@/server/auth/session";
import { requirePermission } from "@/server/authz/permissions";
import { getSprintView } from "@/server/services/sprint";
import { handle, ok } from "@/server/api/respond";

/** GET /api/v1/dashboard/clearance-by-date — daily counts with running totals (Spec §7.1, PLAN §5). */
export const GET = handle(async (_req, { correlationId }) => {
  requirePermission(await getPrincipal(), "dashboard.view");
  const view = await getSprintView({ autoRefreshAfterMinutes: 15 });
  return ok(
    { term: view.term, window: view.window, rows: view.byDate, total: view.totals.cleared, status: view.metric.status },
    { correlationId, capturedAt: view.metric.capturedAt ?? undefined, snapshotId: view.metric.snapshotId ?? undefined },
  );
});
