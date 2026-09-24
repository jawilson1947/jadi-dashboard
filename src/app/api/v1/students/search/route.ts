import { z } from "zod";
import { getPrincipal } from "@/server/auth/session";
import { requirePermission } from "@/server/authz/permissions";
import { audit } from "@/server/audit/audit";
import { handle, ok, fail } from "@/server/api/respond";
import { optionalFilter } from "@/server/api/query";
import { SearchInputError, searchStudents } from "@/server/services/students";
import { STUDENT_SEARCH_RULE, clientIp, takeToken } from "@/server/identity/rate-limit";

const querySchema = z.object({
  by: z.enum(["name", "id"]).default("name"),
  last: optionalFilter(z.string().max(60)),
  first: optionalFilter(z.string().max(60)),
  id: optionalFilter(z.string().max(20)),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/**
 * GET /api/v1/students/search (Spec §10.1, Bio Spec 1.1–1.2).
 * The audit row carries the SHAPE of the search and the number of hits — never the rows themselves.
 */
export const GET = handle(async (req, { correlationId }) => {
  const principal = requirePermission(await getPrincipal(), "student.view");
  const q = querySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  if (!takeToken(`student-search:${principal.userId}:${clientIp(req)}`, STUDENT_SEARCH_RULE)) {
    return fail(429, "rate_limited", "Too many searches. Wait a moment and try again.", correlationId);
  }
  try {
    const result = await searchStudents({ by: q.by, lastName: q.last, firstName: q.first, idnumber: q.id, limit: q.limit });
    await audit(principal, "student.search", {
      correlationId,
      targetType: "studentSearch",
      metadata: { by: q.by, hasFirstName: q.first !== undefined, resultCount: result.rows.length, truncated: result.truncated },
    });
    return ok(result, { correlationId });
  } catch (err) {
    if (err instanceof SearchInputError) return fail(400, "invalid_search", err.message, correlationId);
    throw err;
  }
});
