import { z } from "zod";
import { getPrincipal } from "@/server/auth/session";
import { hasPermission, requirePermission } from "@/server/authz/permissions";
import { audit } from "@/server/audit/audit";
import { handle, ok, fail } from "@/server/api/respond";
import { idFromUrl } from "@/server/api/params";
import { getStudentProfile } from "@/server/services/students";

const querySchema = z.object({ reveal: z.enum(["dob"]).optional() });

/**
 * GET /api/v1/students/{id} (Spec §10.2, Bio Spec card 1).
 * `?reveal=dob` returns the unmasked date of birth to holders of student.pii.view and writes a
 * separate audit row: the reveal is a deliberate act, recorded as one (A-29).
 */
export const GET = handle(async (req, { correlationId }) => {
  const principal = requirePermission(await getPrincipal(), "student.view");
  const id = idFromUrl(req);
  const q = querySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  const revealDob = q.reveal === "dob" && hasPermission(principal, "student.pii.view");
  const profile = await getStudentProfile(id, principal, { revealDob });
  if (!profile) return fail(404, "not_found", "No student with that ID.", correlationId);

  await audit(principal, "student.profile_view", { correlationId, targetType: "student", targetId: id, metadata: { via: "api" } });
  if (revealDob) await audit(principal, "student.pii_reveal", { correlationId, targetType: "student", targetId: id, metadata: { field: "dob" } });
  return ok(profile, { correlationId });
});
