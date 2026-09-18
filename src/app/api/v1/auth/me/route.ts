import { getPrincipal } from "@/server/auth/session";
import { effectivePermissions } from "@/server/authz/permissions";
import { handle, ok } from "@/server/api/respond";

/** GET /api/v1/auth/me — the signed-in principal and effective permissions (used by the UI to hide modules). */
export const GET = handle(async (_req, { correlationId }) => {
  const p = await getPrincipal();
  if (!p) return ok(null, { correlationId });
  return ok({ userId: p.userId, displayName: p.displayName, email: p.email, roles: p.roles, permissions: [...effectivePermissions(p)], mustChangePassword: p.mustChangePassword ?? false }, { correlationId });
});
