import { cookies } from "next/headers";
import type { SessionRecord } from "../identity/types";
import { encodeSessionCookie, SESSION_COOKIE, sessionCookieOptions } from "./session";

/** Set the session cookie for a freshly created server-side session. */
export async function setSessionCookie(session: SessionRecord): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, encodeSessionCookie(session.id), sessionCookieOptions(session.expiresAt));
}

export async function clearSessionCookie(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}
