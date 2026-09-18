import { getConfig } from "../db/config";
import { DEV_USERS } from "../auth/dev-users";
import { MemoryIdentityStore } from "./memory";
import { MssqlIdentityStore } from "./mssql";
import type { IdentityStore, UserRecord } from "./types";

const g = globalThis as unknown as { __jadiIdentityStore?: IdentityStore | null; __jadiIdentitySeeded?: Promise<void> };

/** APP_STORE=memory → JSON file (IDENTITY_STORE_FILE); APP_STORE=mssql → ousadb schema [dash] via jadi_dash. */
export function getIdentityStore(): IdentityStore {
  if (g.__jadiIdentityStore) return g.__jadiIdentityStore;
  const cfg = getConfig();
  g.__jadiIdentityStore = cfg.APP_STORE === "mssql" ? new MssqlIdentityStore() : new MemoryIdentityStore(cfg.IDENTITY_STORE_FILE || undefined);
  return g.__jadiIdentityStore;
}

export function setIdentityStoreForTests(store: IdentityStore | null): void {
  g.__jadiIdentityStore = store;
  g.__jadiIdentitySeeded = undefined;
}

/**
 * With AUTH_DEV_LOGIN=true (mock mode, tests) the synthetic accounts exist as real user rows in the memory
 * store so sessions, grants and the admin UI behave exactly as they will with database-backed users.
 * They have no password; only the dev-login route can start a session for them.
 */
export function ensureDevUsersSeeded(store: IdentityStore = getIdentityStore()): Promise<void> {
  if (!getConfig().AUTH_DEV_LOGIN) return Promise.resolve();
  g.__jadiIdentitySeeded ??= (async () => {
    const now = new Date();
    for (const d of DEV_USERS) {
      if (await store.getUserByUsername(d.username)) continue;
      const user: UserRecord = {
        id: d.userId,
        username: d.username,
        email: d.email,
        displayName: d.displayName,
        status: "ACTIVE",
        passwordHash: null,
        passwordSetAt: null,
        mustChangePassword: false,
        failedSignIns: 0,
        lockedUntil: null,
        externalProvider: "dev",
        externalId: d.username,
        createdAt: now,
        createdById: null,
        updatedAt: now,
        updatedById: null,
        lastSignInAt: null,
        roles: d.roles,
        permissions: d.extraPermissions.map((key) => ({ key, expiresAt: null })),
      };
      await store.createUser(user).catch(() => undefined);
    }
  })();
  return g.__jadiIdentitySeeded;
}
