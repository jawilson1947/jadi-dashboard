import { getPrincipal } from "@/server/auth/session";
import { requirePermission } from "@/server/authz/permissions";
import { deleteOperator } from "@/server/services/admin";
import { fail, handle, ok } from "@/server/api/respond";

/**
 * DELETE /api/v1/admin/operators/{id} — remove an operator profile (Spec §7.2).
 *
 * Audited like the upsert. A mapping that simply ended should get an `effectiveTo` instead, so past
 * clearance actions keep resolving to whoever made them; this is for a row entered in error.
 */
export const DELETE = handle(async (req, { correlationId }) => {
  const actor = requirePermission(await getPrincipal(), "operator.manage");
  const id = decodeURIComponent(new URL(req.url).pathname.split("/").at(-1) ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fail(400, "invalid_request", "That is not a profile id.", correlationId);
  const removed = await deleteOperator(actor, id, correlationId);
  if (!removed) return fail(404, "not_found", "No operator profile with that id.", correlationId);
  return ok({ id, deleted: true }, { correlationId });
});
