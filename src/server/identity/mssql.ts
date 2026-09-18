import { getDashPool, sql } from "../db/mssql";
import type { Permission, Role } from "../authz/permissions";
import type { CredentialTokenRecord, IdentityStore, SessionRecord, UserListFilter, UserPatch, UserRecord } from "./types";

/**
 * SQL Server IdentityStore over ousadb schema [dash] (db/migrations/002_identity.sql).
 * Every statement is parameterized; nothing here touches dbo.*.
 */
const USER_COLS = "id, username, email, displayName, status, passwordHash, passwordSetAt, mustChangePassword, failedSignIns, lockedUntil, externalProvider, externalId, createdAt, createdById, updatedAt, updatedById, lastSignInAt";

type UserRow = Omit<UserRecord, "roles" | "permissions" | "mustChangePassword"> & { mustChangePassword: boolean | number };

export class MssqlIdentityStore implements IdentityStore {
  private pool() {
    return getDashPool();
  }

  private async hydrate(rows: UserRow[]): Promise<UserRecord[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const req = (await this.pool()).request();
    ids.forEach((id, i) => req.input(`id${i}`, sql.UniqueIdentifier, id));
    const list = ids.map((_, i) => `@id${i}`).join(",");
    const r = await req.query<{ kind: "role" | "perm"; userId: string; key: string; expiresAt: Date | null }>(
      `SELECT 'role' AS kind, userId, roleKey AS [key], NULL AS expiresAt FROM dash.UserRole WHERE userId IN (${list})
       UNION ALL
       SELECT 'perm', userId, permissionKey, expiresAt FROM dash.UserPermission WHERE userId IN (${list})`,
    );
    const roles = new Map<string, Role[]>();
    const perms = new Map<string, { key: Permission; expiresAt: Date | null }[]>();
    for (const g of r.recordset) {
      const id = g.userId.toLowerCase();
      if (g.kind === "role") roles.set(id, [...(roles.get(id) ?? []), g.key as Role]);
      else perms.set(id, [...(perms.get(id) ?? []), { key: g.key as Permission, expiresAt: g.expiresAt ? new Date(g.expiresAt) : null }]);
    }
    return rows.map((row) => ({
      ...row,
      id: row.id.toLowerCase(),
      mustChangePassword: Boolean(row.mustChangePassword),
      passwordSetAt: row.passwordSetAt ? new Date(row.passwordSetAt) : null,
      lockedUntil: row.lockedUntil ? new Date(row.lockedUntil) : null,
      createdAt: new Date(row.createdAt),
      updatedAt: new Date(row.updatedAt),
      lastSignInAt: row.lastSignInAt ? new Date(row.lastSignInAt) : null,
      createdById: row.createdById?.toLowerCase() ?? null,
      updatedById: row.updatedById?.toLowerCase() ?? null,
      roles: roles.get(row.id.toLowerCase()) ?? [],
      permissions: perms.get(row.id.toLowerCase()) ?? [],
    }));
  }

  private async one(where: string, bind: (r: sql.Request) => sql.Request): Promise<UserRecord | null> {
    const r = await bind((await this.pool()).request()).query<UserRow>(`SELECT ${USER_COLS} FROM dash.[User] WHERE ${where}`);
    return (await this.hydrate(r.recordset))[0] ?? null;
  }
  getUserById(id: string) {
    return this.one("id = @id", (r) => r.input("id", sql.UniqueIdentifier, id));
  }
  getUserByUsername(username: string) {
    return this.one("username = @u", (r) => r.input("u", sql.NVarChar(64), username.trim().toLowerCase()));
  }
  getUserByEmail(email: string) {
    return this.one("email = @e", (r) => r.input("e", sql.NVarChar(320), email.trim().toLowerCase()));
  }

  async listUsers(f: UserListFilter) {
    const req = (await this.pool()).request().input("offset", sql.Int, (f.page - 1) * f.pageSize).input("pageSize", sql.Int, f.pageSize);
    const where: string[] = [];
    if (f.status) {
      where.push("u.status = @status");
      req.input("status", sql.VarChar(20), f.status);
    }
    if (f.role) {
      where.push("EXISTS (SELECT 1 FROM dash.UserRole ur WHERE ur.userId = u.id AND ur.roleKey = @role)");
      req.input("role", sql.VarChar(50), f.role);
    }
    if (f.q?.trim()) {
      where.push("(u.username LIKE @q OR u.email LIKE @q OR u.displayName LIKE @q)");
      req.input("q", sql.NVarChar(200), `%${f.q.trim().replace(/[%_[]/g, "[$&]")}%`);
    }
    const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const r = await req.query<UserRow & { total: number }>(
      `SELECT ${USER_COLS.split(", ").map((c) => `u.${c}`).join(", ")}, COUNT(*) OVER () AS total FROM dash.[User] u ${w} ORDER BY u.username OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY`,
    );
    return { rows: await this.hydrate(r.recordset), total: r.recordset[0]?.total ?? 0 };
  }

  async createUser(u: UserRecord) {
    const pool = await this.pool();
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      await new sql.Request(tx)
        .input("id", sql.UniqueIdentifier, u.id)
        .input("username", sql.NVarChar(64), u.username)
        .input("email", sql.NVarChar(320), u.email)
        .input("displayName", sql.NVarChar(200), u.displayName)
        .input("status", sql.VarChar(20), u.status)
        .input("hash", sql.VarChar(255), u.passwordHash)
        .input("setAt", sql.DateTime2, u.passwordSetAt)
        .input("must", sql.Bit, u.mustChangePassword)
        .input("createdAt", sql.DateTime2, u.createdAt)
        .input("createdBy", sql.UniqueIdentifier, u.createdById)
        .input("ext", sql.VarChar(50), u.externalProvider)
        .input("extId", sql.NVarChar(200), u.externalId)
        .query(
          `INSERT INTO dash.[User] (id, username, email, displayName, status, passwordHash, passwordSetAt, mustChangePassword, failedSignIns, lockedUntil, externalProvider, externalId, createdAt, createdById, updatedAt, updatedById)
           VALUES (@id, @username, @email, @displayName, @status, @hash, @setAt, @must, 0, NULL, @ext, @extId, @createdAt, @createdBy, @createdAt, @createdBy)`,
        );
      await this.writeGrants(tx, u.id, u.roles, u.permissions, u.createdById);
      await tx.commit();
    } catch (e) {
      await tx.rollback();
      throw e;
    }
  }

  private async writeGrants(tx: sql.Transaction, userId: string, roles: Role[] | undefined, perms: UserRecord["permissions"] | undefined, by: string | null) {
    if (roles) {
      await new sql.Request(tx).input("id", sql.UniqueIdentifier, userId).query("DELETE FROM dash.UserRole WHERE userId = @id");
      for (const role of roles) {
        await new sql.Request(tx).input("id", sql.UniqueIdentifier, userId).input("role", sql.VarChar(50), role).input("by", sql.UniqueIdentifier, by)
          .query("INSERT INTO dash.UserRole (userId, roleKey, grantedById) VALUES (@id, @role, @by)");
      }
    }
    if (perms) {
      await new sql.Request(tx).input("id", sql.UniqueIdentifier, userId).query("DELETE FROM dash.UserPermission WHERE userId = @id");
      for (const p of perms) {
        await new sql.Request(tx).input("id", sql.UniqueIdentifier, userId).input("perm", sql.VarChar(100), p.key).input("exp", sql.DateTime2, p.expiresAt).input("by", sql.UniqueIdentifier, by)
          .query("INSERT INTO dash.UserPermission (userId, permissionKey, expiresAt, grantedById) VALUES (@id, @perm, @exp, @by)");
      }
    }
  }

  async updateUser(id: string, patch: UserPatch) {
    const pool = await this.pool();
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      const sets: string[] = ["updatedAt = @updatedAt"];
      const req = new sql.Request(tx).input("id", sql.UniqueIdentifier, id).input("updatedAt", sql.DateTime2, patch.updatedAt);
      const col = <K extends keyof UserPatch>(k: K, type: sql.ISqlType | (() => sql.ISqlType), name = k as string) => {
        if (k in patch && k !== "roles" && k !== "permissions" && k !== "updatedAt") {
          sets.push(`${name} = @${k}`);
          req.input(k, type, patch[k] as never);
        }
      };
      col("email", sql.NVarChar(320));
      col("displayName", sql.NVarChar(200));
      col("status", sql.VarChar(20));
      col("passwordHash", sql.VarChar(255));
      col("passwordSetAt", sql.DateTime2);
      col("mustChangePassword", sql.Bit);
      col("failedSignIns", sql.Int);
      col("lockedUntil", sql.DateTime2);
      col("lastSignInAt", sql.DateTime2);
      col("updatedById", sql.UniqueIdentifier);
      col("externalProvider", sql.VarChar(50));
      col("externalId", sql.NVarChar(200));
      await req.query(`UPDATE dash.[User] SET ${sets.join(", ")} WHERE id = @id`);
      await this.writeGrants(tx, id, patch.roles, patch.permissions, patch.updatedById ?? null);
      await tx.commit();
    } catch (e) {
      await tx.rollback();
      throw e;
    }
  }

  async countActiveAdministrators() {
    const r = await (await this.pool()).request().query<{ n: number }>("SELECT COUNT(*) AS n FROM dash.[User] u WHERE u.status = 'ACTIVE' AND EXISTS (SELECT 1 FROM dash.UserRole ur WHERE ur.userId = u.id AND ur.roleKey = 'ADMINISTRATOR')");
    return r.recordset[0]?.n ?? 0;
  }

  async createSession(s: SessionRecord) {
    await (await this.pool()).request()
      .input("id", sql.UniqueIdentifier, s.id).input("userId", sql.UniqueIdentifier, s.userId).input("createdAt", sql.DateTime2, s.createdAt)
      .input("lastSeenAt", sql.DateTime2, s.lastSeenAt).input("expiresAt", sql.DateTime2, s.expiresAt).input("ip", sql.VarChar(64), s.ip).input("ua", sql.NVarChar(400), s.userAgent)
      .query("INSERT INTO dash.Session (id, userId, createdAt, lastSeenAt, expiresAt, ip, userAgent) VALUES (@id, @userId, @createdAt, @lastSeenAt, @expiresAt, @ip, @ua)");
  }
  async getSession(id: string) {
    const r = await (await this.pool()).request().input("id", sql.UniqueIdentifier, id).query<SessionRecord>("SELECT id, userId, createdAt, lastSeenAt, expiresAt, ip, userAgent, revokedAt, revokedReason FROM dash.Session WHERE id = @id");
    return r.recordset[0] ? mapSession(r.recordset[0]) : null;
  }
  async touchSession(id: string, lastSeenAt: Date) {
    await (await this.pool()).request().input("id", sql.UniqueIdentifier, id).input("t", sql.DateTime2, lastSeenAt).query("UPDATE dash.Session SET lastSeenAt = @t WHERE id = @id");
  }
  async revokeSession(id: string, reason: string, at: Date) {
    await (await this.pool()).request().input("id", sql.UniqueIdentifier, id).input("reason", sql.VarChar(50), reason).input("at", sql.DateTime2, at)
      .query("UPDATE dash.Session SET revokedAt = @at, revokedReason = @reason WHERE id = @id AND revokedAt IS NULL");
  }
  async revokeUserSessions(userId: string, reason: string, at: Date, exceptSessionId?: string) {
    const req = (await this.pool()).request().input("userId", sql.UniqueIdentifier, userId).input("reason", sql.VarChar(50), reason).input("at", sql.DateTime2, at);
    let extra = "";
    if (exceptSessionId) {
      req.input("except", sql.UniqueIdentifier, exceptSessionId);
      extra = " AND id <> @except";
    }
    const r = await req.query(`UPDATE dash.Session SET revokedAt = @at, revokedReason = @reason WHERE userId = @userId AND revokedAt IS NULL AND expiresAt > @at${extra}`);
    return r.rowsAffected[0] ?? 0;
  }
  async listActiveSessions(userId: string, now: Date) {
    const r = await (await this.pool()).request().input("userId", sql.UniqueIdentifier, userId).input("now", sql.DateTime2, now)
      .query<SessionRecord>("SELECT id, userId, createdAt, lastSeenAt, expiresAt, ip, userAgent, revokedAt, revokedReason FROM dash.Session WHERE userId = @userId AND revokedAt IS NULL AND expiresAt > @now ORDER BY lastSeenAt DESC");
    return r.recordset.map(mapSession);
  }

  async createToken(t: CredentialTokenRecord) {
    await (await this.pool()).request()
      .input("id", sql.UniqueIdentifier, t.id).input("userId", sql.UniqueIdentifier, t.userId).input("hash", sql.VarChar(128), t.tokenHash)
      .input("purpose", sql.VarChar(20), t.purpose).input("expiresAt", sql.DateTime2, t.expiresAt).input("createdAt", sql.DateTime2, t.createdAt)
      .query("INSERT INTO dash.CredentialToken (id, userId, tokenHash, purpose, expiresAt, createdAt) VALUES (@id, @userId, @hash, @purpose, @expiresAt, @createdAt)");
  }
  async findTokenByHash(tokenHash: string) {
    const r = await (await this.pool()).request().input("hash", sql.VarChar(128), tokenHash).query<CredentialTokenRecord>("SELECT id, userId, tokenHash, purpose, expiresAt, usedAt, createdAt FROM dash.CredentialToken WHERE tokenHash = @hash");
    const t = r.recordset[0];
    return t ? { ...t, id: t.id.toLowerCase(), userId: t.userId.toLowerCase(), expiresAt: new Date(t.expiresAt), usedAt: t.usedAt ? new Date(t.usedAt) : null, createdAt: new Date(t.createdAt) } : null;
  }
  async markTokenUsed(id: string, usedAt: Date) {
    await (await this.pool()).request().input("id", sql.UniqueIdentifier, id).input("at", sql.DateTime2, usedAt).query("UPDATE dash.CredentialToken SET usedAt = @at WHERE id = @id AND usedAt IS NULL");
  }
  async invalidateUserTokens(userId: string, at: Date) {
    await (await this.pool()).request().input("userId", sql.UniqueIdentifier, userId).input("at", sql.DateTime2, at).query("UPDATE dash.CredentialToken SET usedAt = @at WHERE userId = @userId AND usedAt IS NULL");
  }
}

function mapSession(s: SessionRecord): SessionRecord {
  return { ...s, id: s.id.toLowerCase(), userId: s.userId.toLowerCase(), createdAt: new Date(s.createdAt), lastSeenAt: new Date(s.lastSeenAt), expiresAt: new Date(s.expiresAt), revokedAt: s.revokedAt ? new Date(s.revokedAt) : null };
}
