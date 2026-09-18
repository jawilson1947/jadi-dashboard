# Traceability Matrix (Spec §23.11)

Status: ✅ implemented · 🟡 partial · ⬜ planned (phase noted) — last updated 2026-09-18 (Clearance Breakdown card)

| Spec § | Requirement | Code | Tests | Status |
|---|---|---|---|---|
| §3.1–3.3 | Administrator / Operator / Viewer roles | `src/server/authz/permissions.ts` (`ROLE_PERMISSIONS`), `src/server/auth/dev-users.ts` | `tests/unit/authz.test.ts` | ✅ |
| §3.4 | RBAC + granular permissions, enforced server-side | `requirePermission()` in every `src/app/api/v1/**/route.ts` and `(app)/**/page.tsx` | `authz.test.ts`; manual: viewer → 403 on drill-down | ✅ |
| §4 | Information architecture / nav | `src/components/layout/AppShell.tsx` (`NAV`) | — | 🟡 pages beyond dashboard are placeholders |
| §5 | Shell: nav, title, semester, last refresh, user menu | `AppShell.tsx`, `(app)/layout.tsx` | screenshot review | ✅ |
| §5 | USD / thousands / 2-dp % formatting in presentation layer | `src/lib/format.ts` | `tests/unit/format.test.ts` | ✅ |
| §5 | Every card drills down | `HeroCard.tsx`, `SummaryCards.tsx` → `/dashboard/students` | `tests/integration/dashboard.test.ts` (reconciliation) | ✅ |
| §5 | Print option on every report view: whole-page print with report header (title, semester, data-captured, printed by/at) and running footer; single-card print (Clearance Breakdown); drill-down lists print **all rows** (fetched through the audited students endpoint, 2,000-row cap); admin Jobs/Users lists | `src/components/print/{PrintButton,PrintHeader,PrintAllRowsButton}.tsx`, `globals.css` `@media print`, wired in `dashboard/page.tsx`, `ClearanceBreakdownCard.tsx`, `dashboard/students/page.tsx`, `admin/jobs/page.tsx`, `admin/users/page.tsx` | Playwright print-media PDFs reviewed (dashboard 2 pp, card 1 p, 1,188-row enrolled list 24 pp) | ✅ |
| §5 | Tables: sort, paginate, column visibility, filter, keyboard | `src/components/tables/DataTable.tsx` | — | 🟡 sort + pagination + keyboard; column chooser/filters Phase 3 |
| §5 | Loading/empty/stale/partial/error states; never zero on failure | `MetricCard.tsx`, `services/dashboard.ts` (`Metric<T>`) | `dashboard.test.ts` "failed metric" | ✅ |
| §5 | Configurable theme, no hard-coded brand | `src/app/globals.css` tokens | — | ✅ (admin-editable in Phase 2) |
| §6.1 | Hero card: enrolled/cleared/not cleared/% + drill-down, reconciliation line, nightly tblOUSA figures | `services/dashboard.ts`, `HeroCard.tsx`, `mssql/sql.ts` (`enrollmentClearance`) | `dashboard.test.ts`, `mssql-sql.test.ts`, `tests/staging` | ✅ A-2 definitions |
| §6.2 | Current receivable (positive balances, current TRAD+LEAP terms) | `getCurrentReceivable`, `sql.ts` (`currentReceivable`), `ReceivableCard` | `dashboard.test.ts`, `tests/staging` | ✅ |
| §6.3 | Charges / credits / delta with admin rule, not color-only | `calculations.ts` (`deltaTreatment`), `ChargesCreditsCard` | `calculations.test.ts` | ✅ |
| §6.4 | DNR/DNC summary; DNR verifies absence from current enrollment | `mock/provider.ts`, `sql.ts` (`dnrDncSummary`, guard), `DnrDncCard`, `docs/validation-sql/dnr_dnc_source.sql` | `dashboard.test.ts`, `mssql-sql.test.ts`, `tests/staging`, `scripts/validate-dnr-dnc.ps1` | ✅ A-1 decided 2026-09-17 |
| §7 | Clearance Sprint | — | — | ⬜ Phase 3 |
| §7.3 | Classification mappings; Incoming Transfer = TEL_WEB_GRP_CDE 22 override (A-19) | `src/server/metadata/classifications.ts`, `sql.ts` (`isIncomingTransfer`) | `classifications.test.ts`, `dashboard.test.ts` | ✅ seed; admin editing Phase 3 |
| §7.3 | **Clearance Breakdown card** (under Current receivable): enrolled / cleared / not cleared / % per classification + Total; runs on screen load (snapshot refreshed when > 15 min old) and on **Refresh** through the audited job pipeline | `src/server/metadata/clearance-breakdown.ts`, `sql.ts` (`classificationCounts`), `jobs/definitions.ts` (`dashboard.clearanceBreakdown`), `services/dashboard.ts` (`autoRefresh`, `refreshClearanceBreakdown`), `api/v1/dashboard/clearance-breakdown/refresh`, `ClearanceBreakdownCard.tsx`; reference: `docs/validation-sql/clearance_by_classification.sql` | `clearance-breakdown.test.ts`, `dashboard.test.ts` (Total = hero, page-load refresh, Refresh audit), `tests/staging/clearance-breakdown.test.ts` (fast path ≡ supplied query, row for row) | ✅ |
| §8 | DNR/DNC analysis table + export | — | — | ⬜ Phase 3 |
| §9.1 | Academic-year grouping | `calculations.ts` (`academicYearForTerm`) | `calculations.test.ts` | ✅ rule; pages Phase 4 |
| §9.4 | Time-stamped snapshots with job id, timestamps, status, counts, error | `store/types.ts`, `store/memory.ts`, `store/mssql.ts`, `db/migrations/001_init.sql`, `jobs/runner.ts` | `jobs.test.ts` | ✅ |
| §10 | Student lookup & profile | — | — | ⬜ Phase 5 |
| §10.1 | PID masking | `format.ts` (`maskPid`), `services/dashboard.ts` | `format.test.ts`, `dashboard.test.ts` | ✅ |
| §11 | Mail merge & exports | `db/migrations` (ExportLog Phase 7) | — | ⬜ Phase 7 |
| §12 | AI analyses | `db/migrations` (AiRun Phase 8) | — | ⬜ Phase 8 |
| §13 | Reports catalog | — | — | ⬜ Phase 7 |
| §14.1 | User management: create / edit / activate-deactivate, roles and per-user grants, one-time invite & reset links, lockout/unlock, sign-out-everywhere; local password sign-in with server-side sessions; SSO seam (`externalProvider/externalId`) | `src/server/identity/*`, `db/migrations/002_identity.sql`, `db/grants/jadi_dash.sql`, `api/v1/admin/users/**`, `api/v1/auth/{sign-in,set-password,change-password,sign-out}`, `(app)/admin/users/**`, `(auth)/{sign-in,set-password,change-password}`, `scripts/{setup-dash-login.ps1,bootstrap-admin.ts}` | `credentials.test.ts`, `identity.test.ts` (invite→set→sign-in→change→disable, lockout, last-admin & self guards, expiring grants), `session.test.ts`, `tests/staging/dash-grants.test.ts` (dbo writes denied) | ✅ local credentials; SSO Phase 9 |
| §14.3 | Semester metadata: one current/previous per context, census/cleared totals, drop dates, worksheet folders | `metadata/terms.ts` (`tblOUSA` read-through, A-20), `admin/metadata/page.tsx`, `/api/v1/admin/metadata/semesters` | `dashboard.test.ts` (resolveTerms) | ✅ read-only; sprint-date overrides Phase 3 |
| §14.2 | Operator profiles | seed codes in `mock/synthetic.ts` (from FINDINGS) | — | ⬜ Phase 3 |
| §14.5 | Connection config, secrets never to browser/logs | `db/config.ts`, `db/mssql.ts`, `jobs/runner.ts` (`safeSummary`) | `jobs.test.ts` (redaction) | ✅ pattern; admin UI Phase 6 |
| §14.6 | Scheduled jobs: enable, schedule, last/next run, duration, status, rows, error, manual run, no overlap | `jobs/definitions.ts`, `jobs/runner.ts`, `worker.ts`, `services/admin.ts`, `admin/jobs/page.tsx`, `/api/v1/admin/jobs[/run]` | `jobs.test.ts` | ✅ (schedule editing UI Phase 3) |
| §15 | Typed raw values, parameterized SQL, single source of truth for terms, view names validated | `repositories/types.ts`, `mssql/sql.ts`, `mssql/provider.ts`, `metadata/terms.ts`, `docs/discovery/FINDINGS.md` | `mssql-sql.test.ts`, `tests/staging` | ✅ |
| §16 | Modular architecture, DB access isolated from UI | `src/server/repositories/**` only | lint rule Phase 2 | ✅ |
| §17 | Versioned JSON API, consistent errors, correlation IDs, bounded pages | `src/server/api/respond.ts`, `api/v1/**` | manual curl (401/403/200) | ✅ |
| §18 | Audit sign-in, student views, manual refresh, admin | `src/server/audit/audit.ts`, `services/admin.ts` | — | 🟡 in-memory sink; DB sink Phase 3 (`AuditEvent` table exists) |
| §18 | Secure cookies, no secrets logged | `session.ts`, `config.ts` | `session.test.ts` | ✅ — cookie carries only a signed session id; scrypt hashes; constant-time verify; generic sign-in error; rate limit + lockout; CSRF same-origin check in `handle()`; writable login DENY on dbo |
| §19 | Snapshot-first reads, stale-data warnings, per-module degradation, health endpoints | `services/dashboard.ts` (`readMetric`), `MetricCard`, `/healthz`, `/readyz` | `dashboard.test.ts` (stale, pending, failed) | ✅ |
| §20 | WCAG 2.2 AA | semantic headings, `role=meter`, `aria-sort`, focus styles, skip link | axe in Playwright — Phase 3 | 🟡 |
| §21.1 | Sign in, see only permitted modules | `AppShell` filters by permission; routes enforce | manual | ✅ |
| §21.2–3 | Values match validation SQL; totals reconcile with drill-downs | `dashboard.test.ts`, `tests/staging/mssql-provider.test.ts` | — | ✅ mock and staging (5/5 passed 2026-09-17; `docs/discovery/staging-test-output.txt`) |
| §21.11 | Failed/stale refreshes visible, not zero | `MetricCard`, header badge | `dashboard.test.ts` | ✅ |
| §22 | ASSUMPTIONS.md | `ASSUMPTIONS.md` | — | ✅ |
| §23.9 | Mock-data mode with no production DB | `DATA_PROVIDER=mock`, `mock/synthetic.ts` | all tests | ✅ |
