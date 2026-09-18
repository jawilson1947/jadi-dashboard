import { z } from "zod";
import { getConfig } from "@/server/db/config";
import { findDevUser } from "@/server/auth/dev-users";
import { setSessionCookie } from "@/server/auth/cookie";
import { ensureDevUsersSeeded, getIdentityStore } from "@/server/identity";
import { createSessionFor, principalFrom } from "@/server/identity/service";
import { clientIp } from "@/server/identity/rate-limit";
import { audit } from "@/server/audit/audit";
import { fail, handle, ok } from "@/server/api/respond";

const bodySchema = z.object({ username: z.string().min(1).max(64) });

/**
 * POST /api/v1/auth/dev-login — synthetic accounts only (AUTH_DEV_LOGIN=true, refused in production).
 * Creates a real server-side session for the seeded dev user, so everything downstream is identical to a
 * password sign-in. Removed from non-test builds in U5 (USER-MANAGEMENT-PLAN Sec.10).
 */
export const POST = handle(async (req, { correlationId }) => {
  if (!getConfig().AUTH_DEV_LOGIN) return fail(404, "not_found", "Not found.", correlationId);
  const { username } = bodySchema.parse(await req.json());
  const dev = findDevUser(username);
  await ensureDevUsersSeeded();
  const user = dev ? await getIdentityStore().getUserByUsername(dev.username) : null;
  if (!user) {
    await audit(null, "auth.sign_in_failed", { correlationId, metadata: { method: "dev" } });
    return fail(401, "invalid_credentials", "Unknown dev user.", correlationId);
  }
  const session = await createSessionFor(user, { ip: clientIp(req), userAgent: req.headers.get("user-agent") });
  await setSessionCookie(session);
  await audit(principalFrom(user, session, new Date()), "auth.sign_in", { correlationId, metadata: { method: "dev" } });
  return ok({ displayName: user.displayName, roles: user.roles }, { correlationId });
});
