import { z } from "zod";
import { setSessionCookie } from "@/server/auth/cookie";
import { signIn } from "@/server/identity/service";
import { clientIp, SIGN_IN_RULE, takeToken } from "@/server/identity/rate-limit";
import { fail, handle, ok } from "@/server/api/respond";

const bodySchema = z.object({ username: z.string().trim().min(1).max(64), password: z.string().min(1).max(256) });

/** POST /api/v1/auth/sign-in — local username + password (USER-MANAGEMENT-PLAN Sec.5). Rate-limited per IP and per IP+username. */
export const POST = handle(async (req, { correlationId }) => {
  const body = bodySchema.parse(await req.json());
  const ip = clientIp(req);
  if (!takeToken(`signin:ip:${ip}`, SIGN_IN_RULE) || !takeToken(`signin:user:${ip}:${body.username.toLowerCase()}`, SIGN_IN_RULE)) {
    return fail(429, "rate_limited", "Too many sign-in attempts. Try again in a minute.", correlationId);
  }
  const { user, session } = await signIn({ ...body, ip, userAgent: req.headers.get("user-agent") }, { correlationId });
  await setSessionCookie(session);
  return ok({ displayName: user.displayName, roles: user.roles, mustChangePassword: user.mustChangePassword }, { correlationId });
});
