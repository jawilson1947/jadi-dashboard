import { createHmac, timingSafeEqual } from "node:crypto";
import { cache } from "react";
import { cookies } from "next/headers";
import { getConfig } from "../db/config";
import type { Principal } from "../authz/permissions";
import { loadPrincipal } from "../identity/service";

/**
 * Session cookie (USER-MANAGEMENT-PLAN Sec.4). The cookie carries ONLY an HMAC-signed session id; the
 * session itself (user, expiry, revocation) lives server-side in the IdentityStore, so disabling a user or
 * changing a password takes effect on the next request. HttpOnly, SameSite=Lax, Secure outside development.
 *
 * `getPrincipal()` is the only entry point the rest of the app uses; the SSO phase creates sessions through
 * the same store and needs no change here.
 */
export const SESSION_COOKIE = "jadi_session";

function sign(data: string, secret: string): string {
  return createHmac("sha256", secret).update(data).digest("base64url");
}

/** cookie value = <sessionId>.<hmac(sessionId)> */
export function encodeSessionCookie(sessionId: string, secret = getConfig().SESSION_SECRET): string {
  return `${sessionId}.${sign(sessionId, secret)}`;
}

/** Returns the session id when the signature verifies, else null. Constant-time comparison. */
export function decodeSessionCookie(value: string | undefined, secret = getConfig().SESSION_SECRET): string | null {
  if (!value) return null;
  const dot = value.lastIndexOf(".");
  if (dot <= 0) return null;
  const id = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const a = Buffer.from(sig);
  const b = Buffer.from(sign(id, secret));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return id.toLowerCase();
}

/** Current principal from the request cookies, or null when signed out. Cached per request. */
export const getPrincipal = cache(async (): Promise<Principal | null> => {
  const store = await cookies();
  const sessionId = decodeSessionCookie(store.get(SESSION_COOKIE)?.value);
  if (!sessionId) return null;
  return loadPrincipal(sessionId);
});

export function sessionCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: getConfig().APP_ENV !== "development",
    path: "/",
    expires: expiresAt,
  };
}
