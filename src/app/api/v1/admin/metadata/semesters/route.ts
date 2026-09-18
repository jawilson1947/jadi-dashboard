import { getPrincipal } from "@/server/auth/session";
import { requirePermission } from "@/server/authz/permissions";
import { getCurrentTerms, academicYearOf } from "@/server/metadata/terms";
import { handle, ok } from "@/server/api/respond";

/** GET /api/v1/admin/metadata/semesters — tblOUSA read-through (A-20). Read-only in Phase 2. */
export const GET = handle(async (_req, { correlationId }) => {
  requirePermission(await getPrincipal(), "metadata.manage");
  const t = await getCurrentTerms();
  return ok(
    { current: t.current.tradName, previous: t.previous.tradName, source: t.source, semesters: t.all.map((s) => ({ ...s, academicYear: academicYearOf(s) })) },
    { correlationId, capturedAt: t.source.capturedAt.toISOString() },
  );
});
