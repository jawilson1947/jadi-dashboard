import { randomUUID } from "node:crypto";
import { getConfig } from "../db/config";
import { audit } from "../audit/audit";
import { PERMISSIONS, ROLES, type Permission, type Principal, type Role } from "../authz/permissions";
import { generateToken, hashPassword, hashToken, needsRehash, validateNewPassword, verifyPassword } from "./credentials";
import { getIdentityStore } from "./index";
import { IdentityError, type IdentityStore, type PermissionGrant, type SessionRecord, type TokenPurpose, type UserListFilter, type UserRecord, type UserStatus } from "./types";

/**
 * Identity service (USER-MANAGEMENT-PLAN Sec.5). Every state change is audited; no password, token or hash
 * ever appears in a return value that reaches the API except the one-time token handed to the administrator.
 */
export interface Ctx {
  store?: IdentityStore;
  now?: Date;
  correlationId?: string;
}

const deps = (c: Ctx) => ({ store: c.store ?? getIdentityStore(), now: c.now ?? new Date(), correlationId: c.correlationId });

/** User as exposed to the API/UI — never the hash. */
export type PublicUser = Omit<UserRecord, "passwordHash"> & { hasPassword: boolean; isLocked: boolean };

export function toPublicUser(u: UserRecord, now = new Date()): PublicUser {
  const { passwordHash, ...rest } = u;
  return { ...rest, hasPassword: passwordHash !== null, isLocked: u.lockedUntil !== null && u.lockedUntil.getTime() > now.getTime() };
}

export function principalFrom(user: UserRecord, session: SessionRecord | null, now: Date): Principal {
  return {
    userId: user.id,
    displayName: user.displayName,
    email: user.email,
    roles: user.roles,
    extraPermissions: user.permissions.filter((p) => !p.expiresAt || p.expiresAt.getTime() > now.getTime()).map((p) => p.key),
    sessionId: session?.id,
    mustChangePassword: user.mustChangePassword,
    hasLocalPassword: user.passwordHash !== null,
  };
}

// ── Sessions ─────────────────────────────────────────────────────────────────

export async function createSessionFor(user: UserRecord, meta: { ip: string | null; userAgent: string | null }, c: Ctx = {}): Promise<SessionRecord> {
  const { store, now } = deps(c);
  const cfg = getConfig();
  const session: SessionRecord = {
    id: randomUUID(),
    userId: user.id,
    createdAt: now,
    lastSeenAt: now,
    expiresAt: new Date(now.getTime() + cfg.SESSION_ABSOLUTE_HOURS * 3_600_000),
    ip: meta.ip,
    userAgent: meta.userAgent?.slice(0, 400) ?? null,
    revokedAt: null,
    revokedReason: null,
  };
  await store.createSession(session);
  await store.updateUser(user.id, { lastSignInAt: now, updatedAt: now });
  return session;
}

/** Touch threshold: write lastSeenAt at most once per minute per session to keep page loads cheap. */
const TOUCH_MS = 60_000;

/** Resolve a session id to a Principal, enforcing revocation, idle and absolute expiry, and user status. */
export async function loadPrincipal(sessionId: string, c: Ctx = {}): Promise<Principal | null> {
  const { store, now } = deps(c);
  const cfg = getConfig();
  const session = await store.getSession(sessionId);
  if (!session || session.revokedAt) return null;
  if (session.expiresAt.getTime() <= now.getTime()) return null;
  if (now.getTime() - session.lastSeenAt.getTime() > cfg.SESSION_IDLE_HOURS * 3_600_000) {
    await store.revokeSession(session.id, "expired", now);
    return null;
  }
  const user = await store.getUserById(session.userId);
  if (!user || user.status !== "ACTIVE") return null;
  if (now.getTime() - session.lastSeenAt.getTime() > TOUCH_MS) await store.touchSession(session.id, now);
  return principalFrom(user, session, now);
}

export async function signOut(principal: Principal | null, c: Ctx = {}): Promise<void> {
  const { store, now, correlationId } = deps(c);
  if (principal?.sessionId) await store.revokeSession(principal.sessionId, "sign_out", now);
  await audit(principal, "auth.sign_out", { correlationId });
}

// ── Sign in ──────────────────────────────────────────────────────────────────

const GENERIC = "The username or password is incorrect, or the account is not available.";

export async function signIn(input: { username: string; password: string; ip: string | null; userAgent: string | null }, c: Ctx = {}): Promise<{ user: UserRecord; session: SessionRecord }> {
  const { store, now, correlationId } = deps(c);
  const cfg = getConfig();
  const username = input.username.trim().toLowerCase();
  const user = await store.getUserByUsername(username);
  const usernameHash = hashToken(username).slice(0, 16);

  // One code path for every failure so timing and the response do not reveal which check failed.
  const fail = async (reason: string) => {
    await audit(null, "auth.sign_in_failed", { correlationId, metadata: { method: "password", reason, usernameHash } });
    throw new IdentityError("invalid_credentials", GENERIC, 401);
  };

  if (!user || user.status !== "ACTIVE" || user.passwordHash === null) {
    await verifyPassword(input.password, null); // burn the same time as a real check
    return fail(!user ? "unknown_user" : user.status !== "ACTIVE" ? "status_" + user.status.toLowerCase() : "no_password");
  }
  if (user.lockedUntil && user.lockedUntil.getTime() > now.getTime()) {
    await verifyPassword(input.password, null);
    return fail("locked");
  }
  const okPw = await verifyPassword(input.password, user.passwordHash);
  if (!okPw) {
    const failed = user.failedSignIns + 1;
    const lock = failed >= cfg.LOCKOUT_THRESHOLD;
    await store.updateUser(user.id, { failedSignIns: lock ? 0 : failed, lockedUntil: lock ? new Date(now.getTime() + cfg.LOCKOUT_MINUTES * 60_000) : user.lockedUntil, updatedAt: now });
    if (lock) await audit(null, "user.locked", { correlationId, targetType: "user", targetId: user.id, metadata: { minutes: cfg.LOCKOUT_MINUTES } });
    return fail(lock ? "locked_now" : "bad_password");
  }

  const patch: Parameters<IdentityStore["updateUser"]>[1] = { failedSignIns: 0, lockedUntil: null, updatedAt: now };
  if (needsRehash(user.passwordHash)) {
    patch.passwordHash = await hashPassword(input.password);
  }
  await store.updateUser(user.id, patch);
  const session = await createSessionFor(user, input, c);
  await audit(principalFrom(user, session, now), "auth.sign_in", { correlationId, metadata: { method: "password" } });
  return { user, session };
}

// ── Passwords and tokens ─────────────────────────────────────────────────────

async function issueToken(user: UserRecord, purpose: TokenPurpose, c: Ctx): Promise<string> {
  const { store, now } = deps(c);
  await store.invalidateUserTokens(user.id, now);
  const { token, hash } = generateToken();
  await store.createToken({ id: randomUUID(), userId: user.id, tokenHash: hash, purpose, expiresAt: new Date(now.getTime() + getConfig().CREDENTIAL_TOKEN_HOURS * 3_600_000), usedAt: null, createdAt: now });
  return token;
}

/** Completes an INVITE or RESET: verifies the one-time token, applies policy, stores the hash, activates. */
export async function setPasswordWithToken(input: { token: string; password: string; ip: string | null; userAgent: string | null }, c: Ctx = {}): Promise<{ user: UserRecord; session: SessionRecord }> {
  const { store, now, correlationId } = deps(c);
  const rec = await store.findTokenByHash(hashToken(input.token.trim()));
  if (!rec || rec.usedAt || rec.expiresAt.getTime() <= now.getTime()) {
    await audit(null, "credential.token_rejected", { correlationId });
    throw new IdentityError("token_invalid", "This link is invalid or has expired. Ask an administrator for a new one.", 400);
  }
  const user = await store.getUserById(rec.userId);
  if (!user || user.status === "DISABLED") throw new IdentityError("token_invalid", "This link is invalid or has expired. Ask an administrator for a new one.", 400);
  const policy = validateNewPassword(input.password, user);
  if (policy) throw new IdentityError("password_policy", policy, 400);

  await store.markTokenUsed(rec.id, now);
  await store.updateUser(user.id, { passwordHash: await hashPassword(input.password), passwordSetAt: now, mustChangePassword: false, failedSignIns: 0, lockedUntil: null, status: "ACTIVE", updatedAt: now, updatedById: user.id });
  await store.revokeUserSessions(user.id, "password_change", now);
  const fresh = (await store.getUserById(user.id))!;
  const session = await createSessionFor(fresh, input, c);
  const principal = principalFrom(fresh, session, now);
  await audit(principal, "credential.set", { correlationId, targetType: "user", targetId: user.id, metadata: { purpose: rec.purpose } });
  await audit(principal, "auth.sign_in", { correlationId, metadata: { method: rec.purpose.toLowerCase() + "_token" } });
  return { user: fresh, session };
}

export async function changePassword(principal: Principal, input: { currentPassword: string; newPassword: string }, c: Ctx = {}): Promise<void> {
  const { store, now, correlationId } = deps(c);
  const user = await store.getUserById(principal.userId);
  if (!user) throw new IdentityError("not_found", "User not found.", 404);
  if (!(await verifyPassword(input.currentPassword, user.passwordHash))) {
    await audit(principal, "auth.sign_in_failed", { correlationId, metadata: { method: "change_password", reason: "bad_current_password" } });
    throw new IdentityError("invalid_credentials", "The current password is incorrect.", 400);
  }
  const policy = validateNewPassword(input.newPassword, user);
  if (policy) throw new IdentityError("password_policy", policy, 400);
  if (await verifyPassword(input.newPassword, user.passwordHash)) throw new IdentityError("password_policy", "The new password must differ from the current one.", 400);
  await store.updateUser(user.id, { passwordHash: await hashPassword(input.newPassword), passwordSetAt: now, mustChangePassword: false, updatedAt: now, updatedById: user.id });
  const revoked = await store.revokeUserSessions(user.id, "password_change", now, principal.sessionId);
  await audit(principal, "credential.change", { correlationId, targetType: "user", targetId: user.id, metadata: { otherSessionsRevoked: revoked } });
}

// ── Administration ───────────────────────────────────────────────────────────

export interface CreateUserInput {
  username: string;
  email: string;
  displayName: string;
  roles: Role[];
  permissions?: { key: Permission; expiresAt?: string | null }[];
}

const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{1,63}$/;

function normalizeGrants(perms: CreateUserInput["permissions"]): PermissionGrant[] {
  return (perms ?? [])
    .filter((p) => (PERMISSIONS as readonly string[]).includes(p.key))
    .map((p) => ({ key: p.key, expiresAt: p.expiresAt ? new Date(p.expiresAt) : null }));
}

export async function createUser(actor: Principal, input: CreateUserInput, c: Ctx = {}): Promise<{ user: PublicUser; token: string }> {
  const { store, now, correlationId } = deps(c);
  const username = input.username.trim().toLowerCase();
  const email = input.email.trim().toLowerCase();
  if (!USERNAME_RE.test(username)) throw new IdentityError("password_policy", "Username must be 2–64 characters: letters, digits, dot, underscore or hyphen.", 400);
  if (!input.roles.length || input.roles.some((r) => !(ROLES as readonly string[]).includes(r))) throw new IdentityError("password_policy", "Choose at least one valid role.", 400);
  if (await store.getUserByUsername(username)) throw new IdentityError("conflict", "That username is already in use.", 409);
  if (await store.getUserByEmail(email)) throw new IdentityError("conflict", "That email address is already in use.", 409);

  const user: UserRecord = {
    id: randomUUID(),
    username,
    email,
    displayName: input.displayName.trim(),
    status: "INVITED",
    passwordHash: null,
    passwordSetAt: null,
    mustChangePassword: true,
    failedSignIns: 0,
    lockedUntil: null,
    externalProvider: null,
    externalId: null,
    createdAt: now,
    createdById: actor.userId,
    updatedAt: now,
    updatedById: actor.userId,
    lastSignInAt: null,
    roles: [...new Set(input.roles)],
    permissions: normalizeGrants(input.permissions),
  };
  await store.createUser(user);
  const token = await issueToken(user, "INVITE", c);
  await audit(actor, "user.create", { correlationId, targetType: "user", targetId: user.id, metadata: { username, roles: user.roles.join(","), grants: user.permissions.map((p) => p.key).join(",") } });
  await audit(actor, "credential.token_issued", { correlationId, targetType: "user", targetId: user.id, metadata: { purpose: "INVITE", hours: getConfig().CREDENTIAL_TOKEN_HOURS } });
  return { user: toPublicUser(user, now), token };
}

export interface UpdateUserInput {
  email?: string;
  displayName?: string;
  roles?: Role[];
  permissions?: { key: Permission; expiresAt?: string | null }[];
  status?: Exclude<UserStatus, "INVITED">;
}

/** Field-level update with the last-administrator and self-lockout guards. Disabling revokes every session. */
export async function updateUser(actor: Principal, id: string, input: UpdateUserInput, c: Ctx = {}): Promise<PublicUser> {
  const { store, now, correlationId } = deps(c);
  const user = await store.getUserById(id);
  if (!user) throw new IdentityError("not_found", "User not found.", 404);
  const isSelf = actor.userId === user.id;
  const changes: Record<string, string> = {};
  const patch: Parameters<IdentityStore["updateUser"]>[1] = { updatedAt: now, updatedById: actor.userId };

  if (input.email !== undefined && input.email.trim().toLowerCase() !== user.email) {
    const email = input.email.trim().toLowerCase();
    const other = await store.getUserByEmail(email);
    if (other && other.id !== user.id) throw new IdentityError("conflict", "That email address is already in use.", 409);
    patch.email = email;
    changes.email = `${user.email} → ${email}`;
  }
  if (input.displayName !== undefined && input.displayName.trim() !== user.displayName) {
    patch.displayName = input.displayName.trim();
    changes.displayName = `${user.displayName} → ${patch.displayName}`;
  }
  if (input.roles !== undefined) {
    const roles = [...new Set(input.roles)];
    if (!roles.length || roles.some((r) => !(ROLES as readonly string[]).includes(r))) throw new IdentityError("password_policy", "Choose at least one valid role.", 400);
    if (isSelf && user.roles.includes("ADMINISTRATOR") && !roles.includes("ADMINISTRATOR")) throw new IdentityError("self_action", "You cannot remove your own administrator role.", 400);
    if (user.roles.includes("ADMINISTRATOR") && !roles.includes("ADMINISTRATOR") && user.status === "ACTIVE" && (await store.countActiveAdministrators()) <= 1) {
      throw new IdentityError("last_admin", "At least one active administrator must remain.", 400);
    }
    patch.roles = roles;
    changes.roles = `${user.roles.join("+") || "—"} → ${roles.join("+")}`;
  }
  if (input.permissions !== undefined) {
    patch.permissions = normalizeGrants(input.permissions);
    changes.grants = `${user.permissions.map((p) => p.key).join("+") || "—"} → ${patch.permissions.map((p) => p.key).join("+") || "—"}`;
  }
  if (input.status !== undefined && input.status !== user.status) {
    if (input.status === "DISABLED") {
      if (isSelf) throw new IdentityError("self_action", "You cannot disable your own account.", 400);
      if (user.roles.includes("ADMINISTRATOR") && user.status === "ACTIVE" && (await store.countActiveAdministrators()) <= 1) {
        throw new IdentityError("last_admin", "At least one active administrator must remain.", 400);
      }
    }
    if (input.status === "ACTIVE" && user.passwordHash === null && user.externalProvider === null) {
      throw new IdentityError("password_policy", "This user has not set a password yet. Issue a reset token instead.", 400);
    }
    patch.status = input.status;
    changes.status = `${user.status} → ${input.status}`;
  }

  if (Object.keys(changes).length === 0) return toPublicUser(user, now);
  await store.updateUser(user.id, patch);
  let revoked = 0;
  if (patch.status === "DISABLED") {
    revoked = await store.revokeUserSessions(user.id, "disabled", now);
    await store.invalidateUserTokens(user.id, now);
  } else if (patch.roles || patch.permissions) {
    // Grants are read from the store on every request, so no revocation is needed for them to apply.
  }
  await audit(actor, "user.update", { correlationId, targetType: "user", targetId: user.id, metadata: { ...changes, sessionsRevoked: revoked } });
  return toPublicUser((await store.getUserById(user.id))!, now);
}

/** New one-time token; forces a password change and signs the user out everywhere. */
export async function resetCredentials(actor: Principal, id: string, c: Ctx = {}): Promise<{ user: PublicUser; token: string }> {
  const { store, now, correlationId } = deps(c);
  const user = await store.getUserById(id);
  if (!user) throw new IdentityError("not_found", "User not found.", 404);
  if (user.status === "DISABLED") throw new IdentityError("disabled", "Enable the account before resetting its credentials.", 400);
  await store.updateUser(user.id, { mustChangePassword: true, failedSignIns: 0, lockedUntil: null, updatedAt: now, updatedById: actor.userId });
  const revoked = await store.revokeUserSessions(user.id, "admin", now);
  const token = await issueToken(user, "RESET", c);
  await audit(actor, "credential.token_issued", { correlationId, targetType: "user", targetId: user.id, metadata: { purpose: "RESET", sessionsRevoked: revoked, hours: getConfig().CREDENTIAL_TOKEN_HOURS } });
  return { user: toPublicUser((await store.getUserById(user.id))!, now), token };
}

export async function unlockUser(actor: Principal, id: string, c: Ctx = {}): Promise<PublicUser> {
  const { store, now, correlationId } = deps(c);
  const user = await store.getUserById(id);
  if (!user) throw new IdentityError("not_found", "User not found.", 404);
  await store.updateUser(user.id, { failedSignIns: 0, lockedUntil: null, updatedAt: now, updatedById: actor.userId });
  await audit(actor, "user.unlock", { correlationId, targetType: "user", targetId: user.id });
  return toPublicUser((await store.getUserById(user.id))!, now);
}

export async function revokeAllSessions(actor: Principal, id: string, c: Ctx = {}): Promise<number> {
  const { store, now, correlationId } = deps(c);
  const n = await store.revokeUserSessions(id, "admin", now);
  await audit(actor, "session.revoke", { correlationId, targetType: "user", targetId: id, metadata: { sessionsRevoked: n } });
  return n;
}

export async function listUsers(filter: UserListFilter, c: Ctx = {}): Promise<{ rows: PublicUser[]; total: number; page: number; pageSize: number }> {
  const { store, now } = deps(c);
  const r = await store.listUsers(filter);
  return { rows: r.rows.map((u) => toPublicUser(u, now)), total: r.total, page: filter.page, pageSize: filter.pageSize };
}

export async function getUserDetail(id: string, c: Ctx = {}): Promise<{ user: PublicUser; sessions: SessionRecord[] } | null> {
  const { store, now } = deps(c);
  const user = await store.getUserById(id);
  if (!user) return null;
  return { user: toPublicUser(user, now), sessions: await store.listActiveSessions(user.id, now) };
}

/** One-time first administrator (scripts/bootstrap-admin.ts). Refuses when any administrator exists. */
export async function bootstrapAdministrator(input: { username: string; email: string; displayName: string }, c: Ctx = {}): Promise<{ user: PublicUser; token: string }> {
  const { store } = deps(c);
  const existing = await store.listUsers({ role: "ADMINISTRATOR", page: 1, pageSize: 1 });
  if (existing.total > 0) throw new IdentityError("conflict", "An administrator already exists; use Administration → Users to add more.", 409);
  const system: Principal = { userId: "00000000-0000-0000-0000-000000000000", displayName: "bootstrap", email: "", roles: [], extraPermissions: [] };
  return createUser({ ...system }, { ...input, roles: ["ADMINISTRATOR"] }, c);
}
