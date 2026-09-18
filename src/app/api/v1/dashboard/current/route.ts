import { getPrincipal } from "@/server/auth/session";
import { requirePermission } from "@/server/authz/permissions";
import { audit } from "@/server/audit/audit";
import { getCurrentDashboard } from "@/server/services/dashboard";
import { handle, ok } from "@/server/api/respond";

/** GET /api/v1/dashboard/current — Spec §6, §17. Snapshot-backed. */
export const GET = handle(async (_req, { correlationId }) => {
  const principal = requirePermission(await getPrincipal(), "dashboard.view");
  const dashboard = await getCurrentDashboard();
  await audit(principal, "dashboard.view", { correlationId, metadata: { term: dashboard.term.current } });
  return ok(dashboard, { correlationId, capturedAt: dashboard.source.latestCapturedAt });
});
