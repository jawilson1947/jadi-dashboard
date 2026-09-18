import { z } from "zod";
import { getPrincipal } from "@/server/auth/session";
import { requirePermission } from "@/server/authz/permissions";
import { audit } from "@/server/audit/audit";
import { getDrillDown } from "@/server/services/dashboard";
import { handle, ok } from "@/server/api/respond";

const querySchema = z.object({
  population: z.enum(["enrolled", "cleared", "notCleared", "receivable", "dnc", "dnr"]),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  sort: z.enum(["lastName", "firstName", "accountBalance", "classificationCode", "status", "idnumber"]).optional(),
  direction: z.enum(["asc", "desc"]).default("asc"),
});

/** GET /api/v1/dashboard/current/students?population=… — drill-down behind each hero number (Spec §5, §6.1). */
export const GET = handle(async (req, { correlationId }) => {
  // Student-level rows require student.view, not just dashboard.view (Spec §3.3).
  const principal = requirePermission(await getPrincipal(), "student.view");
  const q = querySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  const page = await getDrillDown(q.population, {
    page: q.page,
    pageSize: q.pageSize,
    sort: q.sort ? { field: q.sort, direction: q.direction } : undefined,
  });
  await audit(principal, "student.list_view", {
    correlationId,
    targetType: "population",
    targetId: q.population,
    metadata: { page: q.page, pageSize: q.pageSize, rowsReturned: page.rows.length, totalRows: page.totalRows },
  });
  return ok(page, { correlationId });
});
