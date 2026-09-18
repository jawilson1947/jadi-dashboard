import { z } from "zod";
import { getPrincipal } from "@/server/auth/session";
import { UnauthenticatedError } from "@/server/authz/permissions";
import { changePassword } from "@/server/identity/service";
import { handle, ok } from "@/server/api/respond";

const bodySchema = z.object({ currentPassword: z.string().min(1).max(256), newPassword: z.string().min(1).max(256) });

/** POST /api/v1/auth/change-password — requires the current password; other sessions are revoked. */
export const POST = handle(async (req, { correlationId }) => {
  const principal = await getPrincipal();
  if (!principal) throw new UnauthenticatedError();
  const body = bodySchema.parse(await req.json());
  await changePassword(principal, body, { correlationId });
  return ok({ changed: true }, { correlationId });
});
