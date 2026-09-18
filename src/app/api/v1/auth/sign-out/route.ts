import { getPrincipal } from "@/server/auth/session";
import { clearSessionCookie } from "@/server/auth/cookie";
import { signOut } from "@/server/identity/service";
import { handle, ok } from "@/server/api/respond";

/** POST /api/v1/auth/sign-out — revokes the server-side session and clears the cookie. */
export const POST = handle(async (_req, { correlationId }) => {
  const principal = await getPrincipal();
  await signOut(principal, { correlationId });
  await clearSessionCookie();
  return ok({ signedOut: true }, { correlationId });
});
