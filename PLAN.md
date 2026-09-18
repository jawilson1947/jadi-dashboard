# JADI Student Billing Analysis Dashboard — Implementation Plan

Status: Draft for review · Baseline: `Student_Billing_Analysis_Dashboard_Requirements.md` (the "Spec")
Companion files: `ASSUMPTIONS.md` (blocking questions), `docs/TRACEABILITY.md` (spec section → code/tests), `docs/discovery/FINDINGS.md` (staging discovery), `docs/USER-MANAGEMENT-PLAN.md` (users, roles, sign-in — Phase 3a)

This plan answers Spec §24 items 1–5: architecture and repo structure, phased plan, blocking questions (see `ASSUMPTIONS.md`), page inventory with text wireframes, and the application schema and API contract.

---

## 1. Architecture

### 1.1 Overview

```
┌─────────────────────────────── Browser ───────────────────────────────┐
│  Next.js UI (React, TypeScript, Tailwind + Radix/shadcn, Recharts)     │
│  Pages call versioned JSON routes only — no SQL, no secrets in the UI  │
└──────────────────────────────┬────────────────────────────────────────┘
                               │ HTTPS, secure cookies, CSRF, rate limit
┌──────────────────────────────▼────────────────────────────────────────┐
│  Next.js server (App Router)                                           │
│  /api/v1/*  ── auth (Auth.js/OIDC) ── authz (RBAC + permissions) ──    │
│              ── validation (zod) ── audit ── service layer             │
│                                                                        │
│  services/         business rules (DNC/DNR, clearance %, academic yr) │
│  repositories/     typed data access, ONE interface, TWO providers:   │
│     ├─ mock/        synthetic fixtures (default in dev, tests, demos)  │
│     └─ mssql/       read-only ousadb views + Jenzabar Cloud trans_hist │
└───────────────┬──────────────────────────────────────┬────────────────┘
                │ Prisma                                │ mssql (read-only login)
┌───────────────▼───────────────┐        ┌─────────────▼─────────────────┐
│ App DB — SQL Server `jadi_app`│        │ Source — SQL Server `ousadb`  │
│ users, roles, permissions,    │        │ view_ourm_fca, view_ourm_stats│
│ metadata, operators, snapshots│        │ view_ourm_charges/credits,    │
│ jobs, audit, exports, ai_runs │        │ tblStudent, tblOUSA, ACAD view│
└───────────────────────────────┘        │ jenzabar_cloud.trans_hist     │
                ▲                        └───────────────────────────────┘
                │ writes snapshots + job state
┌───────────────┴───────────────┐
│ Worker (Node, same codebase)  │  scheduled refresh jobs, DB-backed
│ `npm run worker`              │  locking (no overlap), retries, status
└───────────────────────────────┘
```

Key decisions (confirmed with product owner 2026-09-17):

| Decision | Choice | Why |
|---|---|---|
| Framework | Next.js 15 (App Router) + TypeScript, strict | Spec default; one language across UI, API, worker |
| App tables | **Revised 2026-09-18:** schema `dash` inside `ousadb` (A-21), written through a dedicated `jadi_dash` login that is `DENY`-ed writes on `dbo`; the separate `jadi_app` database is dropped | One database to run and back up; the read-only guarantee for source data rests on grants, which are auditable |
| App DB access | `mssql` driver + plain SQL migrations (`db/migrations`) behind an `AppStore` interface; in-memory/JSON store for dev | One driver for both databases; Prisma dropped in Phase 2 (engine download blocked in the build sandbox, and the app-owned schema is small) |
| Source access | `mssql` driver, parameterized queries, read-only login | Spec §15; SQL lives only in `src/server/repositories/mssql/sql.ts` |
| Data-access seam | `DataProvider` interface with `mock` and `mssql` implementations selected by `DATA_PROVIDER` env | Spec §23.9 mock mode; lets UI/tests run with no database |
| Auth | **Revised 2026-09-18:** local username/password (Argon2id, server-side sessions) managed by administrators, with an `externalProvider/externalId` seam for SSO later (A-12); see `docs/USER-MANAGEMENT-PLAN.md` | Owner decision; spec's SSO preference deferred to Phase 9 |
| Authorization | Roles → permission set, checked in a single `requirePermission()` helper used by every route/server action | Spec §3.4: enforce server-side |
| Background jobs | Worker process in the same repo using `jadi_app.Job`/`JobRun` tables + row lock for mutual exclusion; cron expressions via `croner` | Spec §14.6: durable, DB-backed, no overlap |
| Charts | Recharts wrapped in an accessible `<Chart>` that always renders a companion table | Spec §5 |
| Validation | zod for every request/response; typed numeric/date values from SQL, formatting only in UI | Spec §15 |
| Tests | Vitest (unit/integration), Playwright (e2e + axe accessibility) | Spec §21.13–14 |

### 1.2 Repository structure

```
jadiDashboard/
├── PLAN.md  ASSUMPTIONS.md  README.md
├── docs/                      requirements, TRACEABILITY.md, OPERATIONS.md, wireframes
├── db/migrations/             jadi_app SQL migrations (scripts/migrate-app-db.ts applies them)
├── src/
│   ├── app/                   Next.js routes (UI pages + /api/v1/*)
│   │   ├── (auth)/sign-in
│   │   ├── (app)/             authenticated shell: dashboard, sprint, dnr-dnc, history,
│   │   │                      students, reports, ai, admin/*
│   │   └── api/v1/            JSON endpoints (thin: authz → validate → service → respond)
│   ├── components/            ui/ (primitives), charts/, tables/, cards/, layout/
│   ├── server/
│   │   ├── auth/              Auth.js config, session, requirePermission()
│   │   ├── authz/             roles, permissions, policy tests
│   │   ├── services/          dashboard, clearance, dnrDnc, history, students, exports, ai, admin
│   │   ├── repositories/
│   │   │   ├── types.ts       DataProvider interface + DTOs (single source of truth)
│   │   │   ├── mock/          synthetic generator + fixtures
│   │   │   └── mssql/         provider.ts + sql.ts (parameterized statements, guarded by tests)
│   │   ├── store/             AppStore interface: memory (JSON) and mssql (jadi_app)
│   │   ├── jobs/              job definitions, runner, locking
│   │   ├── audit/             audit writer (never logs secrets or result sets)
│   │   └── db/                mssql pools (source + app), config loader (zod env schema)
│   ├── lib/                   formatting (currency/%/counts), dates/timezone, csv-safe export
│   └── worker.ts              worker entry point
├── tests/                     unit/, integration/, e2e/, fixtures/
└── .env.example
```

Rules: no source SQL outside `repositories/mssql/sql.ts` and no app SQL outside `store/mssql.ts`; no `fetch` to source DB from components; every `/api/v1` handler starts with `requirePermission`; every student-level read and every export writes an audit row.

---

## 2. Phased implementation plan

Each phase ends with a demo on synthetic data, passing tests, and updated `TRACEABILITY.md`. Nothing connects to production `ousadb` until Phase 6 is approved.

| Phase | Scope | Spec sections | Exit criteria |
|---|---|---|---|
| **0 — Plan** (this document) | Architecture, questions, schema, API contract, wireframes | §22–24 | Owner approves stack and phase order; blocking answers gathered |
| **1 — Foundation & Current Semester Dashboard** ✅ 2026-09-17 | Repo, CI, env config, Prisma schema + migrations, mock provider with synthetic data, app shell (nav, semester indicator, refresh time, user menu), dev sign-in with 3 roles, RBAC helper, audit writer, `/api/v1/dashboard/current`, Hero card + Receivable + Charges/Credits/Delta + DNR/DNC summary cards with drill-down tables, error/stale/empty states | §3, §5, §6, §15, §17, §18 | Acceptance 1, 2 (vs mock validation), 3, 11 on synthetic data |
| **2 — Metadata & Snapshot Jobs** ✅ 2026-09-17 (operators/mappings admin UI moved to Phase 3; `tblOUSA` is read-through per A-20; mssql provider delivered early) | Admin: semester metadata (current/previous term validation), classification mappings, operator profiles with effective dates, sprint dates; worker + Job/JobRun/Snapshot tables; scheduled jobs for the 8 metric families; job status UI; manual refresh through the same pipeline; stale-data threshold | §7.3 mappings, §9.4, §14.2, §14.3, §14.6, §19 | Acceptance 10, 11; dashboards read from snapshots |
| **2b — Clearance Breakdown card** ✅ 2026-09-18 | Card under Current receivable: enrolled / cleared / not cleared / % per classification with Total (supplied query saved verbatim in `docs/validation-sql/clearance_by_classification.sql`); fast equivalent over VIEW_OURM / VIEW_OURM_CLEARED / student_master; job `dashboard.clearanceBreakdown` (every 15 min); runs on screen load when the snapshot is > 15 min old and on the card's **Refresh** button (any dashboard viewer; audited `dashboard.refresh`) | §7.3, §14.6, §19 | Staging equivalence test: supplied query ≡ app rows |
| **3a — Users, roles & sign-in** (`docs/USER-MANAGEMENT-PLAN.md`) — U1–U3 ✅ 2026-09-18 (schema `dash` + `jadi_dash` on staging, password sign-in, server-side sessions, Administration → Users; U4 audit sink and U5 dev-login removal/docs remain) | `dash` schema migration and grants, identity store, Argon2id credentials, server-side sessions, admin Users UI (create/invite, edit roles and grants, disable, reset, unlock), audit sink to `dash.AuditEvent`, bootstrap-admin script | §3, §14.1, §18, §21.1, §21.10, §21.12 | Acceptance 1, 10, 12 |
| **3 — Clearance Sprint & DNR/DNC Analysis** | Cleared by date/operator/classification with totals and drill-downs; prior-semester same-point comparison; DNR/DNC detail table with filters, dedup rule, receivable total; CSV/XLSX export with audit | §7, §8, §11 (export core) | Acceptance 5 (needs owner sign-off on rules), 6, 12 |
| **4 — Historical Analysis** | Academic-year grouping, Enrolled vs Cleared trends, Global receivables/credits, Receivables by semester with school-year grouping, trend charts + tables + exports | §9 | Acceptance 7 |
| **5 — Student Lookup & Profile** | Search with min length/wildcard guards, profile bio, payment profile (`trans_hist`), aging buckets, academic link (permissioned), clearance worksheet via authenticated PDF endpoint, profile-access audit | §10 | Acceptance 8, 12 |
| **6 — Real data connection (read-only)** | `mssql` provider against a **non-production copy** first; schema validation (ACAD view name), reconcile hero totals to drill-downs, validation SQL comparison harness, connection admin screen with secrets in server config | §14.5, §15, §21.2–4 | Acceptance 2, 3, 4 against approved validation SQL |
| **7 — Mail Merge, Reports, Red Flag** | Mail-merge builder (criteria, preview count, approved field list, formula-injection safe, row cap); report catalog: Revenue Assessment (only once formulas approved), Receivable Analysis, Red Flag with admin thresholds | §11, §13 | Acceptance 9 |
| **8 — AI Analyses** | Server-side aggregate-only prompt builder, citation of metric/period/filters/snapshot, facts vs hypotheses layout, global disable, prompt/model/output audit; 5 initial modules | §12 | Owner approves model hosting and data-sharing (A-13) |
| **9 — Users/SSO, JADI setup migration, hardening & release** | OIDC SSO, user management, inventory of legacy C# JADI site and migration/rollback plan, security scanning, WCAG 2.2 AA audit, performance targets, operations docs, backup/restore | §14.1, §14.4, §18–21 | Acceptance 1, 13, 14, 15 |

Rough sizing: Phases 1–2 ≈ 3 weeks, 3–5 ≈ 4 weeks, 6 ≈ 1–2 weeks (depends on DBA access), 7–9 ≈ 4 weeks. Owner review gates after Phases 0, 2, 5, 6, and 9.

---

## 3. Page inventory and text wireframes

Shared shell on every authenticated page:

```
┌ JADI Billing Dashboard ─────────────────────────────────────── [Fall 2026 ▾] Refreshed 07:05 CT  [J. Wilson ▾] ┐
│ ▍Dashboard        │  Page title                                                  [Filters ▾] [Reset]            │
│  Clearance Sprint │  Active filters: Semester: Fall 2026 ×  Classification: FR ×                                │
│  DNR/DNC          │                                                                                              │
│  Historical       │  ...page content...                                                                          │
│  Students         │                                                                                              │
│  Reports          │  Stale-data banner appears here when refresh age > threshold                                 │
│  AI Analyses      │                                                                                              │
│  Administration ▸ │                                                                                              │
└───────────────────┴──────────────────────────────────────────────────────────────────────────────────────────────┘
```

**P1 Sign In** — institution logo (theme), "Sign in with <institution>" button; dev-only credentials form when enabled; error state; no student data.

**P2 Current Semester Dashboard** (§6)
```
┌ Cleared vs Enrolled ───────────────────────────────┐ ┌ Current Receivable ──────────┐
│  ◐ 78.42% financially cleared                      │ │ $1,284,512.33                 │
│  Enrolled 2,431 ▸  Cleared 1,906 ▸  Not cleared 525 ▸ │ │ 612 students with balance ▸   │
│  ▲ +42 cleared since yesterday · snapshot #1042    │ │ term: Fall 2026 (TRAD+LEAP)   │
└────────────────────────────────────────────────────┘ └──────────────────────────────┘
┌ Charges vs Expected Credits ───────────────────────┐ ┌ Did Not Clear / Did Not Return ┐
│ Total charges        $18,204,110                   │ │ DNC  525 students  $2.1M ▸     │
│ Expected aid/credits $15,911,002                   │ │ DNR  188 students  $0.9M ▸     │
│ Delta  ● Warning     $2,293,108  (rule: >10%)      │ │ rule status: pending sign-off  │
└────────────────────────────────────────────────────┘ └────────────────────────────────┘
[Drill-down drawer/table: sortable, paginated, column chooser, export if permitted]
```

**P3 Clearance Sprint** (§7) — sprint date range header (admin-defined); tabs: By Date (line/column chart + table with total-to-date, click a day → students), By Operator (bar + table with Unknown/Unmapped and total), By Classification (table: enrolled/cleared/not cleared/% with grand total), Compare to prior semesters (same-day-of-sprint overlay), AI summary panel (labelled, collapsible).

**P4 DNR/DNC Analysis** (§8) — two summary cards; filter bar (category, classification, balance range, semester, last cleared); table with the 10 required columns, default sort category → classification → last → first; footer "Total positive receivable for filtered population"; Export CSV/XLSX (permissioned); row → Student Profile; info popover documenting dedup key.

**P5 Historical Analysis** (§9) — academic-year range picker; Enrolled vs Cleared (line/grouped column toggle + table with Fall/Spring census and cleared, %); Global Receivables and Credits/Payments cards (label configurable pending A-5); Receivables by Semester (trend + sortable table, semester/school-year toggle, export); snapshot picker showing job ID and timestamps.

**P6 Student Lookup** (§10.1) — search box (ID exact/partial, last, first, PID if permitted; min 3 chars for names); results table with masked PID, enrollment state, last enrolled semester, clearance state, balance.

**P7 Student Profile** (§10.2–10.5) — header (name, ID, masked PID, enrolled/last enrolled, clearance state, balance); tabs: Overview, Payments (transactions newest first, aging buckets, contribution ratio if approved, source freshness), Academic (permissioned; GPA if approved; major), Clearance Worksheet (auto-cleared notice for `sa`, authenticated PDF viewer, or "No worksheet on file"). Every tab view is audited.

**P8 Reports and Analyses** (§13) — catalog cards for Revenue Assessment, Receivable Analysis, Red Flag; each opens a parameterized report with chart + table + export; Red Flag shows rule name, threshold, and "analyst cue — not an eligibility determination" note.

**P9 AI Analyses** (§12) — module list; each output: "AI-assisted" badge, Facts / Hypotheses / Questions to ask sections, citation footer (metric, period, filters, snapshot ID, model), regenerate button; disabled state when admin turns AI off.

**P10 Administration** — Users & Roles (table, invite/deactivate, role + permission grants), Operators (code, display name, active, effective dates, history), Semester/JADI Metadata (terms, current/previous flags with validation, school-year map, census/cleared totals, sprint dates, classification mappings with sort order), Data Connections (server, database, auth mode, encryption, "Test connection"; secrets write-only), Refresh Schedules & Job Status (per job: enabled, cron, last/next run, duration, status, rows, Run now, Retry, error details), Audit Log (filter by actor, action, target, date; export).

---

## 4. Application database schema (`jadi_app`, Prisma)

Owned tables only — no student data is copied except within audited exports/snapshots as aggregates.

| Table | Purpose / key columns |
|---|---|
| `User` | id, email, displayName, externalId (OIDC sub), isActive, createdAt, lastSignInAt |
| `Role` / `Permission` / `RolePermission` / `UserRole` / `UserPermission` | RBAC + granular grants (`dashboard.view` … `audit.view` per §3.4) |
| `Semester` | id, code (e.g. `FA2026`), name, programContext (`TRADITIONAL`/`LEAP`), ousaKey (maps to `tblOUSA` identifier), academicYear, isCurrent, isPrevious, censusCount?, clearedTotal?, sprintStart?, sprintEnd? — unique constraint: one current/previous per programContext |
| `ClassificationMapping` | sourceCode, displayName, sortOrder, isActive (seeded from §7.3) |
| `OperatorProfile` | sourceCode (`ClearedBy`), displayName, email?, department?, isActive, effectiveFrom, effectiveTo |
| `DataConnection` | name, server, database, authMode, encrypt, trustServerCert, secretRef (never the secret), lastTestAt, lastTestStatus |
| `Job` | key (e.g. `dashboard.current`), name, cronExpression, isEnabled, minIntervalMinutes, lockedAt, lockedBy |
| `JobRun` | jobId, startedAt, finishedAt, status, sourceTimestamp, rowsProcessed, errorSummary, triggeredBy (`schedule`/`manual:<userId>`) |
| `Snapshot` | id, jobRunId, metricFamily, semesterId?, capturedAt, payload (JSON of typed aggregates), rowCount |
| `AuditEvent` | actorUserId, action, targetType, targetId (student key hashed/masked as policy dictates), correlationId, ip, metadata JSON, createdAt |
| `ExportLog` | userId, kind (`csv`/`xlsx`/`mailmerge`), filters JSON, columns, rowCount, fileType, createdAt |
| `AiRun` | userId, module, model, promptHash, inputSnapshotIds, outputText, createdAt, retentionUntil |
| `Setting` | key, value JSON (theme, timezone, stale threshold, delta rule, aging buckets, red-flag thresholds, ai.enabled, export.maxRows) |

---

## 5. API contract (v1)

All routes: session cookie auth, `requirePermission`, zod-validated query/body, JSON `{ data, meta: { snapshotId?, capturedAt?, correlationId } }` or `{ error: { code, message, correlationId } }`. List routes: `page`, `pageSize ≤ 200`, `sort`, `filters`.

| Method & path | Permission | Returns |
|---|---|---|
| `GET /api/v1/dashboard/current` | dashboard.view | enrolled, cleared, notCleared, clearedPct, receivable, charges, credits, delta, dnc/dnr counts+balances, priorSnapshot delta, per-metric status (`ok`/`stale`/`failed`) |
| `GET /api/v1/dashboard/current/students?population=enrolled\|cleared\|notCleared\|receivable` | student.view | paginated drill-down rows |
| `GET /api/v1/dashboard/clearance-by-date` | dashboard.view | rows {date, cleared, cumulative}, total |
| `GET /api/v1/dashboard/clearance-by-operator` | dashboard.view | rows {operatorCode, displayName, cleared}, unmapped, total |
| `GET /api/v1/dashboard/clearance-by-classification` | dashboard.view | rows {code, name, enrolled, cleared, notCleared, pct}, grandTotal |
| `GET /api/v1/dnr-dnc` | student.view | paginated rows (10 columns) + totalPositiveReceivable |
| `POST /api/v1/dnr-dnc/export` | export.create | file stream; writes ExportLog + AuditEvent |
| `GET /api/v1/history/enrollment-clearance?from=2019&to=2026` | history.view | per academic year: fallCensus, springCensus, fallCleared, springCleared, pcts |
| `GET /api/v1/history/receivables?groupBy=semester\|schoolYear` | history.view | rows + global receivable/credit totals |
| `GET /api/v1/students/search?q=&by=id\|last\|first\|pid` | student.view | bounded results, masked PID |
| `GET /api/v1/students/{id}` | student.view | profile overview (audited) |
| `GET /api/v1/students/{id}/transactions` | student.view | trans_hist rows (typed), aging buckets, contribution ratio (if approved) |
| `GET /api/v1/students/{id}/academic` | student.academic.view | approved academic fields (audited) |
| `GET /api/v1/students/{id}/worksheet` | worksheet.view | `{ status: 'auto' \| 'available' \| 'none' }` + PDF stream on `available` |
| `POST /api/v1/exports/mail-merge/preview` | mailmerge.create | matching count + echoed criteria |
| `POST /api/v1/exports/mail-merge` | mailmerge.create | CSV/XLSX stream (formula-safe), logged |
| `GET/POST/PATCH /api/v1/admin/users[/{id}]` | user.manage | user + role CRUD |
| `GET/POST/PATCH /api/v1/admin/operators[/{id}]` | operator.manage | operator profiles with history |
| `GET/PUT /api/v1/admin/metadata/*` | metadata.manage | semesters, classification mappings, settings |
| `GET/PATCH /api/v1/admin/schedules[/{jobKey}]` | schedule.manage | job config |
| `GET /api/v1/admin/jobs`, `POST /api/v1/admin/jobs/{jobKey}/run` | schedule.manage | run history; manual run through same pipeline |
| `GET /api/v1/admin/audit` | audit.view | paginated audit events |
| `POST /api/v1/ai/{module}` | ai.view | AI narrative with citations; 503 when disabled |
| `GET /healthz`, `GET /readyz` | none | liveness / readiness (no sensitive data) |

---

## 6. Data provider interface (the seam between mock and SQL Server)

```ts
interface DataProvider {
  getEnrollmentClearance(term: TermKey): Promise<{ enrolled: number; cleared: number; notCleared: number }>;
  getCurrentReceivable(term: TermKey): Promise<{ total: Decimal; studentCount: number }>;
  getChargesCredits(term: TermKey): Promise<{ charges: Decimal; credits: Decimal }>;
  getDnrDnc(params: DnrDncQuery): Promise<Page<DnrDncRow>>;
  getClearanceByDate(range: DateRange): Promise<ClearanceByDateRow[]>;
  getClearanceByOperator(term: TermKey): Promise<ClearanceByOperatorRow[]>;
  getClearanceByClassification(term: TermKey): Promise<ClearanceByClassificationRow[]>;
  getHistoricalEnrollmentClearance(years: YearRange): Promise<AcademicYearRow[]>;
  getReceivablesBySemester(): Promise<ReceivableBySemesterRow[]>;
  getGlobalBalances(): Promise<{ positive: Decimal; negative: Decimal }>;
  searchStudents(q: StudentSearch): Promise<StudentSearchRow[]>;
  getStudent(id: StudentKey): Promise<StudentProfile | null>;
  getStudentTransactions(id: StudentKey): Promise<TransactionRow[]>;
  getStudentAcademic(id: StudentKey): Promise<AcademicRow | null>;
  getWorksheetRef(id: StudentKey): Promise<{ clearedBy: string; pdfRef?: string } | null>;
  getMailMergeRows(criteria: MailMergeCriteria, limit: number): Promise<MailMergeRow[]>;
}
```

The supplied SQL from the mind map is preserved verbatim in `docs/validation-sql/` as the reference; the `mssql` provider refactors each into parameterized statements returning raw typed values (no `FORMAT()`).

---

## 7. Cross-cutting standards

- **Calculations** live in `src/server/services/*` with unit tests: clearance % (divide-by-zero → `null` rendered as "N/A"), academic year (Fall YYYY + Spring YYYY+1), classification normalization (Incoming Transfer→TR before FF/FR→Freshmen; blank/null/XX→Unclassified), DNC/DNR (behind a feature flag until A-1 is signed off).
- **Formatting** only in `src/lib/format.ts`: USD, thousands separators, 2-decimal percentages, institution timezone from `Setting`.
- **States**: every card/table has loading, empty, stale, partial, and error states; a failed metric renders "Unavailable" with correlation ID, never `0`.
- **Audit**: sign-in, student profile/worksheet/academic view, exports, AI runs, admin and schedule changes, manual refresh.
- **Security**: read-only SQL login, secrets from env/secrets manager only, security headers via middleware, rate limiting on search/export/AI, CSV formula-injection escaping, PID masking, no stack traces in responses.
- **Accessibility**: shadcn/Radix primitives, focus-visible styles, chart companion tables, axe checks in Playwright.
