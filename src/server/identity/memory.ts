import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { CredentialTokenRecord, IdentityStore, SessionRecord, UserListFilter, UserPatch, UserRecord } from "./types";

interface State {
  users: UserRecord[];
  sessions: SessionRecord[];
  tokens: CredentialTokenRecord[];
}

/**
 * In-memory IdentityStore with optional JSON persistence (IDENTITY_STORE_FILE). Same file-as-source-of-truth
 * pattern as MemoryAppStore so the web process and worker see the same users. Not for production.
 */
export class MemoryIdentityStore implements IdentityStore {
  private state: State = { users: [], sessions: [], tokens: [] };
  private lastLoadedMtime = -1;

  constructor(private readonly file?: string) {
    this.load();
  }

  private load() {
    if (!this.file || !existsSync(this.file)) return;
    try {
      const mtime = statSync(this.file).mtimeMs;
      if (mtime === this.lastLoadedMtime) return;
      this.state = revive(JSON.parse(readFileSync(this.file, "utf8")));
      this.lastLoadedMtime = mtime;
    } catch {
      /* partially written file: retried on the next call */
    }
  }

  private persist() {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.state));
    renameSync(tmp, this.file);
    this.lastLoadedMtime = statSync(this.file).mtimeMs;
  }

  async getUserById(id: string) {
    this.load();
    return clone(this.state.users.find((u) => u.id === id) ?? null);
  }
  async getUserByUsername(username: string) {
    this.load();
    const k = username.trim().toLowerCase();
    return clone(this.state.users.find((u) => u.username.toLowerCase() === k) ?? null);
  }
  async getUserByEmail(email: string) {
    this.load();
    const k = email.trim().toLowerCase();
    return clone(this.state.users.find((u) => u.email.toLowerCase() === k) ?? null);
  }
  async listUsers(f: UserListFilter) {
    this.load();
    const q = f.q?.trim().toLowerCase();
    const rows = this.state.users
      .filter((u) => !f.status || u.status === f.status)
      .filter((u) => !f.role || u.roles.includes(f.role))
      .filter((u) => !q || [u.username, u.email, u.displayName].some((s) => s.toLowerCase().includes(q)))
      .sort((a, b) => a.username.localeCompare(b.username));
    const start = (f.page - 1) * f.pageSize;
    return { rows: rows.slice(start, start + f.pageSize).map((u) => clone(u)!), total: rows.length };
  }
  async createUser(user: UserRecord) {
    this.load();
    if (this.state.users.some((u) => u.username.toLowerCase() === user.username.toLowerCase() || u.email.toLowerCase() === user.email.toLowerCase())) {
      throw new Error("duplicate username or email");
    }
    this.state.users.push(clone(user)!);
    this.persist();
  }
  async updateUser(id: string, patch: UserPatch) {
    this.load();
    const u = this.state.users.find((x) => x.id === id);
    if (!u) return;
    Object.assign(u, patch);
    this.persist();
  }
  async countActiveAdministrators() {
    this.load();
    return this.state.users.filter((u) => u.status === "ACTIVE" && u.roles.includes("ADMINISTRATOR")).length;
  }

  async createSession(s: SessionRecord) {
    this.load();
    this.state.sessions.push({ ...s });
    if (this.state.sessions.length > 5000) this.state.sessions.splice(0, this.state.sessions.length - 5000);
    this.persist();
  }
  async getSession(id: string) {
    this.load();
    const s = this.state.sessions.find((x) => x.id === id);
    return s ? { ...s } : null;
  }
  async touchSession(id: string, lastSeenAt: Date) {
    this.load();
    const s = this.state.sessions.find((x) => x.id === id);
    if (s) {
      s.lastSeenAt = lastSeenAt;
      this.persist();
    }
  }
  async revokeSession(id: string, reason: string, at: Date) {
    this.load();
    const s = this.state.sessions.find((x) => x.id === id);
    if (s && !s.revokedAt) {
      s.revokedAt = at;
      s.revokedReason = reason;
      this.persist();
    }
  }
  async revokeUserSessions(userId: string, reason: string, at: Date, exceptSessionId?: string) {
    this.load();
    let n = 0;
    for (const s of this.state.sessions) {
      if (s.userId === userId && !s.revokedAt && s.id !== exceptSessionId && s.expiresAt.getTime() > at.getTime()) {
        s.revokedAt = at;
        s.revokedReason = reason;
        n++;
      }
    }
    if (n) this.persist();
    return n;
  }
  async listActiveSessions(userId: string, now: Date) {
    this.load();
    return this.state.sessions.filter((s) => s.userId === userId && !s.revokedAt && s.expiresAt.getTime() > now.getTime()).map((s) => ({ ...s }));
  }

  async createToken(t: CredentialTokenRecord) {
    this.load();
    this.state.tokens.push({ ...t });
    this.persist();
  }
  async findTokenByHash(tokenHash: string) {
    this.load();
    const t = this.state.tokens.find((x) => x.tokenHash === tokenHash);
    return t ? { ...t } : null;
  }
  async markTokenUsed(id: string, usedAt: Date) {
    this.load();
    const t = this.state.tokens.find((x) => x.id === id);
    if (t) {
      t.usedAt = usedAt;
      this.persist();
    }
  }
  async invalidateUserTokens(userId: string, at: Date) {
    this.load();
    for (const t of this.state.tokens) if (t.userId === userId && !t.usedAt) t.usedAt = at;
    this.persist();
  }
}

function clone(u: UserRecord | null): UserRecord | null {
  return u ? { ...u, roles: [...u.roles], permissions: u.permissions.map((p) => ({ ...p })) } : null;
}

function revive(raw: State): State {
  const d = (v: unknown) => (typeof v === "string" ? new Date(v) : (v as Date | null));
  return {
    users: (raw.users ?? []).map((u) => ({
      ...u,
      passwordSetAt: d(u.passwordSetAt),
      lockedUntil: d(u.lockedUntil),
      createdAt: d(u.createdAt)!,
      updatedAt: d(u.updatedAt)!,
      lastSignInAt: d(u.lastSignInAt),
      permissions: (u.permissions ?? []).map((p) => ({ ...p, expiresAt: d(p.expiresAt) })),
    })),
    sessions: (raw.sessions ?? []).map((s) => ({ ...s, createdAt: d(s.createdAt)!, lastSeenAt: d(s.lastSeenAt)!, expiresAt: d(s.expiresAt)!, revokedAt: d(s.revokedAt) })),
    tokens: (raw.tokens ?? []).map((t) => ({ ...t, expiresAt: d(t.expiresAt)!, usedAt: d(t.usedAt), createdAt: d(t.createdAt)! })),
  };
}
