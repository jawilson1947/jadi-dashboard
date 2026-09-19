import { z } from "zod";
import { getPrincipal } from "@/server/auth/session";
import { requirePermission } from "@/server/authz/permissions";
import { listOperators, upsertOperator } from "@/server/services/admin";
import { handle, ok } from "@/server/api/respond";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const upsertSchema = z.object({
  id: z.string().uuid().optional(),
  sourceCode: z.string().trim().min(1).max(50),
  displayName: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(320).nullable().optional(),
  department: z.string().trim().max(200).nullable().optional(),
  isActive: z.boolean().optional(),
  isSystem: z.boolean().optional(),
  effectiveFrom: isoDate.nullable().optional(),
  effectiveTo: isoDate.nullable().optional(),
});

/** GET /api/v1/admin/operators — operator profiles with effective dates (Spec §7.2). */
export const GET = handle(async (_req, { correlationId }) => {
  requirePermission(await getPrincipal(), "operator.manage");
  return ok({ operators: await listOperators() }, { correlationId });
});

/** POST /api/v1/admin/operators — create or update a profile (keyed on code + effective-from). */
export const POST = handle(async (req, { correlationId }) => {
  const actor = requirePermission(await getPrincipal(), "operator.manage");
  const body = upsertSchema.parse(await req.json());
  return ok(await upsertOperator(actor, body, correlationId), { correlationId }, { status: 201 });
});
