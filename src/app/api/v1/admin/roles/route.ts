import { getPrincipal } from "@/server/auth/session";
import { PERMISSIONS, ROLE_PERMISSIONS, ROLES, requirePermission } from "@/server/authz/permissions";
import { handle, ok } from "@/server/api/respond";

/** GET /api/v1/admin/roles — roles with their default permission sets, and the full permission list. */
export const GET = handle(async (_req, { correlationId }) => {
  requirePermission(await getPrincipal(), "user.manage");
  return ok({ roles: ROLES.map((key) => ({ key, permissions: ROLE_PERMISSIONS[key] })), permissions: PERMISSIONS }, { correlationId });
});
