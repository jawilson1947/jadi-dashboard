import { describe, expect, it } from "vitest";
import { generateToken, hashPassword, hashToken, needsRehash, validateNewPassword, verifyPassword } from "@/server/identity/credentials";
import { isSameOrigin } from "@/server/api/respond";
import { resetRateLimitsForTests, SIGN_IN_RULE, takeToken } from "@/server/identity/rate-limit";

describe("password hashing (scrypt PHC strings)", () => {
  it("hashes with a per-user salt and verifies in constant time", async () => {
    const a = await hashPassword("correct horse battery staple");
    const b = await hashPassword("correct horse battery staple");
    expect(a).not.toBe(b);
    expect(a).toMatch(/^\$scrypt\$ln=17,r=8,p=1\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);
    expect(await verifyPassword("correct horse battery staple", a)).toBe(true);
    expect(await verifyPassword("Correct horse battery staple", a)).toBe(false);
    expect(await verifyPassword("anything", null)).toBe(false);
    expect(await verifyPassword("anything", "garbage")).toBe(false);
    expect(needsRehash(a)).toBe(false);
    expect(needsRehash("$scrypt$ln=14,r=8,p=1$aaaa$bbbb")).toBe(true);
  }, 20_000);
});

describe("password policy (NIST 800-63B; plan Sec.4 defaults)", () => {
  const ctx = { username: "jwilson", email: "jwilson@example.edu" };
  it("enforces the minimum length, the deny list and no username/email fragments", () => {
    expect(validateNewPassword("short", ctx)).toMatch(/at least 12/);
    expect(validateNewPassword("password2026!", ctx)).toMatch(/too common/);
    expect(validateNewPassword("Welcome123!!", ctx)).toMatch(/too common/);
    expect(validateNewPassword("jwilson-is-great-2026", ctx)).toMatch(/username or email/);
    expect(validateNewPassword("aaaaaaaaaaaaaa", ctx)).toMatch(/repeated/);
    expect(validateNewPassword("purple giraffe eats forty pancakes", ctx)).toBeNull();
  });
});

describe("one-time tokens", () => {
  it("are random, URL-safe and stored only as SHA-256", () => {
    const { token, hash } = generateToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hash).toBe(hashToken(token));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(generateToken().token).not.toBe(token);
  });
});

describe("sign-in rate limit", () => {
  it("allows the bucket capacity then throttles, and refills over time", () => {
    resetRateLimitsForTests();
    const t0 = Date.parse("2026-09-18T12:00:00Z");
    for (let i = 0; i < SIGN_IN_RULE.capacity; i++) expect(takeToken("k", SIGN_IN_RULE, t0)).toBe(true);
    expect(takeToken("k", SIGN_IN_RULE, t0)).toBe(false);
    expect(takeToken("k", SIGN_IN_RULE, t0 + 60_000)).toBe(true);
  });
});

describe("CSRF guard", () => {
  const req = (method: string, headers: Record<string, string>) => new Request("https://dash.example.edu/api/v1/auth/sign-in", { method, headers });
  it("allows same-origin and non-browser requests, rejects cross-site writes", () => {
    expect(isSameOrigin(req("GET", { origin: "https://evil.example" }))).toBe(true);
    expect(isSameOrigin(req("POST", { "sec-fetch-site": "same-origin", origin: "https://dash.example.edu" }))).toBe(true);
    expect(isSameOrigin(req("POST", {}))).toBe(true);
    expect(isSameOrigin(req("POST", { "sec-fetch-site": "cross-site", origin: "https://evil.example" }))).toBe(false);
    expect(isSameOrigin(req("POST", { origin: "https://evil.example" }))).toBe(false);
  });
});
