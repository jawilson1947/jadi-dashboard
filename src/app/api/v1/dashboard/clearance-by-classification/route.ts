import { z } from "zod";
import { getPrincipal } from "@/server/auth/session";
import { requirePermission } from "@/server/authz/permissions";
import { getSprintView } from "@/server/services/sprint";
import { getCurrentDashboard } from "@/server/services/dashboard";
import { handle, ok } from "@/server/api/respond";

const querySchema = z.object({ scope: z.enum(["sprint", "term"]).default("sprint") });

/**
 * GET /api/v1/dashboard/clearance-by-classification (Spec §7.3, PLAN §5).
 * scope=sprint counts clearance actions inside the sprint window; scope=term is the whole term,
 * i.e. the same rows as the dashboard's Clearance Breakdown card.
 */
export const GET = handle(async (req, { correlationId }) => {
  requirePermission(await getPrincipal(), "dashboard.view");
  const { scope } = querySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  if (scope === "term") {
    const dash = await getCurrentDashboard({ autoRefresh: ["clearanceBreakdown"], autoRefreshAfterMinutes: 15 });
    return ok(
      { scope, term: { key: dash.term.current, label: dash.term.label }, window: null, rows: dash.clearanceBreakdown.value ?? [], status: dash.clearanceBreakdown.status },
      { correlationId, capturedAt: dash.clearanceBreakdown.capturedAt ?? undefined, snapshotId: dash.clearanceBreakdown.snapshotId ?? undefined },
    );
  }
  const view = await getSprintView({ autoRefreshAfterMinutes: 15 });
  return ok(
    { scope, term: view.term, window: view.window, rows: view.byClassification, status: view.metric.status },
    { correlationId, capturedAt: view.metric.capturedAt ?? undefined, snapshotId: view.metric.snapshotId ?? undefined },
  );
});
