import { z } from "zod";
import { getPrincipal } from "@/server/auth/session";
import { requirePermission } from "@/server/authz/permissions";
import { audit } from "@/server/audit/audit";
import { getCurrentSprintWindow, getSprintDrillDown } from "@/server/services/sprint";
import { handle, fail, ok } from "@/server/api/respond";

const querySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  operator: z.string().max(100).optional(),
  classification: z.string().max(10).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  sort: z.enum(["lastName", "firstName", "accountBalance", "classificationCode", "idnumber", "clearedAt"]).optional(),
  direction: z.enum(["asc", "desc"]).default("asc"),
});

/** GET /api/v1/dashboard/sprint/students — students behind a sprint day, operator or classification (Spec §7). */
export const GET = handle(async (req, { correlationId }) => {
  const principal = requirePermission(await getPrincipal(), "student.view");
  const q = querySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  const { termKey, window } = await getCurrentSprintWindow();
  if (!window) return fail(409, "sprint_not_configured", "Sprint dates have not been set for this semester.", correlationId);

  const page = await getSprintDrillDown(
    { range: { start: window.start, end: window.end }, date: q.date, operatorCode: q.operator, classificationCode: q.classification },
    { page: q.page, pageSize: q.pageSize, sort: q.sort ? { field: q.sort, direction: q.direction } : undefined },
  );
  await audit(principal, "student.list_view", {
    correlationId,
    targetType: "sprint",
    targetId: q.date ?? q.operator ?? q.classification ?? "window",
    metadata: { term: termKey, rowsReturned: page.rows.length, totalRows: page.totalRows, page: q.page, pageSize: q.pageSize },
  });
  return ok(page, { correlationId });
});
