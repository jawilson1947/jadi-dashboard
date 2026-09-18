import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { getConfig } from "../db/config";
import { COMMON_PASSWORDS } from "./common-passwords";

const scrypt = promisify(scryptCb) as (password: string, salt: Buffer, keylen: number, options: { N: number; r: number; p: number; maxmem: number }) => Promise<Buffer>;

/**
 * Password hashing and credential policy (USER-MANAGEMENT-PLAN Sec.4).
 *
 * Algorithm: scrypt from node:crypto (RFC 7914), N=2^17, r=8, p=1 (~128 MiB, ~100 ms). Chosen over the
 * `argon2` package because it needs no native build or binary download on the Windows hosts this app
 * is deployed to; OWASP lists scrypt at these parameters as an acceptable alternative to Argon2id.
 * Parameters are embedded in the PHC string so they can be raised later; `needsRehash()` tells the
 * sign-in flow to upgrade a hash transparently on the next successful sign-in.
 */
const PARAMS = { N: 1 << 17, r: 8, p: 1 } as const;
const KEYLEN = 32;
const MAXMEM = 256 * 1024 * 1024;

export async function hashPassword(password: string, params = PARAMS): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password.normalize("NFKC"), salt, KEYLEN, { ...params, maxmem: MAXMEM });
  return `$scrypt$ln=${Math.log2(params.N)},r=${params.r},p=${params.p}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

/** Constant-time verification. Unknown formats verify as false (never throw on user input). */
export async function verifyPassword(password: string, phc: string | null): Promise<boolean> {
  const parsed = parsePhc(phc);
  if (!parsed) {
    // Burn the same CPU as a real check so a missing hash (unknown user) is not observable by timing.
    await scrypt("dummy", DUMMY_SALT, KEYLEN, { ...PARAMS, maxmem: MAXMEM });
    return false;
  }
  const key = await scrypt(password.normalize("NFKC"), parsed.salt, parsed.key.length, { N: parsed.N, r: parsed.r, p: parsed.p, maxmem: MAXMEM });
  return key.length === parsed.key.length && timingSafeEqual(key, parsed.key);
}

export function needsRehash(phc: string): boolean {
  const p = parsePhc(phc);
  return !p || p.N !== PARAMS.N || p.r !== PARAMS.r || p.p !== PARAMS.p;
}

const DUMMY_SALT = Buffer.alloc(16, 7);

function parsePhc(phc: string | null): { N: number; r: number; p: number; salt: Buffer; key: Buffer } | null {
  if (!phc) return null;
  const m = /^\$scrypt\$ln=(\d+),r=(\d+),p=(\d+)\$([A-Za-z0-9_-]+)\$([A-Za-z0-9_-]+)$/.exec(phc);
  if (!m) return null;
  return { N: 1 << Number(m[1]), r: Number(m[2]), p: Number(m[3]), salt: Buffer.from(m[4], "base64url"), key: Buffer.from(m[5], "base64url") };
}

/** Policy: minimum length, not a common/breached password, not derived from the username or email (NIST 800-63B). */
export function validateNewPassword(password: string, ctx: { username: string; email: string }): string | null {
  const min = getConfig().PASSWORD_MIN_LENGTH;
  if (password.length < min) return `Password must be at least ${min} characters.`;
  if (password.length > 256) return "Password must be at most 256 characters.";
  const lower = password.toLowerCase();
  if (COMMON_PASSWORDS.has(lower) || COMMON_PASSWORDS.has(lower.replace(/[^a-z0-9]/g, ""))) return "That password is too common. Choose something less predictable.";
  const parts = [ctx.username, ctx.email.split("@")[0]].map((s) => s.toLowerCase()).filter((s) => s.length >= 3);
  if (parts.some((p) => lower.includes(p))) return "Password must not contain your username or email address.";
  if (/^(.)\1+$/.test(password)) return "Password must not be a single repeated character.";
  return null;
}

/** One-time credential tokens: 32 random bytes, URL-safe; only the SHA-256 is stored. */
export function generateToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
