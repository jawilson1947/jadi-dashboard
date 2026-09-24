import { getPrincipal } from "@/server/auth/session";
import { requirePermission } from "@/server/authz/permissions";
import { audit } from "@/server/audit/audit";
import { handle, ok, fail } from "@/server/api/respond";
import { idFromUrl } from "@/server/api/params";
import { NotCurrentTermError, getClearanceAnalysis } from "@/server/services/clearance-analysis";

/**
 * GET /api/v1/students/{id}/clearance-analysis (Spec §10.4–10.5, Bio Spec cards 4–5).
 * Bio Spec 1.4.4: a student whose record is not on the current semester gets an explicit 409 with a
 * plain-language reason, not an empty analysis that reads like "nothing owed".
 */
export const GET = handle(async (req, { correlationId }) => {
  const principal = requirePermission(await getPrincipal(), "student.clearance.analyze");
  const id = idFromUrl(req, 2);
  try {
    const analysis = await getClearanceAnalysis(id);
    await audit(principal, "student.clearance_analyze", {
      correlationId,
      targetType: "student",
      targetId: id,
      metadata: { items: analysis.items.length, status: analysis.status },
    });
    return ok(analysis, { correlationId });
  } catch (err) {
    if (err instanceof NotCurrentTermError) {
      return fail(409, "not_current_term", "Financial clearance analysis is reserved for students enrolled in the current semester.", correlationId);
    }
    throw err;
  }
});
