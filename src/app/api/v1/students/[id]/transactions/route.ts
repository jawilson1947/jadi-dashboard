import { z } from "zod";
import { getPrincipal } from "@/server/auth/session";
import { requirePermission } from "@/server/authz/permissions";
import { audit } from "@/server/audit/audit";
import { handle, ok } from "@/server/api/respond";
import { idFromUrl } from "@/server/api/params";
import { optionalFilter } from "@/server/api/query";
import { getTransactionsView } from "@/server/services/transactions";

const querySchema = z.object({
  scope: z.enum(["current", "global"]).default("global"),
  year: optionalFilter(z.string().regex(/^\d{4}$/)),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(5).max(200).default(50),
});

/**
 * GET /api/v1/students/{id}/transactions (Spec §10.3, Bio Spec card 2).
 * `scope=global` reaches the linked server A-24 has not cleared; when it is not enabled the provider
 * throws and the envelope reports an unavailable source rather than an empty history.
 */
export const GET = handle(async (req, { correlationId }) => {
  const principal = requirePermission(await getPrincipal(), "student.transactions.view");
  const id = idFromUrl(req, 2);
  const q = querySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  const view = await getTransactionsView(id, q);
  await audit(principal, "student.transactions_view", {
    correlationId,
    targetType: "student",
    targetId: id,
    metadata: { scope: q.scope, year: view.year ?? "all", rowsReturned: view.rows.length, totalRows: view.allRows },
  });
  return ok(view, { correlationId });
});
