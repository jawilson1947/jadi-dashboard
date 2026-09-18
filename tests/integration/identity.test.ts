import { beforeEach, describe, expect, it } from "vitest";
import { MemoryIdentityStore } from "@/server/identity/memory";
import { IdentityError } from "@/server/identity/types";
import { bootstrapAdministrator, changePassword, createUser, loadPrincipal, principalFrom, resetCredentials, setPasswordWithToken, signIn, signOut, unlockUser, updateUser } from "@/server/identity/service";
import { getIdentityStore, setIdentityStoreForTests, ensureDevUsersSeeded } from "@/server/identity";
import { getConfig } from "@/server/db/config";
import type { Principal } from "@/server/authz/permissions";

let store: MemoryIdentityStore;
const T0 = new Date("2026-09-18T13:00:00Z");
const at = (min: number) => new Date(T0.getTime() + min * 60_000);
const meta = { ip: "10.0.0.1", userAgent: "vitest" };
const PW = "purple giraffe eats forty pancakes";

async function admin(): Promise<Principal> {
  const { token } = await bootstrapAdministrator({ username: "jwilson", email: "jwilson@example.edu", displayName: "Jim Wilson" }, { store, now: T0 });
  const { session } = await setPasswordWithToken({ token, password: PW, ...meta }, { store, now: at(1) });
  return (await loadPrincipal(session.id, { store, now: at(2) }))!;
}

beforeEach(() => {
  store = new MemoryIdentityStore();
  setIdentityStoreForTests(store);
});

describe("identity: bootstrap → invite → set password → sign in (USER-MANAGEMENT-PLAN Sec.5)", () => {
  it("bootstraps one administrator and refuses a second bootstrap", async () => {
    const a = await admin();
    expect(a.roles).toEqual(["ADMINISTRATOR"]);
    expect(a.mustChangePassword).toBe(false);
    await expect(bootstrapAdministrator({ username: "x", email: "x@example.edu", displayName: "X" }, { store })).rejects.toMatchObject({ code: "conflict" });
  });

  it("invite token is single-use, hashed at rest, and expires; policy applies at set-password", async () => {
    const a = await admin();
    const { user, token } = await createUser(a, { username: "Olive.Op", email: "Olive@Example.edu", displayName: "Olive", roles: ["OPERATOR"] }, { store, now: at(5) });
    expect(user.username).toBe("olive.op");
    expect(user.status).toBe("INVITED");
    expect(JSON.stringify(await store.getUserById(user.id))).not.toContain(token);
    await expect(setPasswordWithToken({ token, password: "short", ...meta }, { store, now: at(6) })).rejects.toMatchObject({ code: "password_policy" });
    await expect(setPasswordWithToken({ token: "nope-nope-nope-nope", password: PW, ...meta }, { store, now: at(6) })).rejects.toMatchObject({ code: "token_invalid" });
    const hours = getConfig().CREDENTIAL_TOKEN_HOURS;
    await expect(setPasswordWithToken({ token, password: PW, ...meta }, { store, now: at(5 + hours * 60 + 1) })).rejects.toMatchObject({ code: "token_invalid" });
    const { user: activated } = await setPasswordWithToken({ token, password: PW, ...meta }, { store, now: at(7) });
    expect(activated.status).toBe("ACTIVE");
    await expect(setPasswordWithToken({ token, password: PW, ...meta }, { store, now: at(8) })).rejects.toMatchObject({ code: "token_invalid" });
    const { session } = await signIn({ username: "OLIVE.OP", password: PW, ...meta }, { store, now: at(9) });
    expect((await loadPrincipal(session.id, { store, now: at(10) }))?.roles).toEqual(["OPERATOR"]);
  }, 30_000);

  it("locks after N failures with one generic message, unlocks after the window or by an administrator", async () => {
    const a = await admin();
    const cfg = getConfig();
    for (let i = 0; i < cfg.LOCKOUT_THRESHOLD; i++) {
      await expect(signIn({ username: "jwilson", password: "wrong-wrong-wrong", ...meta }, { store, now: at(10) })).rejects.toMatchObject({ code: "invalid_credentials", status: 401 });
    }
    // Correct password is now refused with the same message
    await expect(signIn({ username: "jwilson", password: PW, ...meta }, { store, now: at(11) })).rejects.toMatchObject({ code: "invalid_credentials" });
    await expect(signIn({ username: "nobody", password: PW, ...meta }, { store, now: at(11) })).rejects.toMatchObject({ code: "invalid_credentials" });
    // After the lockout window
    await expect(signIn({ username: "jwilson", password: PW, ...meta }, { store, now: at(11 + cfg.LOCKOUT_MINUTES) })).resolves.toBeTruthy();
    // Admin unlock
    for (let i = 0; i < cfg.LOCKOUT_THRESHOLD; i++) await signIn({ username: "jwilson", password: "wrong-wrong-wrong", ...meta }, { store, now: at(40) }).catch(() => undefined);
    expect((await store.getUserById(a.userId))!.lockedUntil).not.toBeNull();
    await unlockUser(a, a.userId, { store, now: at(41) });
    await expect(signIn({ username: "jwilson", password: PW, ...meta }, { store, now: at(42) })).resolves.toBeTruthy();
  }, 60_000);

  it("sessions: idle and absolute expiry, sign-out revocation, and change-password revokes the others", async () => {
    const a = await admin();
    const cfg = getConfig();
    const s1 = (await signIn({ username: "jwilson", password: PW, ...meta }, { store, now: at(10) })).session;
    const s2 = (await signIn({ username: "jwilson", password: PW, ...meta }, { store, now: at(10) })).session;
    expect(await loadPrincipal(s1.id, { store, now: at(10 + cfg.SESSION_IDLE_HOURS * 60 + 1) })).toBeNull(); // idle
    expect(await loadPrincipal(s2.id, { store, now: at(20) })).not.toBeNull();
    const p2 = principalFrom((await store.getUserById(a.userId))!, s2, at(20));
    await changePassword(p2, { currentPassword: PW, newPassword: "orange submarine climbs the hill" }, { store, now: at(21) });
    expect(await loadPrincipal(s2.id, { store, now: at(22) })).not.toBeNull(); // own session kept
    const s3 = (await signIn({ username: "jwilson", password: "orange submarine climbs the hill", ...meta }, { store, now: at(23) })).session;
    await signOut(principalFrom((await store.getUserById(a.userId))!, s3, at(24)), { store, now: at(24) });
    expect(await loadPrincipal(s3.id, { store, now: at(25) })).toBeNull();
    expect(await loadPrincipal(s2.id, { store, now: at(10 + cfg.SESSION_ABSOLUTE_HOURS * 60 + 1) })).toBeNull(); // absolute
  }, 60_000);

  it("disable revokes sessions immediately; reset issues a new token; last-admin and self guards hold", async () => {
    const a = await admin();
    const { user: v, token } = await createUser(a, { username: "vic", email: "vic@example.edu", displayName: "Vic", roles: ["VIEWER"], permissions: [{ key: "student.view", expiresAt: at(60).toISOString() }] }, { store, now: at(5) });
    const { session } = await setPasswordWithToken({ token, password: PW, ...meta }, { store, now: at(6) });
    expect((await loadPrincipal(session.id, { store, now: at(7) }))?.extraPermissions).toEqual(["student.view"]);
    expect((await loadPrincipal(session.id, { store, now: at(61) }))?.extraPermissions).toEqual([]); // expired grant
    await updateUser(a, v.id, { status: "DISABLED" }, { store, now: at(8) });
    expect(await loadPrincipal(session.id, { store, now: at(9) })).toBeNull();
    await expect(signIn({ username: "vic", password: PW, ...meta }, { store, now: at(9) })).rejects.toMatchObject({ code: "invalid_credentials" });
    await updateUser(a, v.id, { status: "ACTIVE" }, { store, now: at(10) });
    const reset = await resetCredentials(a, v.id, { store, now: at(11) });
    await expect(signIn({ username: "vic", password: PW, ...meta }, { store, now: at(12) })).resolves.toBeTruthy(); // old password valid until the token is used
    await setPasswordWithToken({ token: reset.token, password: "green kettle whistles at dawn", ...meta }, { store, now: at(13) });
    await expect(signIn({ username: "vic", password: PW, ...meta }, { store, now: at(14) })).rejects.toMatchObject({ code: "invalid_credentials" });

    await expect(updateUser(a, a.userId, { status: "DISABLED" }, { store, now: at(15) })).rejects.toMatchObject({ code: "self_action" });
    await expect(updateUser(a, a.userId, { roles: ["VIEWER"] }, { store, now: at(15) })).rejects.toMatchObject({ code: "self_action" });
    const { user: b, token: tb } = await createUser(a, { username: "second", email: "second@example.edu", displayName: "Second Admin", roles: ["ADMINISTRATOR"] }, { store, now: at(16) });
    const pb = principalFrom((await setPasswordWithToken({ token: tb, password: PW, ...meta }, { store, now: at(17) })).user, null, at(17));
    await expect(updateUser(pb, a.userId, { status: "DISABLED" }, { store, now: at(18) })).resolves.toMatchObject({ status: "DISABLED" });
    await expect(updateUser(a, b.id, { status: "DISABLED" }, { store, now: at(19) })).rejects.toMatchObject({ code: "last_admin" });
    await expect(createUser(pb, { username: "second", email: "other@example.edu", displayName: "Dup", roles: ["VIEWER"] }, { store, now: at(20) })).rejects.toMatchObject({ code: "conflict", status: 409 });
  }, 60_000);

  it("dev accounts are seeded as passwordless users that cannot sign in with a password", async () => {
    await ensureDevUsersSeeded(store);
    const adminDev = await getIdentityStore().getUserByUsername("admin");
    expect(adminDev?.roles).toEqual(["ADMINISTRATOR"]);
    expect(adminDev?.passwordHash).toBeNull();
    await expect(signIn({ username: "admin", password: "anything at all here", ...meta }, { store, now: T0 })).rejects.toBeInstanceOf(IdentityError);
  }, 20_000);
});
