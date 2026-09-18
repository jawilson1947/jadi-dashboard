import type { Permission, Role } from "../authz/permissions";

/**
 * IdentityStore — dashboard users, grants, server-side sessions and one-time credential tokens
 * (USER-MANAGEMENT-PLAN Sec.3). Two implementations:
 *   memory/  JSON file (development, tests, mock mode; seeded with the synthetic dev accounts)
 *   mssql/   ousadb schema [dash] via login jadi_dash (db/migrations/002_identity.sql)
 * No record ever carries a password, temporary password or token in clear — only hashes.
 */
export type UserStatus = "ACTIVE" | "DISABLED" | "INVITED";

export interface PermissionGrant {
  key: Permission;
  expiresAt: Date | null;
}

export interface UserRecord {
  id: string;
  username: string; // stored lower-case; compared case-insensitively
  email: string;
  displayName: string;
  status: UserStatus;
  /** PHC-format hash (see credentials.ts); null until the user sets a password. */
  passwordHash: string | null;
  passwordSetAt: Date | null;
  mustChangePassword: boolean;
  failedSignIns: number;
  lockedUntil: Date | null;
  externalProvider: string | null;
  externalId: string | null;
  createdAt: Date;
  createdById: string | null;
  updatedAt: Date;
  updatedById: string | null;
  lastSignInAt: Date | null;
  roles: Role[];
  permissions: PermissionGrant[];
}

export type UserPatch = Partial<Pick<UserRecord, "email" | "displayName" | "status" | "passwordHash" | "passwordSetAt" | "mustChangePassword" | "failedSignIns" | "lockedUntil" | "lastSignInAt" | "updatedById" | "externalProvider" | "externalId">> & {
  roles?: Role[];
  permissions?: PermissionGrant[];
  updatedAt: Date;
};

export interface SessionRecord {
  id: string;
  userId: string;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date; // absolute
  ip: string | null;
  userAgent: string | null;
  revokedAt: Date | null;
  revokedReason: string | null;
}

export type TokenPurpose = "INVITE" | "RESET";

export interface CredentialTokenRecord {
  id: string;
  userId: string;
  tokenHash: string;
  purpose: TokenPurpose;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
}

export interface UserListFilter {
  q?: string;
  status?: UserStatus;
  role?: Role;
  page: number;
  pageSize: number;
}

export interface IdentityStore {
  getUserById(id: string): Promise<UserRecord | null>;
  getUserByUsername(username: string): Promise<UserRecord | null>;
  getUserByEmail(email: string): Promise<UserRecord | null>;
  listUsers(filter: UserListFilter): Promise<{ rows: UserRecord[]; total: number }>;
  createUser(user: UserRecord): Promise<void>;
  updateUser(id: string, patch: UserPatch): Promise<void>;
  /** ACTIVE users holding the ADMINISTRATOR role (last-administrator guard). */
  countActiveAdministrators(): Promise<number>;

  createSession(session: SessionRecord): Promise<void>;
  getSession(id: string): Promise<SessionRecord | null>;
  touchSession(id: string, lastSeenAt: Date): Promise<void>;
  revokeSession(id: string, reason: string, at: Date): Promise<void>;
  revokeUserSessions(userId: string, reason: string, at: Date, exceptSessionId?: string): Promise<number>;
  listActiveSessions(userId: string, now: Date): Promise<SessionRecord[]>;

  createToken(token: CredentialTokenRecord): Promise<void>;
  findTokenByHash(tokenHash: string): Promise<CredentialTokenRecord | null>;
  markTokenUsed(id: string, usedAt: Date): Promise<void>;
  /** Invalidate all outstanding tokens for a user (a new invite/reset supersedes older ones). */
  invalidateUserTokens(userId: string, at: Date): Promise<void>;
}

/** Thrown by the identity service for expected business-rule failures; mapped to 4xx by the API layer. */
export class IdentityError extends Error {
  constructor(
    public readonly code: "invalid_credentials" | "locked" | "disabled" | "password_policy" | "token_invalid" | "conflict" | "last_admin" | "self_action" | "not_found" | "rate_limited",
    message: string,
    public readonly status = 400,
  ) {
    super(message);
    this.name = "IdentityError";
  }
}
