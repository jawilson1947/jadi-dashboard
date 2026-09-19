import { getPrincipal } from "@/server/auth/session";
import { requirePermission } from "@/server/authz/permissions";
import { getHistoryView } from "@/server/services/history";
import { handle, ok } from "@/server/api/respond";

/** GET /api/v1/history/balances — global receivables and credit balances (Spec §9.2; A-5, A-18). */
export const GET = handle(async (_req, { correlationId }) => {
  requirePermission(await getPrincipal(), "history.view");
  const view = await getHistoryView();
  return ok(
    { balances: view.balances.value, labels: view.labels, status: view.balances.status },
    { correlationId, capturedAt: view.balances.capturedAt ?? undefined, snapshotId: view.balances.snapshotId ?? undefined },
  );
});
