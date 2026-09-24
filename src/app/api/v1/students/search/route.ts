import { z } from "zod";
import { getPrincipal } from "@/server/auth/session";
import { requirePermission } from "@/server/authz/permissions";
import { audit } from "@/server/audit/audit";
import { handle, ok, fail } from "@/server/api/respond";
import { optionalFilter } from "@/server/api/query";
import { PAGE_SIZE_DEFAULT, SearchInputError, searchStudents } from "@/server/services/students";
import { STUDENT_SEARCH_RULE, clientIp, takeToken } from "@/server/identity/rate-limit";

const querySchema = z.object({
  by: z.enum(["name", "id"]).default("name"),
  last: optionalFilter(z.string().max(60)),
  first: optionalFilter(z.string().max(60)),
  id: optionalFilter(z.string().max(20)),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(PAGE_SIZE_DEFAULT),
});

/**
 * GET /api/v1/students/search (Spec §10.1, Bio Spec 1.1–1.2).
 *
 * Paged, ten rows at a time by default, to match the Student Lookup page: `limit` still bounds how
 * much the query is allowed to match, `pageSize` bounds how much of that comes back at once. The
 * paging figures ride in `meta` so `data.rows` stays exactly the rows the caller asked for.
 *
 * The audit row carries the SHAPE of the search and the number of hits — never the rows themselves.
 */
export const GET = handle(async (req, { correlationId }) => {
  const principal = requirePermission(await getPrincipal(), "student.view");
  const q = querySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  if (!takeToken(`student-search:${principal.userId}:${clientIp(req)}`, STUDENT_SEARCH_RULE)) {
    return fail(429, "rate_limited", "Too many searches. Wait a moment and try again.", correlationId);
  }
  try {
    const result = await searchStudents({ by: q.by, lastName: q.last, firstName: q.first, idnumber: q.id, limit: q.limit, page: q.page, pageSize: q.pageSize });
    await audit(principal, "student.search", {
      correlationId,
      targetType: "studentSearch",
      metadata: { by: q.by, hasFirstName: q.first !== undefined, resultCount: result.totalRows, truncated: result.truncated, page: result.page, pageSize: result.pageSize },
    });
    return ok(result, {
      correlationId,
      page: result.page,
      pageSize: result.pageSize,
      pageCount: result.pageCount,
      totalRows: result.totalRows,
      truncated: result.truncated,
    });
  } catch (err) {
    if (err instanceof SearchInputError) return fail(400, "invalid_search", err.message, correlationId);
    throw err;
  }
});
