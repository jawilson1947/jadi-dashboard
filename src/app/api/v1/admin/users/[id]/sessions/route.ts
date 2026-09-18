import { getPrincipal } from "@/server/auth/session";
import { requirePermission } from "@/server/authz/permissions";
import { revokeAllSessions } from "@/server/identity/service";
import { handle, ok } from "@/server/api/respond";
import { idFromUrl } from "@/server/api/params";

/** DELETE /api/v1/admin/users/{id}/sessions — sign the user out everywhere. */
export const DELETE = handle(async (req, { correlationId }) => {
  const actor = requirePermission(await getPrincipal(), "user.manage");
  return ok({ sessionsRevoked: await revokeAllSessions(actor, idFromUrl(req, 2), { correlationId }) }, { correlationId });
});
