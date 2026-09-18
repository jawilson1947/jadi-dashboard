import { getPrincipal } from "@/server/auth/session";
import { requirePermission } from "@/server/authz/permissions";
import { resetCredentials } from "@/server/identity/service";
import { handle, ok } from "@/server/api/respond";
import { idFromUrl } from "@/server/api/params";

/** POST /api/v1/admin/users/{id}/reset — new one-time token; all sessions revoked. */
export const POST = handle(async (req, { correlationId }) => {
  const actor = requirePermission(await getPrincipal(), "user.manage");
  return ok(await resetCredentials(actor, idFromUrl(req, 2), { correlationId }), { correlationId });
});
