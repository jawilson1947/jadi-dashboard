import { z } from "zod";
import { getPrincipal } from "@/server/auth/session";
import { requirePermission } from "@/server/authz/permissions";
import { checkStudentClearance } from "@/server/services/clearance-check";
import { fail, handle, ok } from "@/server/api/respond";
import { parseReturnTo, withReturnTo } from "@/lib/return-to";

// `from` is the result card the profile was opened from; it rides through the 303 so the write
// action does not strand the user back at an empty search form. Validated in lib/return-to.
const bodySchema = z.object({ id: z.string().min(1).max(20), from: z.string().max(400).optional() });

async function readBody(req: Request): Promise<Record<string, unknown>> {
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("application/json")) return (await req.json()) as Record<string, unknown>;
  const form = await req.formData();
  return Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === "string" && v !== "")) as Record<string, unknown>;
}

/**
 * POST /api/v1/students/clearance-check — reconcile a student's clearance flag with the source
 * clearance actions (A-34).
 *
 * Requires `student.update`, the same gate as the Update Semester button beside it
 * (J. Wilson, 2026-09-30): both correct an existing student's record, and an operator trusted with
 * one is trusted with the other. It is not `student.create`, which creates records.
 *
 * A browser form post gets a 303 back to the profile, carrying the outcome so the card can report
 * it. JSON clients get JSON.
 */
export const POST = handle(async (req, { correlationId }) => {
  const principal = requirePermission(await getPrincipal(), "student.update");
  const q = bodySchema.parse(await readBody(req));
  const id = q.id.trim();
  const returnTo = parseReturnTo(q.from);

  const attempt = await checkStudentClearance(principal, id, correlationId);

  const wantsRedirect = !(req.headers.get("content-type") ?? "").includes("application/json");
  if (wantsRedirect) {
    // Back to the Bio tab either way: on success it re-reads and the card shows Yes with the
    // semester and date filled in; on no_clearance_record it reports that nothing changed.
    const url = new URL(withReturnTo(`/students/${encodeURIComponent(id)}?clearance=${attempt.status}`, returnTo), req.url);
    return new Response(null, { status: 303, headers: { location: url.toString() } });
  }

  if (attempt.status === "unavailable") return fail(503, "clearance_check_unavailable", attempt.message, correlationId);
  return ok({ status: attempt.status, lastCleared: attempt.lastCleared, clearedOn: attempt.clearedOn, message: attempt.message }, { correlationId });
});
