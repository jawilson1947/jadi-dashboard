import { z } from "zod";
import { getPrincipal } from "@/server/auth/session";
import { requirePermission } from "@/server/authz/permissions";
import { getHistoryView } from "@/server/services/history";
import { handle, ok } from "@/server/api/respond";

const querySchema = z.object({ from: z.string().max(20).optional(), to: z.string().max(20).optional() });

/** GET /api/v1/history/enrollment-clearance — academic-year figures plus the full-record series (Spec §9.1). */
export const GET = handle(async (req, { correlationId }) => {
  requirePermission(await getPrincipal(), "history.view");
  const q = querySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  const view = await getHistoryView({ from: q.from, to: q.to });
  return ok(
    { range: view.range, years: view.enrollment.value ?? [], series: view.series, status: view.enrollment.status },
    { correlationId, capturedAt: view.enrollment.capturedAt ?? undefined, snapshotId: view.enrollment.snapshotId ?? undefined },
  );
});
