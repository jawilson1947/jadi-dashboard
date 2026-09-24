# STUDENT-PLAN.md — Phase 5: Student Lookup & Profile

Status: Draft for review · 2026-09-23
Baseline: `PLAN.md` Phase 5 · Spec §10 · `docs/Jadi Dashboard Student Bio Specs.docx` (the "Bio Spec")
Companions: `ASSUMPTIONS.md` (A-24 … A-28 are new), `docs/TRACEABILITY.md`, `docs/discovery/FINDINGS.md`

Phase 5 turns the Bio Spec's five cards into the Student subsystem. It is the first module in the
application that is **student-level end to end** — no aggregates to hide behind — so the plan treats
permissions, masking and audit as first-class deliverables rather than trimmings, and keeps every
money figure traceable to the source the ASSUMPTIONS table already named authoritative (A-18).

---

## 1. Scope

The Bio Spec defines five cards. Mapped to the spec and to sub-phases:

| # | Bio Spec card | Spec § | Sub-phase | Core source |
|---|---|---|---|---|
| 1 | Student Bio (search + data form + photo) | §10.1, §10.2 | 5a, 5b | `tblStudent`, `VIEW_OURM_FCA`, photo share |
| 2 | Student Financial History — Current Semester Transactions | §10.3 | 5c | `jadi.dbo.trans_hist` |
| 2 | Student Financial History — Global History Transactions | §10.3 | 5c | `[172.18.96.11,1433\MSSQL].[TMSEPRD].dbo.trans_hist` |
| 3 | Global History Payment Analysis (aging, ratios, collections) | §10.3, §13.3 | 5d | derived from the global recordset |
| 4 | Financial Clearance Analysis (entry + eligibility gate) | §10.4 | 5e | `tblStudent.LastCleared` vs current `tblOUSA` row |
| 5 | Student Financial Clearance Status (worksheet items, 80% rule) | §10.4, §10.5 | 5e | `dbo.Sp_GetFCWorksheetItems`, `dbo.fn_CostAnalysis` |
| — | AI collection notice | §12 | 5f | aggregates + identified student data (A-26) |

Out of scope for Phase 5: mail merge (§11, Phase 7), the report catalog (§13, Phase 7), and the
clearance **worksheet PDF** viewer, which stays where `PLAN.md` put it — the Bio Spec's clearance
cards are a live recomputation from `Sp_GetFCWorksheetItems`, not the archived PDF in
`tblOUSA.WorksheetFolder`. Both appear on the profile's Clearance tab; they are different artefacts
and the UI labels them as such.

---

## 2. Decisions taken 2026-09-23 (J. Wilson)

These four came out of reading the Bio Spec against the existing ASSUMPTIONS table. They are recorded
here and mirrored as new rows A-24 … A-27 in `ASSUMPTIONS.md`.

| Ref | Question | Decision |
|---|---|---|
| **D-1** | Transaction history source | **Two sources as written.** Current-semester card reads `jadi.dbo.trans_hist` (co-located). Global card reads the `TMSEPRD` linked server. Both are implemented; the linked-server path stays behind a config flag and is **not executed against staging** until open question #6 confirms that `172.18.96.11` is not production. |
| **D-2** | The 80% clearance rule | **`dbo.fn_CostAnalysis` is authoritative** (consistent with A-8). The Bio Spec's inline formula is treated as a paraphrase. The literal formula is implemented *as a test oracle only*: a unit test asserts the two agree on fixtures, and any divergence on real data is reported as a validation defect, not rendered to users. |
| **D-3** | AI collection notice | **Built in Phase 5** (sub-phase 5f), behind the global AI kill switch and a new `ai.notice.create` permission. Because a collection notice necessarily carries the student's name, ID and balance, this is the first path in the application that sends **identified** data to an external model — it ships disabled and A-13 must be signed before it is enabled anywhere but mock mode. |
| **D-4** | Bio field exposure | Every field on the bio card is visible to `student.view` — **except the date of birth**, which requires the new `student.pii.view` grant and is masked to the birth year by default. (CNP was to be masked too, until the schema showed `tblStudent.CNP` is a `money` column rather than an identifier. It is "Credits Not Posted" — aid or payments awarded but not yet applied — confirmed 2026-09-24, and renders as currency under that name.) Contact fields (email, phone, home address) are `student.view`. The photo is in scope, served by an authenticated route and audited. ⚠️ *The answer selected both "masked + permissioned" and "all fields to student.view"; this is the reconciliation — one line of confirmation would close it.* |

---

## 3. New assumption rows (for `ASSUMPTIONS.md`)

| # | Item | Working assumption | Blocks |
|---|---|---|---|
| A-24 🔴 | **Global `trans_hist` linked-server target** | `[172.18.96.11,1433\MSSQL].[TMSEPRD]` is assumed to be production until the DBA says otherwise. The provider will not issue the query on staging while the flag is unset. Needs: confirmed target, a read-only login, and whether `SUBSID_CDE = 'AR'` is the only subsidiary of interest. | Global History card against real data |
| A-25 🟠 | **Aging basis for the payment analysis** | Reuses A-6 (oldest unpaid charge; Current / 1–30 / 31–60 / 61–90 / 90+ from `Setting.agingBuckets`). The Bio Spec asks for aging **on credit transactions**, which reads as recency-of-payment rather than age-of-debt — implemented as *both*: "age of the balance" (A-6) and "days since last credit" (the 6-month collections trigger). | Payment analysis card |
| A-26 🔴 | **Identified data in the AI collection notice** | The notice prompt carries name, ID, balance, last payment date and aging summary. Retention 90 days, same as A-13. Requires an explicit extension of A-13 to identified data before production enablement. | AI notice (5f) |
| A-27 🟠 | **Student photo share** | `STUDENT_PHOTO_SHARE` + `<idnumber>.jpg`, read by the web server's service account, streamed through an authenticated route — never a public path, never a direct UNC link in HTML. Needs: the share path, the account with read rights, and confirmation that a missing file is normal (silhouette placeholder) rather than an error. | Bio card photo |
| A-28 🟢 | **Transaction source-code map** | The Bio Spec's `source_cde` → label map (FA, RC, CG, BN, LB, IV, MS) is seeded into `Setting.transactionSourceLabels` and admin-editable, with the raw code shown for anything unmapped. Note the Bio Spec's `'IV’` carries a smart quote — the implementation uses `'IV'`. | Transaction cards |

---

## 4. Permissions, masking and audit

**New permissions** (added to `src/server/authz/permissions.ts`):

| Permission | Grants | Default roles |
|---|---|---|
| `student.pii.view` | Unmasked date of birth on the bio card | Administrator only; granted per user otherwise |
| `student.transactions.view` | Both transaction cards and the payment analysis | Administrator, Operator |
| `student.clearance.analyze` | The Financial Clearance Analysis and Status cards | Administrator, Operator |
| `ai.notice.create` | Request an AI-drafted collection notice | Administrator only (and only when `ai.enabled` and `ai.identifiedData.enabled`) |

Existing `student.view`, `student.pid.view`, `student.academic.view`, `worksheet.view` and
`export.create` keep their meanings. Viewers still get none of these without an explicit grant (§3.3).

**Masking** is applied in the service layer, never in the component — a component cannot be trusted to
be the only renderer. `maskPid()` gains a sibling `maskDob()`; the unmasked value is put into the
response only when the principal holds `student.pii.view` *and* asks for it, so an unprivileged
response never carries the real value in its JSON at all (`tests/integration/students.test.ts`
asserts this over a sample of the population, not just one record).

**Audit** (`dash.AuditEvent`) gains these actions, each recording the target student ID:
`student.search` (query shape and result count, never the raw result set), `student.profile.view`,
`student.pii.reveal`, `student.photo.view`, `student.transactions.view`, `student.clearance.analyze`,
`ai.notice.draft`. Rate limits: search 30/min/user, profile 120/min/user, AI notice 5/hour/user.

---

## 5. Data contract

### 5.1 `DataProvider` additions (`src/server/repositories/types.ts`)

```ts
  /** Bio Spec 1.1–1.2 — name (LIKE both parts) or exact/partial idnumber. Bounded by the service. */
  searchStudents(q: StudentSearchQuery): Promise<StudentSearchRow[]>;
  /** Bio Spec 1.3 — the full bio record. Unmasked; the service masks before it leaves the server. */
  getStudentBio(id: StudentKey): Promise<StudentBio | null>;
  /** Bio Spec 2 — jadi.dbo.trans_hist, current semester, newest first. */
  getCurrentTermTransactions(id: StudentKey): Promise<TransactionRow[]>;
  /** Bio Spec 2 — TMSEPRD linked server, SUBSID_CDE='AR', newest first. Whole history (A-24). */
  getGlobalTransactions(id: StudentKey): Promise<TransactionRow[]>;
  /** Bio Spec 1.5.1 — Sp_GetFCWorksheetItems for the current term's drop date. */
  getClearanceWorksheetItems(id: StudentKey, dropClassesDate: string): Promise<WorksheetItemRow[]>;
  /** A-8 / D-2 — fn_CostAnalysis columns for one student. */
  getCostAnalysis(id: StudentKey): Promise<CostAnalysisRow | null>;
```

### 5.2 New DTOs

```ts
export interface StudentSearchQuery {
  by: "name" | "id";
  lastName?: string;   // LIKE '%…%' — min 2 chars
  firstName?: string;  // LIKE '%…%' — optional, min 1 char when lastName is present
  idnumber?: string;   // exact or prefix
  limit: number;       // service-capped at 200
}

/** Bio Spec 1.3 recordset. `icon` and `[ID]` from the spec are presentation/plumbing, not data. */
export interface StudentSearchRow {
  idnumber: StudentKey;
  lastName: string;
  firstName: string;
  email: string;
  phone: string | null;
  lastCleared: TermKey | null;
  accountBalance: number;
  classificationCode: string;
  clearedCurrentSession: boolean;
  /** Derived, not stored: "cleared" | "not-cleared" | "not-enrolled" — drives the row icon. */
  state: StudentSearchState;
}

export interface StudentBio extends StudentSearchRow {
  middleName: string | null;
  /** ISO date. Masked to the year unless the caller holds student.pii.view (D-4). */
  dob: string | null;
  /** Masked unless student.pii.view (D-4). */
  cnp: string | null;
  pid: string;                    // masked per A-3
  address: PostalAddress | null;  // address, city, stateCode, zipCode, country
  /** Bio Spec 1.3: clearedon is stored YYYYMMDD; parsed here, formatted in the UI. */
  clearedOn: string | null;
  /** Resolved from tblOUSA (A-22) — the semester name, not the raw code. */
  lastClearedSemester: SemesterLabel | null;
  hasPhoto: boolean;
}

export interface TransactionRow {
  postedOn: string;        // TRANS_DTE, ISO
  description: string;     // TRANS_DESC
  amount: number;          // TRANS_AMT — negative = credit (A-5 vocabulary)
  sourceCode: string;      // SOURCE_CDE, raw
  sourceLabel: string;     // mapped via Setting.transactionSourceLabels (A-28)
}

export interface PaymentAnalysis {
  totalDebits: number;
  totalCredits: number;
  lastCreditOn: string | null;
  daysSinceLastCredit: number | null;
  cashRatio: number | null;        // |credits where source_cde='RC'| / |all credits|
  financialAidRatio: number | null;// |credits where source_cde='FA'| / |all credits|
  aging: AgingBucketRow[];         // A-6 buckets over the outstanding balance
  collectionsRecommended: boolean; // daysSinceLastCredit > 183 AND accountBalance > 0
  /** Every figure above cites the transaction count it was computed from, so a thin
   *  history is visible rather than presented as a confident ratio. */
  transactionCount: number;
}

export interface ClearanceAnalysis {
  eligible: boolean;               // lastCleared ∈ current term (Bio Spec 1.4.4)
  accountBalance: number;
  worksheetNetAmount: number;      // Bio Spec 1.5.2 — net of TRANS_AMT in the sproc recordset
  totalMoniesDue: number;          // 1.5.3 — accountBalance + net
  /** From fn_CostAnalysis (D-2): eighty, amtdue, needed, loan, payment. */
  costAnalysis: CostAnalysisRow | null;
  amountNeededToClear: number | null; // costAnalysis.needed; null when net < 0 (1.5.5 exit)
  items: WorksheetItemRow[];
}
```

### 5.3 SQL

Each statement lands verbatim in `docs/validation-sql/` first (the house rule from Phase 2b/3b), then
is refactored into a parameterized statement in `src/server/repositories/mssql/sql.ts`:

- `student_search_name.sql`, `student_search_id.sql`
- `student_bio.sql`
- `trans_hist_current_term.sql` (`jadi.dbo.trans_hist`, `id_num = @id`, `ORDER BY trans_dte DESC`)
- `trans_hist_global.sql` (linked server, `SUBSID_CDE = 'AR'`, the source-code CASE moved out of SQL
  into `Setting.transactionSourceLabels` so the mapping is admin-editable — the SQL returns raw codes)
- `fc_worksheet_items.sql` (`EXEC dbo.Sp_GetFCWorksheetItems @ID_NUM, @DropClassesDate`)
- `cost_analysis.sql` (`dbo.fn_CostAnalysis`)

`@DropClassesDate` comes from the `isCurrent = 1` `tblOUSA` row, never from the client. `id_num` is
bound as a parameter; the Bio Spec's literal `176941` is a sample, not a default.

---

## 6. API routes

| Method & path | Permission | Notes |
|---|---|---|
| `GET /api/v1/students/search?by=name\|id&last=&first=&id=` | `student.view` | Min lengths enforced server-side; bare wildcard rejected; capped at 200; audited with counts only |
| `GET /api/v1/students/{id}` | `student.view` | Bio card; DOB/CNP masked unless `student.pii.view`; audited |
| `GET /api/v1/students/{id}/photo` | `student.view` | Streams from `STUDENT_PHOTO_SHARE` (A-27); 404 → placeholder; audited; `Cache-Control: private, no-store` |
| `GET /api/v1/students/{id}/transactions?scope=current\|global&page=&pageSize=` | `student.transactions.view` | `scope=current` requires the student to be in the current term; `global` paginates by year (Bio Spec 2.1) |
| `GET /api/v1/students/{id}/payment-analysis` | `student.transactions.view` | Computed over the whole global recordset server-side, never over a page |
| `GET /api/v1/students/{id}/clearance-analysis` | `student.clearance.analyze` | 409 `NOT_CURRENT_TERM` with a plain-language body when ineligible (Bio Spec 1.4.4) |
| `POST /api/v1/students/{id}/collection-notice` | `ai.notice.create` | 503 when AI disabled or A-13/A-26 unsigned; returns draft text + citation block; audited |
| `GET /api/v1/students/{id}/academic` | `student.academic.view` | Unchanged from `PLAN.md`; still gated on A-4 |
| `GET /api/v1/students/{id}/worksheet` | `worksheet.view` | Unchanged — the archived PDF, distinct from the live analysis |

All routes: `requirePermission` first, zod-validated params, `{ data, meta }` envelope, correlation ID
on errors, no stack traces.

---

## 7. Pages

**P6 Student Lookup** (`/students`)

```
┌ Student Lookup ─────────────────────────────────────────────────────────┐
│ ( ) By name   (•) By ID      [ Last name ][ First name ]      [Search]   │
│ Enter at least 2 characters of a last name. Wildcards are not accepted.  │
├──────────────────────────────────────────────────────────────────────────┤
│ ●  ID      Last      First    Email            Phone      Last cleared   │
│ ✔  176941  Wilson    Jim      jw@…             (555) …    Fall 2026      │
│ ✖  180220  Alvarez   Rosa     ra@…             (555) …    Spring 2026    │
│      Balance $1,284.00 · Class FR · Cleared this session: No             │
└──────────────────────────────────────────────────────────────────────────┘
   ✔ cleared · ✖ not cleared · ○ not currently enrolled       (row → profile)
```

**P7 Student Profile** (`/students/[id]`) — header with photo, name, ID, masked PID, enrollment and
clearance state, balance in A-5 vocabulary ("debit balance" / "credit balance"). Tabs:

- **Bio** — the Bio Spec 1.3 data form. The date of birth renders as `1998 (year only)` with a
  **Reveal** control for holders of `student.pii.view`; the control is labelled "Reveal (recorded)"
  and revealing writes `student.pii.reveal` to the audit log, so it is honest about being watched.
  CNP renders as currency under its real name, Credits Not Posted.
- **Transactions** — *Current Semester* card (present only when the eligibility rule holds), then
  *Global History* with year-grouped pagination (Bio Spec 2.1): a year selector plus a page within
  the year, so a 15-year history is navigable rather than an infinite scroll.
- **Payment Analysis** — shown when `accountBalance > 0`. Debits vs credits totals, cash and
  financial-aid ratios of credits, aging bars with the companion table every chart in this app
  carries, and the collections banner when the last credit is over six months old. The banner is a
  **cue, not a determination** — same wording discipline as Red Flag (§13.3) — and carries the
  *Draft collection notice* button when 5f is enabled.
- **Clearance** — eligibility gate first; for current enrollees, the worksheet items table, net
  amount, total monies due, and the `fn_CostAnalysis` figures with "Amount needed to clear"
  prominent. For everyone else, the plain notice the Bio Spec asks for, with a link back to search.
  The archived worksheet PDF (if any) appears below, clearly labelled as the filed document.
- **Academic** — unchanged, still behind A-4.

Empty, stale, partial and error states on every card, per the Phase 1 standard: a failed card says
"Unavailable" with a correlation ID and never renders `0`.

---

## 8. Services and calculations

New: `src/server/services/students.ts` (search, bio assembly, masking policy),
`src/server/services/transactions.ts` (source-label mapping, year grouping, totals),
`src/server/services/payment-analysis.ts` (aging, ratios, collections trigger),
`src/server/services/clearance-analysis.ts` (eligibility, net amount, cost-analysis assembly),
`src/server/services/ai/collection-notice.ts` (prompt builder, citation block, retention).

Calculation rules, all unit-tested in `tests/unit/`:

1. **Search guards** — name search requires ≥ 2 characters of last name; `%` and `_` are escaped, not
   passed through; ID search accepts digits only. A query that would match everything is refused.
2. **Eligibility** (Bio Spec 1.4.4) — `lastCleared ∈ { JADI_TradName, JADI_LeapName }` of the
   `isCurrent = 1` row. Per A-16, Traditional and LEAP are the same semester; the gate never
   distinguishes them.
3. **Net amount** (1.5.2) — sum of `TRANS_AMT` over the `Sp_GetFCWorksheetItems` recordset, decimal
   arithmetic, no floating-point accumulation.
4. **Total monies due** (1.5.3) — `AccountBalance + netAmount`, using `tblStudent.AccountBalance`
   (A-18).
5. **Amount needed to clear** — `fn_CostAnalysis.needed` (D-2). When `netAmount < 0` the card exits
   with "No amount outstanding for clearance" per 1.5.5. A test asserts the doc formula
   `AccountBalance + (net * 0.80)` agrees with `needed` on fixtures; a mismatch on real data is
   logged as a validation defect for sign-off, not shown to users.
6. **Ratios** — denominators are absolute totals of credit transactions; zero denominator → `null`
   → "N/A", never `0%`.
7. **Collections trigger** — `daysSinceLastCredit > 183 && accountBalance > 0`. "No credits on file"
   is its own state, distinct from "last credit was long ago".

---

## 9. Sub-phases

| Sub-phase | Scope | Exit criteria |
|---|---|---|
| **5a — Search** | Permissions, `searchStudents` on mock + mssql, search page, guards, audit, rate limit | Guard tests pass; a wildcard-only query is refused; search audited with counts only |
| **5b — Bio card + photo** | `getStudentBio`, masking helpers, `student.pii.view`, profile shell and Bio tab, photo route (A-27) | Unprivileged response JSON contains no unmasked DOB/CNP (asserted in an integration test, not just the UI); missing photo renders a placeholder |
| **5c — Transaction cards** | Both `trans_hist` sources (D-1), source-label setting (A-28), year-grouped pagination | Current-term card appears only for current enrollees; global card runs against mock; linked-server path unit-tested and flag-gated pending A-24 |
| **5d — Payment analysis** | Aging, ratios, totals, collections cue | Totals reconcile with `tblStudent.AccountBalance` within a documented tolerance, or the difference is displayed with its source (A-18 discipline) |
| **5e — Clearance analysis** | Eligibility gate, `Sp_GetFCWorksheetItems`, `fn_CostAnalysis`, Clearance tab | Ineligible students get the notice and no figures; doc-formula equivalence test present and green on fixtures |
| **5f — AI collection notice** | Prompt builder, citation block, kill switch, `ai.notice.create`, 90-day retention | Disabled by default; returns 503 with a clear reason until A-13 and A-26 are signed; prompt content asserted in tests (no PID, no transaction rows beyond the summary) |

Sizing: 5a–5b ≈ 4 days, 5c ≈ 3 days, 5d ≈ 2 days, 5e ≈ 3 days, 5f ≈ 2 days — roughly three weeks
including tests and traceability updates. 5a–5e are independent of the DBA; only the real-data
validation of 5c waits on A-24.

---

## 10. Tests

- **Unit** — search guards, masking, net amount, eligibility, ratios with zero denominators, aging
  boundaries, the D-2 equivalence oracle, source-label fallback for unmapped codes.
- **Integration** — every route returns 401/403 correctly for each of the three roles plus a granted
  Viewer; masked fields absent from unprivileged payloads; audit rows written with the right action
  and target; rate limits enforced.
- **E2E (Playwright + axe)** — search → profile → each tab; ineligible-student clearance path; photo
  placeholder; AI notice disabled state; accessibility checks on the profile, which is the densest
  page in the application.
- **Validation (Phase 6)** — each `docs/validation-sql/` statement compared row-for-row against the
  app's parameterized version on the approved non-production copy.

---

## 11. Open items carried into Phase 6

1. **A-24** — confirm the `TMSEPRD` linked-server target and obtain a read-only login (blocks the
   Global History card on real data).
2. **A-27** — the photo share path, the reading account, and the file-naming convention.
3. **A-13 / A-26** — approval for identified data in the AI notice.
4. **D-4** — one line confirming the DOB/CNP reconciliation in §2.
5. `Sp_GetFCWorksheetItems` — confirm its recordset shape and whether it is safe to call for a
   student with no worksheet (expected: empty set, not an error).
