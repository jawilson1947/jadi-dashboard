import { z } from "zod";
import { getPrincipal } from "@/server/auth/session";
import { requirePermission, PERMISSIONS, ROLES } from "@/server/authz/permissions";
import { createUser, listUsers } from "@/server/identity/service";
import { handle, ok } from "@/server/api/respond";

const listSchema = z.object({
  q: z.string().trim().max(200).optional(),
  status: z.enum(["ACTIVE", "DISABLED", "INVITED"]).optional(),
  role: z.enum(ROLES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

const createSchema = z.object({
  username: z.string().trim().min(2).max(64),
  email: z.string().trim().email().max(320),
  displayName: z.string().trim().min(1).max(200),
  roles: z.array(z.enum(ROLES)).min(1),
  permissions: z.array(z.object({ key: z.enum(PERMISSIONS), expiresAt: z.string().datetime().nullable().optional() })).optional(),
});

/** GET /api/v1/admin/users — paginated, filterable list (never includes hashes). */
export const GET = handle(async (req, { correlationId }) => {
  requirePermission(await getPrincipal(), "user.manage");
  const url = new URL(req.url);
  const f = listSchema.parse(Object.fromEntries(url.searchParams));
  return ok(await listUsers({ q: f.q || undefined, status: f.status, role: f.role, page: f.page, pageSize: f.pageSize }), { correlationId });
});

/** POST /api/v1/admin/users — create; the response carries the one-time invite token exactly once. */
export const POST = handle(async (req, { correlationId }) => {
  const actor = requirePermission(await getPrincipal(), "user.manage");
  const body = createSchema.parse(await req.json());
  const result = await createUser(actor, body, { correlationId });
  return ok(result, { correlationId }, { status: 201 });
});
