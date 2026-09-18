# JADI Student Billing Analysis Dashboard

Secure, responsive web application that surfaces current and historical student billing,
enrollment, and financial-clearance data from Jenzabar/JADI (`ousadb`) for analysts and
authorized operators. **Analysis only — the application never writes to Jenzabar.**

| Document | Purpose |
|---|---|
| `Student_Billing_Analysis_Dashboard_Requirements.md` | Authoritative functional baseline (the "Spec") |
| `PLAN.md` | Architecture, phased plan, page wireframes, schema, API contract |
| `ASSUMPTIONS.md` | Items that require business-owner confirmation before production |
| `docs/TRACEABILITY.md` | Spec section → code → tests |
| `docs/validation-sql/` | Reference SQL for acceptance validation (never executed by the app) |
| `docs/discovery/FINDINGS.md` | What staging discovery established about `ousadb` |
| `docs/USER-MANAGEMENT-PLAN.md` | Users, roles, sign-in and the `dash` schema (Phase 3a plan) |

## Current status: Phase 2 — snapshots, jobs, metadata read-through, real `mssql` provider

Works with **no database** (mock provider + in-process store): sign in with a synthetic account,
run the worker or press "Run now" under Administration → Jobs to capture snapshots, and the
Current Semester Dashboard reads those snapshots (hero card with the A-2 definitions and the
reconciliation line, receivable, charges/credits/delta, DNC/DNR per A-1). Administration →
Semester metadata shows the `tblOUSA` read-through.

With `DATA_PROVIDER=mssql` and a read-only `ousadb` connection string, the same jobs read the real
views (fast objects only — never `VIEW_OURM_FCA` aggregates, `VIEW_OURM_ACAD` or linked servers).
Definitions and column names were verified against staging: see `docs/discovery/FINDINGS.md`.

## Quick start

```bash
npm install
cp .env.example .env.local      # defaults: DATA_PROVIDER=mock, AUTH_DEV_LOGIN=true
npm run dev                     # http://localhost:3000
```

Use the development sign-in as `admin`, `operator`, `viewer`, or `viewer-plus` (a Viewer with the
explicit `student.view` grant) to see how modules and drill-downs change by role. Real accounts use
username + password (Administration → Users); see `docs/USER-MANAGEMENT-PLAN.md`.

```bash
npm run worker      # scheduled snapshot jobs (separate terminal); startup catch-up populates empty families
npm run typecheck   # tsc --noEmit
npm test            # vitest: calculations, classifications, formatting, authz, session, SQL guardrails, dashboard, job pipeline
npm run build       # production build
npm run test:staging  # ONLY with OUSADB_CONNECTION_STRING set: reads aggregates from staging and checks reconciliation
```

## Project layout

```
src/app/(auth)/                sign-in (username + password), set-password (one-time links), change-password
src/server/identity/           users, roles/grants, sessions, tokens, credential policy (memory + mssql stores)
src/app/(app)/                 authenticated shell and module pages
src/app/api/v1/                versioned JSON endpoints (authz → validate → service → respond)
src/server/repositories/       DataProvider interface; mock/ (synthetic) and mssql/ (read-only ousadb) providers
src/server/services/           business rules and calculations (unit-tested, no I/O)
src/server/metadata/           classification mappings and current/previous term source of truth
src/server/auth|authz|audit/   session, roles/permissions, audit writer
src/components/                layout, cards, tables (theme tokens only — no hard-coded brand colors)
src/lib/format.ts              the only place raw values become display strings
db/migrations/                 schema [dash] in ousadb (SQL Server), applied by scripts/migrate-app-db.ts
src/server/store/              AppStore: memory (JSON file) and mssql implementations
src/server/jobs/               job definitions, audited runner (lock, snapshot, status); src/worker.ts schedules them
scripts/                       discover-schema.ps1 / validate-dnr-dnc.ps1 (staging discovery), migrate-app-db.ts
tests/                         unit and integration tests
```

## Environment

See `.env.example`. Key switches:

- `DATA_PROVIDER=mock|mssql` — `mssql` requires `OUSADB_CONNECTION_STRING` (read-only login) and reads staging/production views via snapshot jobs only.
- `AUTH_DEV_LOGIN=true` — synthetic accounts; refused when `APP_ENV=production`.
- `APP_ENV=development|staging|production` — security guards key off this.
- `STALE_AFTER_MINUTES`, `DELTA_WARNING_RATIO`, `APP_TIMEZONE` — move to the admin Settings UI in Phase 3.
- `APP_STORE=memory|mssql`, `APP_STORE_FILE`, `IDENTITY_STORE_FILE`, `DASH_CONNECTION_STRING`, `WORKER_ID` — see below.
- `PASSWORD_MIN_LENGTH`, `LOCKOUT_THRESHOLD`, `LOCKOUT_MINUTES`, `SESSION_IDLE_HOURS`, `SESSION_ABSOLUTE_HOURS`, `CREDENTIAL_TOKEN_HOURS` — credential policy (defaults in `.env.example`).

## Application store and database

Jobs, runs, snapshots, settings **and dashboard users** live behind the `AppStore` / `IdentityStore`
interfaces (`src/server/store/`, `src/server/identity/`):

- `APP_STORE=memory` (default) — in-process, persisted to `APP_STORE_FILE` and `IDENTITY_STORE_FILE`.
  Good for development and demos; a single-process store cannot coordinate several workers.
- `APP_STORE=mssql` — schema `dash` inside `ousadb` (ASSUMPTIONS A-21), reached with the dedicated
  login `jadi_dash`, which may write **only** inside `dash` and is denied writes on `dbo`
  (`db/grants/jadi_dash.sql`). Plain SQL migrations in `db/migrations/`.

```bash
# 1. DBA (or, on staging, scripts/setup-dash-login.ps1) creates login jadi_dash + schema dash from db/grants/jadi_dash.sql
# 2. set DASH_CONNECTION_STRING (login jadi_dash) in .env.local, then:
npm run db:migrate
# 3. first administrator — prints a one-time set-password link once:
BOOTSTRAP_ADMIN_USERNAME=jwilson BOOTSTRAP_ADMIN_EMAIL=... BOOTSTRAP_ADMIN_NAME="..." npm run bootstrap:admin
```

Everyone else is created in Administration → Users; the administrator hands over a one-time link and the
person chooses their own password. There is no hard delete — accounts are disabled and keep their audit trail.

Audit events still use the in-memory sink; the `AuditEvent` table exists for the Phase 3 sink.

## Security posture

- Authorization enforced in every route/page via `requirePermission()`; UI hiding is cosmetic.
- Student-level drill-downs require `student.view`; Viewers do not have it by default.
- Sessions are HMAC-signed HttpOnly cookies; secrets never reach the browser or logs.
- Every dashboard view and student-list view writes an audit event with a correlation ID.
- Failed metrics render "Unavailable", never `0`; stale data is flagged in the header and on cards.
- Source SQL is confined to `src/server/repositories/mssql/sql.ts`, guarded by tests: read-only, whitelisted tblStudent columns (never SSN/DOB/gender/bank account/PIN), no linked servers, no FCA aggregates.
- No connection to a production database, no write-back; staging is read with a read-only login.

## Next

See `PLAN.md` §2 for Phases 3–9. Open items: `ASSUMPTIONS.md` A-3, A-18 (🔴) and the DBA questions.
'# jadi-dashboard' 
