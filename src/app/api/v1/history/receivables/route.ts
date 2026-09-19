import { z } from "zod";
import { getPrincipal } from "@/server/auth/session";
import { requirePermission } from "@/server/authz/permissions";
import { getHistoryView } from "@/server/services/history";
import { handle, ok } from "@/server/api/respond";

const querySchema = z.object({ groupBy: z.enum(["semester", "schoolYear"]).default("semester") });

/** GET /api/v1/history/receivables — debit balances by semester or school year (Spec §9.3; A-22, A-23). */
export const GET = handle(async (req, { correlationId }) => {
  requirePermission(await getPrincipal(), "history.view");
  const { groupBy } = querySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  const view = await getHistoryView({ groupBy });
  return ok(
    { receivables: view.receivables.value, reconcilesWithGlobal: view.reconciles, status: view.receivables.status },
    { correlationId, capturedAt: view.receivables.capturedAt ?? undefined, snapshotId: view.receivables.snapshotId ?? undefined },
  );
});
