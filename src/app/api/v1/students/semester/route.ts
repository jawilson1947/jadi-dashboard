import { z } from "zod";
import { getPrincipal } from "@/server/auth/session";
import { requirePermission } from "@/server/authz/permissions";
import { updateStudentSemester } from "@/server/services/semester-update";
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
 * POST /api/v1/students/semester — set a student's semester from their Jenzabar registration (A-33).
 *
 * Requires `student.update`, which administrators hold by default and may grant to operators. It is
 * deliberately not `student.create`: creating a record and rewriting an existing student's semester
 * are different acts, and the audit log should be able to tell them apart.
 *
 * A browser form post gets a 303 back to the profile, carrying the outcome so the card can report
 * it. JSON clients get JSON.
 */
export const POST = handle(async (req, { correlationId }) => {
  const principal = requirePermission(await getPrincipal(), "student.update");
  const q = bodySchema.parse(await readBody(req));
  const id = q.id.trim();
  const returnTo = parseReturnTo(q.from);

  const attempt = await updateStudentSemester(principal, id, correlationId);

  const wantsRedirect = !(req.headers.get("content-type") ?? "").includes("application/json");
  if (wantsRedirect) {
    // Back to the Bio tab either way: on success it re-reads and shows the new semester (step 3),
    // and on no_registration the card relabels to "No Semester Info found" (step 4).
    const url = new URL(withReturnTo(`/students/${encodeURIComponent(id)}?semester=${attempt.status}`, returnTo), req.url);
    return new Response(null, { status: 303, headers: { location: url.toString() } });
  }

  if (attempt.status === "unavailable") return fail(503, "semester_update_unavailable", attempt.message, correlationId);
  return ok({ status: attempt.status, lastCleared: attempt.lastCleared, message: attempt.message }, { correlationId });
});
