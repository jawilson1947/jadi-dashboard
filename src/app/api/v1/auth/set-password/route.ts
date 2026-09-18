import { z } from "zod";
import { setSessionCookie } from "@/server/auth/cookie";
import { setPasswordWithToken } from "@/server/identity/service";
import { clientIp, takeToken, TOKEN_RULE } from "@/server/identity/rate-limit";
import { fail, handle, ok } from "@/server/api/respond";

const bodySchema = z.object({ token: z.string().trim().min(16).max(128), password: z.string().min(1).max(256) });

/** POST /api/v1/auth/set-password — completes an INVITE or RESET token and signs the user in. */
export const POST = handle(async (req, { correlationId }) => {
  const body = bodySchema.parse(await req.json());
  const ip = clientIp(req);
  if (!takeToken(`setpw:ip:${ip}`, TOKEN_RULE)) return fail(429, "rate_limited", "Too many attempts. Try again in a few minutes.", correlationId);
  const { user, session } = await setPasswordWithToken({ ...body, ip, userAgent: req.headers.get("user-agent") }, { correlationId });
  await setSessionCookie(session);
  return ok({ displayName: user.displayName, roles: user.roles }, { correlationId });
});
