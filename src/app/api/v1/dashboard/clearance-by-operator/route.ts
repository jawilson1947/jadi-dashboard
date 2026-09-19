import { getPrincipal } from "@/server/auth/session";
import { requirePermission } from "@/server/authz/permissions";
import { getSprintView } from "@/server/services/sprint";
import { handle, ok } from "@/server/api/respond";

/** GET /api/v1/dashboard/clearance-by-operator — per ClearedBy code, names resolved (Spec §7.2, PLAN §5). */
export const GET = handle(async (_req, { correlationId }) => {
  requirePermission(await getPrincipal(), "dashboard.view");
  const view = await getSprintView({ autoRefreshAfterMinutes: 15 });
  const unmapped = view.byOperator.filter((r) => !r.mapped).reduce((s, r) => s + r.cleared, 0);
  return ok(
    { term: view.term, window: view.window, rows: view.byOperator, unmapped, total: view.totals.cleared, status: view.metric.status },
    { correlationId, capturedAt: view.metric.capturedAt ?? undefined, snapshotId: view.metric.snapshotId ?? undefined },
  );
});
