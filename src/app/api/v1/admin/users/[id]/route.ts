import { z } from "zod";
import { getPrincipal } from "@/server/auth/session";
import { requirePermission, PERMISSIONS, ROLES } from "@/server/authz/permissions";
import { getUserDetail, updateUser } from "@/server/identity/service";
import { fail, handle, ok } from "@/server/api/respond";
import { idFromUrl } from "@/server/api/params";

const patchSchema = z.object({
  email: z.string().trim().email().max(320).optional(),
  displayName: z.string().trim().min(1).max(200).optional(),
  roles: z.array(z.enum(ROLES)).min(1).optional(),
  permissions: z.array(z.object({ key: z.enum(PERMISSIONS), expiresAt: z.string().datetime().nullable().optional() })).optional(),
  status: z.enum(["ACTIVE", "DISABLED"]).optional(),
});

/** GET /api/v1/admin/users/{id} — detail with active sessions. */
export const GET = handle(async (req, { correlationId }) => {
  requirePermission(await getPrincipal(), "user.manage");
  const detail = await getUserDetail(idFromUrl(req), { correlationId });
  if (!detail) return fail(404, "not_found", "User not found.", correlationId);
  return ok(detail, { correlationId });
});

/** PATCH /api/v1/admin/users/{id} — profile, roles, grants, status (ACTIVE ↔ DISABLED). */
export const PATCH = handle(async (req, { correlationId }) => {
  const actor = requirePermission(await getPrincipal(), "user.manage");
  const body = patchSchema.parse(await req.json());
  return ok(await updateUser(actor, idFromUrl(req), body, { correlationId }), { correlationId });
});
