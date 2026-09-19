import { z } from "zod";
import { getPrincipal } from "@/server/auth/session";
import { requirePermission } from "@/server/authz/permissions";
import { listSprintWindows, setSprintWindow } from "@/server/services/admin";
import { handle, ok } from "@/server/api/respond";

const putSchema = z.object({
  termKey: z.string().trim().min(2).max(50),
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/** GET /api/v1/admin/metadata/sprint — configured sprint windows (A-10). */
export const GET = handle(async (_req, { correlationId }) => {
  requirePermission(await getPrincipal(), "metadata.manage");
  return ok({ windows: await listSprintWindows() }, { correlationId });
});

/** PUT /api/v1/admin/metadata/sprint — set one semester's sprint window. Audited as admin.change. */
export const PUT = handle(async (req, { correlationId }) => {
  const actor = requirePermission(await getPrincipal(), "metadata.manage");
  const body = putSchema.parse(await req.json());
  return ok(await setSprintWindow(actor, body, correlationId), { correlationId });
});
