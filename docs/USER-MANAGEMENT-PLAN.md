# User Management Plan — dashboard users, roles and sign-in

Status: **U1–U3 implemented 2026-09-18** (schema, grants, identity store, password sign-in, sessions, Administration → Users); U4 (SQL audit sink + audit page) and U5 (remove dev-login from non-test builds, operations docs) outstanding · Spec §3, §14.1, §18, §21.1, §21.10, §21.12

> **Implementation notes (2026-09-18)** — deviations from the draft below, all deliberate:
> - **Hashing is scrypt, not Argon2id.** `argon2` is a native module that needs a prebuilt binary download or a C++ toolchain on the Windows hosts this app is deployed to (the same class of problem that made us drop Prisma). Node's built-in `crypto.scrypt` with N=2¹⁷, r=8, p=1 (~128 MiB, ~100 ms) is on OWASP's accepted list; parameters live in the PHC string (`$scrypt$ln=17,r=8,p=1$salt$hash`) and `needsRehash()` upgrades old hashes transparently at the next sign-in, so switching to Argon2id later is a one-function change.
> - **Breached-password list** ships as a compact built-in set (~1,100 entries: published most-common passwords, keyboard walks, year/suffix variants, and deployment-specific words such as `jadi`, `billing`, semester names) rather than a 100k list; `src/server/identity/common-passwords.ts` is the drop-in point for a fuller list.
> - **Role → permission sets stay in code** (`ROLE_PERMISSIONS`) and are *seeded* into `dash.Role/Permission/RolePermission` by migration 002. Per-user roles and grants are read from the store on every request. Admin editing of role defaults is deferred.
> - `status` values are `ACTIVE | DISABLED | INVITED`; the draft's `LOCKED` is expressed by `lockedUntil` only, so a temporary lockout never overwrites an administrative status.
> - CSRF: instead of a custom header, `handle()` rejects state-changing requests whose `Sec-Fetch-Site` is cross-site or whose `Origin` host differs from the request host, on top of `SameSite=Lax` cookies.
> - Sign-in rate limiting is an in-process token bucket per IP and per IP+username (`rate-limit.ts`); a reverse-proxy limit should be added for multi-instance deployments.
>
> **Staging state:** `scripts/setup-dash-login.ps1` created login `jadi_dash` + schema `dash` on SJ-VMS (password generated, never displayed, stored as user env `JADI_DASH_CONNECTION_STRING`); `fn_my_permissions` shows SELECT-only on `dbo`, and a test `UPDATE dbo.tblOUSA` was denied by the server. Migrations 001 and 002 applied; `tests/staging/dash-grants.test.ts` passes; administrator `jwilson` bootstrapped with a one-time link written to `C:\jadiDashboard\.bootstrap-admin-link.txt` (delete after use).
>
> **How to run with database-backed users:** `APP_STORE=mssql DASH_CONNECTION_STRING=<jadi_dash string>` (plus `DATA_PROVIDER=mssql OUSADB_CONNECTION_STRING=…` for real data). First administrator: `npm run bootstrap:admin` with `BOOTSTRAP_ADMIN_USERNAME/EMAIL/NAME`. Everyone else: Administration → Users → New user → hand over the one-time link.
Decisions recorded: ASSUMPTIONS A-12 (credentials), A-21 (application tables in `ousadb` schema `dash`)

## 1. Decisions this plan is built on

Two choices were made on 2026-09-18 and change the Phase 2 storage design:

1. **Application-owned tables live in `ousadb`, in their own schema `dash`.** The planned `jadi_app` database is dropped. Jobs, runs, snapshots, settings and audit move to `dash.*` alongside the new user tables. One database to back up, one server, and the legacy JADI tooling and the dashboard share a home.
2. **Dashboard users sign in with a local username and password; institutional SSO is added later.** Passwords are stored only as Argon2id hashes. The user table carries an optional external identity so SSO can be layered on without a migration.

The read-only posture toward source data is preserved by *login separation*, not by database separation:

| Login | Rights | Used by |
|---|---|---|
| `jadi_readonly` (existing plan) | `SELECT` on `ousadb.dbo` views/tables the provider uses, `SELECT` on `[jadi].dbo` | `DataProvider` (source reads) |
| `jadi_dash` (new) | `db_datareader` on `ousadb`; `ALTER`, `INSERT`, `UPDATE`, `DELETE`, `SELECT`, `EXECUTE` on **schema `dash` only**; `DENY INSERT, UPDATE, DELETE ON SCHEMA::dbo` | `AppStore`, user/identity services |

The app holds both connection strings; the DENY on `dbo` makes "the dashboard cannot modify Jenzabar/OUSA data" provable from the grants, not from code review. Tests in `tests/unit/mssql-sql.test.ts` keep asserting that no source SQL writes.

## 2. Roles and permissions (unchanged from Spec §3, already in code)

`ADMINISTRATOR`, `OPERATOR`, `VIEWER` map to fixed permission sets in `src/server/authz/permissions.ts`; administrators may add per-user grants (the Spec §3.3 "Viewer with `student.view`" case). This plan moves those definitions from code constants to `dash.Role` / `dash.Permission` / `dash.RolePermission` rows seeded from the constants, so an administrator can later adjust a role's default permissions without a deploy while the code keeps the permission *keys* as the type-checked source of truth.

## 3. Schema (`db/migrations/002_dash_schema.sql`)

```sql
CREATE SCHEMA dash AUTHORIZATION dbo;

-- Identity ------------------------------------------------------------------
CREATE TABLE dash.[User] (
  id               uniqueidentifier NOT NULL PRIMARY KEY DEFAULT NEWSEQUENTIALID(),
  username         nvarchar(64)     NOT NULL,            -- case-insensitive unique, e.g. jwilson
  email            nvarchar(320)    NOT NULL,
  displayName      nvarchar(200)    NOT NULL,
  status           varchar(20)      NOT NULL DEFAULT 'ACTIVE', -- ACTIVE | DISABLED | LOCKED | INVITED
  -- local credentials (nullable so an SSO-only user has none)
  passwordHash     varchar(255)     NULL,                -- Argon2id PHC string; never plaintext
  passwordSetAt    datetime2        NULL,
  mustChangePassword bit            NOT NULL DEFAULT 1,  -- forced on first sign-in / admin reset
  failedSignIns    int              NOT NULL DEFAULT 0,
  lockedUntil      datetime2        NULL,
  -- SSO seam (Phase 9)
  externalProvider varchar(50)      NULL,                -- 'entra' | 'adfs' | ...
  externalId       nvarchar(200)    NULL,                -- OIDC sub / AD objectId
  -- bookkeeping
  createdAt        datetime2        NOT NULL DEFAULT SYSUTCDATETIME(),
  createdById      uniqueidentifier NULL,
  updatedAt        datetime2        NOT NULL DEFAULT SYSUTCDATETIME(),
  updatedById      uniqueidentifier NULL,
  lastSignInAt     datetime2        NULL,
  CONSTRAINT UQ_User_username UNIQUE (username),
  CONSTRAINT UQ_User_email    UNIQUE (email),
  CONSTRAINT UQ_User_external UNIQUE (externalProvider, externalId),
  CONSTRAINT CK_User_status   CHECK (status IN ('ACTIVE','DISABLED','LOCKED','INVITED'))
);

CREATE TABLE dash.Role       ([key] varchar(50) NOT NULL PRIMARY KEY, name nvarchar(100) NOT NULL, description nvarchar(400) NULL, isSystem bit NOT NULL DEFAULT 1);
CREATE TABLE dash.Permission ([key] varchar(100) NOT NULL PRIMARY KEY, description nvarchar(400) NULL);
CREATE TABLE dash.RolePermission (roleKey varchar(50) NOT NULL REFERENCES dash.Role([key]), permissionKey varchar(100) NOT NULL REFERENCES dash.Permission([key]), PRIMARY KEY (roleKey, permissionKey));
CREATE TABLE dash.UserRole (userId uniqueidentifier NOT NULL REFERENCES dash.[User](id) ON DELETE CASCADE, roleKey varchar(50) NOT NULL REFERENCES dash.Role([key]), grantedAt datetime2 NOT NULL DEFAULT SYSUTCDATETIME(), grantedById uniqueidentifier NULL, PRIMARY KEY (userId, roleKey));
CREATE TABLE dash.UserPermission (userId uniqueidentifier NOT NULL REFERENCES dash.[User](id) ON DELETE CASCADE, permissionKey varchar(100) NOT NULL REFERENCES dash.Permission([key]), grantedAt datetime2 NOT NULL DEFAULT SYSUTCDATETIME(), grantedById uniqueidentifier NULL, expiresAt datetime2 NULL, PRIMARY KEY (userId, permissionKey));

-- Sessions (server-side, revocable) ------------------------------------------
CREATE TABLE dash.Session (
  id           uniqueidentifier NOT NULL PRIMARY KEY,   -- random; the cookie carries only this id, HMAC-signed
  userId       uniqueidentifier NOT NULL REFERENCES dash.[User](id) ON DELETE CASCADE,
  createdAt    datetime2 NOT NULL DEFAULT SYSUTCDATETIME(),
  lastSeenAt   datetime2 NOT NULL DEFAULT SYSUTCDATETIME(),
  expiresAt    datetime2 NOT NULL,
  ip           varchar(64) NULL,
  userAgent    nvarchar(400) NULL,
  revokedAt    datetime2 NULL,
  revokedReason varchar(50) NULL                        -- sign_out | admin | password_change | expired
);
CREATE INDEX IX_Session_user ON dash.Session(userId, expiresAt);

-- One-time tokens (invite / admin reset) --------------------------------------
CREATE TABLE dash.CredentialToken (
  id        uniqueidentifier NOT NULL PRIMARY KEY,
  userId    uniqueidentifier NOT NULL REFERENCES dash.[User](id) ON DELETE CASCADE,
  tokenHash varchar(128) NOT NULL,                      -- SHA-256 of the token shown once to the admin
  purpose   varchar(20)  NOT NULL,                      -- INVITE | RESET
  expiresAt datetime2 NOT NULL,
  usedAt    datetime2 NULL
);

-- Existing Phase 2 tables move here unchanged: dash.Job, dash.JobRun, dash.Snapshot, dash.Setting, dash.AuditEvent.
-- dash.AuditEvent.actorUserId becomes a real FK to dash.[User](id) (nullable for failed sign-ins).
```

Notes: `username` uses the database's case-insensitive collation, so `JWilson` and `jwilson` collide by design. No column ever holds a password, a temporary password, or a token in clear; the admin sees a one-time reset token at creation and the database keeps only its hash. `status` is separate from `lockedUntil` so an automatic lockout (temporary) is distinguishable from an administrative disable (permanent until re-enabled).

## 4. Credential policy (configurable in `dash.Setting`, defaults below)

| Rule | Default | Why |
|---|---|---|
| Hashing | Argon2id, memory 64 MiB, iterations 3, parallelism 1 (`argon2` package) | Current OWASP guidance; parameters stored in the PHC string so they can be raised later and rehashed on next sign-in |
| Minimum length | 12 characters; no composition rules; reject the top-100k breached-password list shipped with the app | NIST SP 800-63B |
| Lockout | 5 consecutive failures → locked 15 minutes; counter resets on success; administrators can unlock | Spec §18 rate limiting; failed attempts audited |
| Temporary credentials | Admin creates user → app generates a one-time reset token (URL-safe, 32 bytes) shown once; valid 72 h; first sign-in forces a new password | No admin ever knows a user's password |
| Session | 8-hour idle expiry, 12-hour absolute; sliding `lastSeenAt`; revoked on password change, disable, or admin action; cookie is `HttpOnly; Secure; SameSite=Lax` carrying only the session id | Server-side sessions make "disable user" take effect immediately (Spec §14.1 activation/deactivation) |
| Self-service | Change own password (requires current password); no self-service reset in v1 (no outbound email in the initial release, Spec §11) — administrators issue reset tokens | Keeps the "no email" boundary |
| Sign-in throttling | Per-IP and per-username token bucket at the API edge in addition to lockout | Spec §18 |

## 5. Flows

**Create.** Administrator (permission `user.manage`) fills username, email, display name, role(s), optional extra permissions → `POST /api/v1/admin/users` → row inserted with `status = INVITED`, `mustChangePassword = 1`, no hash → response contains a one-time token (never stored, never logged) → admin hands it to the person → person opens `/sign-in/set-password?token=…`, chooses a password → status becomes `ACTIVE`. Audit: `user.create`, `credential.token_issued`, `credential.set`.

**Sign in.** `POST /api/v1/auth/sign-in` with username + password → look up by username (constant-time compare against a dummy hash when the user does not exist, so timing does not reveal usernames) → check `status`, `lockedUntil` → verify hash → reset `failedSignIns`, create `dash.Session`, set cookie → if `mustChangePassword`, redirect to change-password before anything else. Audit: `auth.sign_in` / `auth.sign_in_failed` (username hashed in metadata, never the password).

**Read / list.** `GET /api/v1/admin/users?status=&role=&q=&page=` → paginated table: username, name, email, roles, extra grants, status, last sign-in, created by. Never returns hashes or tokens.

**Update.** `PATCH /api/v1/admin/users/{id}` for display name, email, roles, extra permissions (with optional expiry), status ACTIVE↔DISABLED. Disabling revokes all sessions. Administrators cannot remove their own `user.manage` or disable themselves (prevents lock-out of the last admin; also a DB check that at least one ACTIVE administrator remains). Audit: `user.update` with before/after of the changed fields only.

**Reset credentials.** `POST /api/v1/admin/users/{id}/reset` → new one-time token, `mustChangePassword = 1`, all sessions revoked. `POST /api/v1/admin/users/{id}/unlock` clears lockout.

**Delete.** Soft delete only: `status = DISABLED` plus `deletedAt`? No — the spec's audit requirements (§18) mean user rows must remain referenceable from `AuditEvent`, so **there is no hard delete**. "Delete" in the UI maps to DISABLED with sessions revoked and roles removed; the row and its audit trail remain. Spec §14.1 asks for "activation/deactivation", which this satisfies.

**Change own password.** `POST /api/v1/auth/change-password` (current + new) → rehash, revoke other sessions, audit `credential.change`.

**SSO later (Phase 9).** An OIDC callback resolves `externalProvider + externalId` (or, on first link, a verified email) to a `dash.User` row and creates a `dash.Session` exactly like a password sign-in. Users may have both a hash and an external identity during transition; an admin switch `auth.localPasswordsEnabled = false` later turns off password sign-in without touching the table.

## 6. API surface (adds to PLAN §5)

| Method & path | Permission | Notes |
|---|---|---|
| `POST /api/v1/auth/sign-in` | — | username + password; rate-limited; sets session cookie |
| `POST /api/v1/auth/sign-out` | session | revokes current session |
| `POST /api/v1/auth/change-password` | session | current + new |
| `POST /api/v1/auth/set-password` | token | completes INVITE / RESET |
| `GET /api/v1/auth/me` | session | principal + effective permissions (exists) |
| `GET /api/v1/admin/users` | user.manage | paginated, filterable |
| `POST /api/v1/admin/users` | user.manage | returns one-time token once |
| `GET /api/v1/admin/users/{id}` | user.manage | detail + roles + grants + recent sessions + recent audit |
| `PATCH /api/v1/admin/users/{id}` | user.manage | fields, roles, grants, status |
| `POST /api/v1/admin/users/{id}/reset` | user.manage | new token, sessions revoked |
| `POST /api/v1/admin/users/{id}/unlock` | user.manage | clears lockout |
| `DELETE /api/v1/admin/users/{id}/sessions` | user.manage | force sign-out everywhere |
| `GET /api/v1/admin/roles` | user.manage | roles with permission sets |

All handlers keep the existing pattern: `requirePermission` → zod validation → service → audited response with correlation id. The dev-only `dev-login` route is removed once local sign-in exists (`AUTH_DEV_LOGIN` stays as a test-only switch for the synthetic accounts).

## 7. UI (Administration → Users and roles)

- **User list**: table with search, status and role filters, sortable; row actions Edit, Reset credentials, Unlock, Disable/Enable, Sign out everywhere.
- **Create/Edit drawer**: username (immutable after create), display name, email, roles (checkboxes), extra permissions (multi-select with optional expiry), status. Save shows the one-time token in a copy box with the text "This is shown once. Give it to the user; they will choose their own password."
- **User detail**: profile, effective permissions (role-derived vs. explicit), active sessions with revoke, last 50 audit events for this user.
- **Sign-in page**: replaces the SSO placeholder with username/password; a disabled "Sign in with institutional account" remains until Phase 9. Set-password page for invite/reset tokens; change-password page (forced when `mustChangePassword`).
- **Header user menu**: "Change password", "Sign out".

## 8. Code changes

| Area | Change |
|---|---|
| `db/migrations/002_dash_schema.sql` | creates schema `dash`, identity tables, sessions, tokens; **moves** Job/JobRun/Snapshot/Setting/AuditEvent from `dbo` (001) to `dash` — 001 is rewritten before anyone has applied it (no production `jadi_app` exists yet) |
| `src/server/db/mssql.ts` | second pool `getDashPool()` using `DASH_CONNECTION_STRING` (login `jadi_dash`); `DATABASE_URL` removed |
| `src/server/store/mssql.ts` | table names prefixed `dash.`; audit sink implementation added (`MssqlAuditSink`) |
| `src/server/identity/` (new) | `users.ts` (CRUD service), `credentials.ts` (argon2, policy, tokens), `sessions.ts` (server-side sessions), `rateLimit.ts`; `IdentityStore` interface with memory + mssql implementations so mock mode still works with the synthetic accounts |
| `src/server/auth/session.ts` | cookie now carries a signed session id; `getPrincipal()` loads the session + user + roles/grants (cached per request); dev users become seeded rows in the memory identity store |
| `src/server/authz/permissions.ts` | permission keys stay as constants; role→permission sets are read from the store (seeded from the constants) |
| `src/app/api/v1/auth/*`, `src/app/api/v1/admin/users/*`, `src/app/api/v1/admin/roles` | routes per §6 |
| `src/app/(auth)/sign-in`, `set-password`, `change-password`, `src/app/(app)/admin/users/*` | pages per §7 |
| `scripts/bootstrap-admin.ts` | one-time: creates the first administrator from env `BOOTSTRAP_ADMIN_USERNAME/EMAIL` and prints a one-time token; refuses to run if any administrator exists |
| Tests | unit: hashing/policy, lockout state machine, last-admin guard, token expiry; integration: full invite → set-password → sign-in → change → disable → 401 flow against the memory identity store; SQL guardrails extended to `dash.*` (no `dbo` writes); staging test: migration applies, grants verified via `fn_my_permissions` |

## 9. Security checklist (Spec §18)

Argon2id with per-user salt; constant-time verification; no username enumeration (identical response and timing for unknown user / wrong password / locked); one-time tokens hashed at rest, single use, 72 h; sessions server-side and revocable; cookie `HttpOnly Secure SameSite=Lax`; CSRF: state-changing routes require the custom `x-requested-with` header and same-origin check (cookies are `SameSite=Lax`); rate limiting on sign-in, set-password, reset; audit for every identity event with correlation id; passwords, tokens and hashes never appear in logs, audit metadata, API responses or error messages (existing `safeSummary` extended); `DENY … ON SCHEMA::dbo` for the writable login; last-active-administrator guard; secrets (`DASH_CONNECTION_STRING`, `SESSION_SECRET`) from environment only.

## 10. Phasing and acceptance

| Step | Deliverable | Acceptance (Spec §21) |
|---|---|---|
| U1 | Migration 002 + login/grant script (`db/grants/jadi_dash.sql`) + store move to `dash.*`; staging test proves `dbo` writes are denied | 15 (migrations, backup notes) |
| U2 | Identity store (memory + mssql), credential service, server-side sessions, `bootstrap-admin` | 1 (sign in, see only permitted modules) |
| U3 | Admin users API + UI, invite/reset flow, disable/unlock, last-admin guard | 10 (administrators manage users) |
| U4 | Audit sink to `dash.AuditEvent`; audit page (list/filter) — also closes the Phase 3 audit item | 12 (student-level and export actions audited) |
| U5 | Remove dev-login from non-test builds; docs (README, OPERATIONS: create first admin, rotate `SESSION_SECRET`, unlock a user) | 13 (tests), 15 (docs) |

Estimated effort: U1–U2 two to three days, U3–U5 three to four days, on the current codebase.

## 11. Open items (added to ASSUMPTIONS)

- **A-21** placement of application tables in `ousadb` schema `dash` and a writable `jadi_dash` login — decided by J. Wilson 2026-09-18; DBA to create the login and grants (`db/grants/jadi_dash.sql` provided).
- **A-12** revised: local credentials now, SSO (provider still to be named) later via `externalProvider/externalId`.
- Password policy defaults above are proposals for the owner to confirm (length, lockout thresholds, session lifetimes).
- Whether administrators may see users' email addresses from the directory (yes in this plan — needed to create accounts) and whether usernames should match campus usernames (recommended, to ease the SSO transition).
