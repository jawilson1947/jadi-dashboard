import { z } from "zod";
import { getPrincipal } from "@/server/auth/session";
import { requirePermission } from "@/server/authz/permissions";
import { audit } from "@/server/audit/audit";
import { getDnrDncView } from "@/server/services/dnr-dnc";
import { handle, ok } from "@/server/api/respond";

const querySchema = z.object({
  category: z.enum(["DNR", "DNC"]).optional(),
  classification: z.string().max(10).optional(),
  lastCleared: z.string().max(50).optional(),
  minBalance: z.coerce.number().min(0).optional(),
  maxBalance: z.coerce.number().min(0).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  sort: z.enum(["default", "category", "classification", "lastName", "firstName", "accountBalance", "idnumber", "lastCleared"]).default("default"),
  direction: z.enum(["asc", "desc"]).default("asc"),
});

/** GET /api/v1/dnr-dnc — paginated DNR/DNC rows, summary cards and the filtered receivable (Spec §8). */
export const GET = handle(async (req, { correlationId }) => {
  const principal = requirePermission(await getPrincipal(), "student.view");
  const q = querySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  const view = await getDnrDncView({
    filter: { category: q.category, classification: q.classification, lastCleared: q.lastCleared, minBalance: q.minBalance, maxBalance: q.maxBalance },
    page: q.page,
    pageSize: q.pageSize,
    sort: q.sort,
    direction: q.direction,
  });
  await audit(principal, "student.list_view", {
    correlationId,
    targetType: "dnrDnc",
    targetId: view.term.current,
    metadata: { rowsReturned: view.rows.length, totalRows: view.totalRows, page: q.page, category: q.category ?? "all" },
  });
  return ok(view, { correlationId, capturedAt: view.source.readAt });
});
