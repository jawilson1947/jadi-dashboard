# REPORTS-PLAN.md — Phase 7a: Report Catalog

Status: **Draft for review** · Author: Claude, 2026-09-29 · Owner: J. Wilson
Baseline: `docs/Jadi Dashboard Report Specs.docx` (the "Report Spec") and the six T-SQL scripts in `db/sql/`
Companions: `PLAN.md` (Phase 7), `ASSUMPTIONS.md`, `docs/discovery/FINDINGS.md`, `docs/validation-sql/`

This plan covers the six reports in the Report Spec plus the three "Data Analysis" pages. It does **not**
cover the Revenue Assessment / Receivable Analysis / Red Flag catalog already sketched in `PLAN.md` Phase 7 —
those become **Phase 7c** and are re-sequenced at the end of this document.

---

## 0. Decisions taken for this plan (J. Wilson, 2026-09-29)

| # | Decision | Effect |
|---|---|---|
| R-D1 | **Snapshot nightly + Refresh button.** Reports read a snapshot; a worker job refreshes it on a schedule, and a Refresh button on each page re-runs it. | Pages open in under a second even though four of the six source scripts take 40–120 s. Every page shows snapshot age. |
| R-D2 | **Current + previous term where the data supports it.** Reports keyed on `tblStudent.LastCleared` get a current/previous selector; reports that must read `VIEW_OURM_*` are current-term only and say so on screen. | Two reports (R2, R5) cover both terms, four do not. The inconsistency is visible and explained, not hidden. |
| R-D3 | **Export gate = `export.create` OR `mailmerge.create`; CSV and XLSX both.** | Operators and Admins export; Viewers need an explicit grant. A new XLSX writer is in scope (see §5.2). |
| R-D4 | **The three "Data Analysis" lines become three report-catalog pages**, with metrics proposed here for your sign-off. | Phase 7b. Scope is a proposal, not yet agreed — see §6. |
| R-D5 *(2026-09-29)* | **Classification: data-quality reports select on the raw class code and display both readings; operational and analytical views display the A-19 bucket.** | Closes R-Q2. R1 keeps its raw selection rule and gains a "Dashboard reports as" column; R6 displays the A-19 bucket with the raw code beside it. See §1.2. |
| R-D6 *(2026-09-29)* | **R5 reads the shipped DNR/DNC population, and the rows your script would include but the A-1 guard excludes are shown as a labelled group rather than dropped.** | Closes R-Q4. One population feeds the dashboard card and the letters; today the two return identical rows. See §1.3. |
| R-D2a *(2026-09-29)* | **R2 covers the current AND previous semester**, widening its `tblOUSA` join to `isCurrent = 1 OR wasCurrent = 1`. | Amends R-D2, which had placed R2 in the current-only group. R2 never reads `VIEW_OURM_*`, so the widening is sound. Each term keeps its own `SemesterBegins`, so the boundary chart and the what-if are rendered **per term** — no single date is the boundary for both populations, and R-D7's remedy now names which term's row to change. See §3. |
| R-D7 *(2026-09-29)* | **R2's anomaly is `cCode` ≠ derived `cClass`, and it is a warning rather than a defect** — one remedy is changing `SemesterBegins` in `tblOUSA`. | Closes R-Q3. The page leads with the `DateCreated` distribution around the boundary and a what-if on candidate dates, recommends rather than applies, and warns that the parameter is shared. See §1.4. |

---

## 1. What the six scripts actually do, and what has to change

Every script was read against `docs/discovery/FINDINGS.md`. Three problems recur and are handled once,
in §5, rather than per report.

| Report | Script | Source objects | Measured cost | Term scope |
|---|---|---|---|---|
| R1 Unclassified Students | `GetUnclassifiedStudents.sql` | `view_ourm_fca` ∪ `view_ourm_stats` | **120 s+** (FCA) | Current only |
| R2 Freshman Classification Analysis | `FreshmanWebCodeAnalysis.sql` | `tblStudent` + `jadi.dbo.student_master` + `tblOUSA` | Fast (indexed) | Current only (joins `isCurrent`) |
| R3 Cleared More Than Once | `StudentsClearedMoreThanOnce.sql` | `view_ourm_stats` | **41 s** | Current only |
| R4 Enrollee Account Balance | `fcaAccountBalanceMailMerge.sql` | `view_ourm_fca` | **120 s+** | Current only |
| R5 DNC/DNR Collection Mail Merge | `DNC_DNR_CollectionMailMerge.sql` | `tblStudent` + `tblOUSA` | Fast | Current **and** previous |
| R6 Currently Cleared | `CurrentlyCleared.sql` | `view_ourm_stats` + `tblStudent` | **41 s** | Current only |

### 1.1 Per-report notes

**R1 — Unclassified Students.** The script unions the enrolled population (FCA) and the cleared population
(STATS), keeps codes outside the known list, and dedups by `idnumber` preferring the FCA row.

**The subject of this report is the unknown classification, not the student's clearance state**
(J. Wilson, 2026-09-29). Two consequences:

- The `[status]` quirk — the FCA branch carries a real status, the STATS branch hard-codes `'Cleared'` — is
  no longer a question to settle. Status is incidental context, reproduced as the script has it, and is not
  a figure anyone should reconcile against the dashboard. The column is kept but demoted, and the page says
  it is not authoritative.
- The union of the two populations is plumbing: it exists so a bad class code is caught whether the student
  is currently registered, currently cleared, or both. `source_priority` only decides which row wins; it is
  not a fact about the student and is not displayed.

This also settles what the A-19 column is *for* — see §1.2 and the two-part layout in §4.2.

**R2 — Freshman Classification Analysis.** Already fast; no rewrite needed beyond removing `FORMAT()`. The
**The anomaly is `tblStudent.cCode` ≠ the derived `cClass`**, where `cClass` = FF when
`student_master.DateCreated > tblOUSA.SemesterBegins`, else FR (J. Wilson, 2026-09-29). `WebCode`
(`TEL_WEB_GRP_CDE`) is context, not part of the rule.

**It is a warning, not a defect** — one remedy is to change `SemesterBegins` in `tblOUSA`, so a mismatch may
mean the boundary date is wrong rather than the student record. That distinction drives the page design;
see §1.4.

**Current and previous semester** (J. Wilson, 2026-09-29): the `tblOUSA` join is
`isCurrent = 1 OR wasCurrent = 1`, not `isCurrent = 1` (**R-D2a**). `SemesterBegins` is a per-term column, so
the two terms have two different boundaries and a student's `cClass` is derived against the boundary of the
term they matched through `LastCleared`. The page therefore renders **one boundary chart and one what-if per
term**, each labelled with its semester, and the what-if names which term's `SemesterBegins` it is pricing —
moving the current term's start date does not change the previous term's mismatch count. The `TEL_WEB_GRP_CDE` legend in the script's comment block is seeded into
`Setting.webGroupCodeLabels` and rendered as a label, not a bare number.

**R3 — Cleared More Than Once.** `view_ourm_stats.[rows] > 1` is the same dedup key the hero card uses;
`VIEW_OURM_CLEARED` grouped by `ID_NUMBER` having `COUNT(*) > 1` gives the identical population in ~0.0 s
(FINDINGS §8.6c). Seven students on staging. One row per **action**, so a student appears twice — that is the
point of the report, and the table groups visually by student with the action count in the header row.

**R4 — Enrollee Account Balance.** The `between ? and ?` ODBC placeholders become named parameters
`@minBalance` / `@maxBalance` with a zod-validated form on the page. Balance source is FCA's
`accountbalance`, which FINDINGS §2 confirms is `tblStudent.AccountBalance` (`money`) — consistent with
**A-18**, so no reconciliation footnote is needed. `[status] != 'Cleared'` is
`ISNULL(ClearedCurrentSession, 0) = 0`.

**R5 — DNC/DNR Collection Mail Merge.** This overlaps the shipped DNR/DNC Analysis page. Two differences
from the signed **A-1** rule: the script has **no `NOT EXISTS (VIEW_OURM)` enrollment guard** on the DNR leg,
and it returns no category column, so a row's DNC-vs-DNR status is not visible in the output. The guard
returned 0 violations on staging, so the populations agree today — but they are not guaranteed to. **The plan
does not build a seventh population.** R5 becomes a saved preset of the existing `getDnrDncPopulation`
service, adding the `Category` and `LastCleared` columns the script implies, with the guard-excluded rows
shown as a labelled group (**R-D6**, §1.3). The `USE [ousadb];` statement is dropped — connection-pooled
sessions must not switch database.

**R6 — Currently Cleared.** The script selects `[class]` **twice** — a copy/paste duplicate that would produce
two identical columns; the report shows it once. `[class]` here is the raw `CURRENT_CLASS_CDE` from STATS,
**not** the A-19 bucket, so a transfer student shows as `JR` on this report and as Transfer Student on the
dashboard. Resolved by **R-D5** (§1.2): R6 is an operational roster, so it displays the A-19 bucket and
agrees with the dashboard. Population is ~1,021 rows on staging, within the print cap.

### 1.2 Reconciling classification (R-D5)

R1 and R6 disagree with the dashboard for the same reason but must be fixed in opposite directions, because
the two reports are for different things.

**R1 is a data-quality report** — its subject is the unknown classification itself. Its job is to surface
records someone needs to go and fix in the source. Applying A-19 to its selection would *hide* defects: a
student with a blank `cCode` but `TEL_WEB_GRP_CDE = 22` would drop off the list while their class code is
still unset. So R1 keeps the **raw code as the selection rule** — every defective record is listed.

The A-19 column is then not a cross-reference curiosity but a **triage signal**, which is what makes it
worth its width. It splits the list in two:

| Group | Meaning | What to do with it |
|---|---|---|
| **Resolvable** | Class code is missing or unrecognised, but `TEL_WEB_GRP_CDE` gives a usable reading (today: 22 → Transfer Student) | The correct classification is already in the data; the source record just needs it set |
| **No signal** | Neither the class code nor the web group code says anything usable | Needs a human lookup — registrar, admissions, or the student record itself |

The column heading is therefore **"Resolvable as"**, not "Dashboard reports as". Same value, but it tells
the person reading the report what to do next rather than only where the two screens differ.

**R6 is an operational roster.** People read it beside the dashboard, so it must agree with it. Class
displays the **A-19 bucket**, with the raw `CURRENT_CLASS_CDE` in a secondary column for anyone tracing a
figure back to the view.

**The rule, stated once so report seven does not reopen it:** *data-quality reports select on raw codes and
display both readings; operational and analytical views display the A-19 bucket.* R2 belongs to the first
group — it is already a `cCode`-versus-`TEL_WEB_GRP_CDE` audit — so R1 and R2 together form the
classification data-quality pair, and the ~126 transfer students stop being a discrepancy between two screens
and become the thing those two reports exist to measure.

Cost: one extra column on each of R1 and R6, and `breakdownCode()` reused rather than reimplemented.

### 1.3 Reconciling the DNC/DNR population (R-D6)

The supplied script and the shipped A-1 rule differ by exactly one predicate. The script's `EXISTS` over
`tblOUSA` is A-1's two legs unioned; the application adds `NOT EXISTS (VIEW_OURM)` to the DNR leg. The
script's population is therefore the application's population **plus** any DNR-flagged student who is in fact
currently enrolled — a strict superset, which means one query serves both readings:

```
Report R5  =  getDnrDncPopulation()            ← the A-1 population, category + last-cleared columns
              + a labelled group at the foot:
                "N students match the DNR rule but are currently enrolled — excluded from the mail merge"
```

Nothing is silently dropped and nothing is silently included. On staging N = 0, so R5 returns exactly the
rows your script returns. If N ever becomes non-zero, the report says so on the day it happens rather than
the letters and the dashboard card quietly disagreeing about who owes money — which is the failure this is
guarding against. The guard count is already computed by `dnrDncSummary` (`dnrGuardViolations`), so this
costs a footer row, not a query.

### 1.4 R2 is a warning, and the remedy is a parameter (R-D7)

The mismatch rule is `tblStudent.cCode ≠ cClass`, where `cClass` is derived from one date:
`student_master.DateCreated > tblOUSA.SemesterBegins` → FF, else FR.

Because the derivation hangs on `SemesterBegins`, a mismatch has two quite different causes, and the report
has to help tell them apart rather than just count them:

| Shape of the result | What it means | Remedy |
|---|---|---|
| Mismatches **cluster** around `SemesterBegins` | The boundary date is in the wrong place — these students were created days either side of a line that does not reflect when the intake actually started | Change `SemesterBegins` for the term |
| Mismatches are **scattered** across the date range | Individual records are coded FF or FR against the facts | Correct the student records |

A count alone cannot distinguish those, so the report leads with the **distribution of `DateCreated` around
`SemesterBegins`** — a simple dated bar of record-creation counts with the boundary drawn on it, mismatches
shaded. Sixty mismatches all sitting in the week before the line is a picture that reads instantly; the same
sixty spread over four months is a different problem with the same number.

That makes the **what-if** cheap and worth having: `DateCreated` is already in the result set, so recomputing
`cClass` at a candidate boundary is arithmetic, not a query. The page offers *"if SemesterBegins were
2026-08-14, mismatches would fall from 47 to 3"* against a few candidate dates. It is the single most useful
thing the report can say, and it costs a loop.

**The application cannot apply the remedy.** Per **A-20** the legacy C# JADI setup site owns `tblOUSA`; this
app reads it and never writes it. So the page **recommends a date and names where it is changed** — it does
not offer a button. It also warns that `SemesterBegins` is read elsewhere (historical academic-year pairing,
term metadata), so a change made to quiet this report has effects beyond it. That warning matters more than
the recommendation: without it the report invites someone to tune a shared parameter until one page looks
tidy.

Severity language throughout is **warning**, never "error" or "defect" — R1's worklist framing does not
carry over, and R2 gets no resolvable/no-signal triage split.

---

## 2. How the snapshot model works for row-level reports (R-D1)

The existing snapshots hold **aggregates**. These reports are lists of named students, so storing the
snapshot the same way would put identified student data into `dash.Snapshot` — a new exposure that A-3 and
A-11 never contemplated.

**Proposed design: snapshot the keys, join the people fresh.**

```
Worker job (nightly + on Refresh)
   └─ runs the slow query ONCE  ──►  dash.ReportSnapshot { reportKey, capturedAt, jobRunId, rowCount }
                                     dash.ReportSnapshotRow { snapshotId, idnumber, <report-specific
                                                              derived values: class code, dateCleared,
                                                              clearedBy, source, actionCount > }

Page read (sub-second)
   └─ SELECT the snapshot rows  ──►  JOIN dbo.tblStudent ON idnumber   (indexed, fast, always current)
                                     for lastname, firstname, email, AccountBalance
```

Why this shape:

- The expensive part is the *view*, not the person lookup. `tblStudent` reads by `idnumber` are indexed and
  sub-second, so joining live costs nothing.
- Names, emails and **balances are never stale** — only the population membership is as old as the snapshot.
  For a collection mail merge that distinction matters: you never post a letter quoting last night's balance.
- The stored payload is an **ID list plus derived codes**. No names, no emails, no PID ever written to `dash`.
- Parameterised reports (R4's balance range) filter the joined result at read time, so one snapshot serves
  every parameter combination — the same "read the whole population once" discipline the DNR/DNC page uses,
  which is why its table, footer and export cannot disagree.

Retention: each refresh replaces the previous snapshot's rows; the header row is kept for the job history.
Snapshot reads are audited as `report.view` with the report key and row count, never the rows.

**Schedules** (all admin-editable in Administration → Refresh Schedules, same as the existing eight jobs):

| Job key | Report | Default cron | Rationale |
|---|---|---|---|
| `report.unclassified` | R1 | 02:15 daily | Slowest query; runs off-hours |
| `report.freshmanAnalysis` | R2 | every 4 h | Cheap; classification churns during registration |
| `report.clearedMoreThanOnce` | R3 | 02:35 daily | Small, audit-style report |
| `report.enrolleeBalance` | R4 | 02:45 daily | Slowest query |
| `report.currentlyCleared` | R6 | every 2 h during sprint, 02:55 otherwise | Actively watched while clearing |

R5 has no job — it reads the live DNR/DNC service, which is already fast.

**Refresh button.** Same pattern as the Clearance Breakdown card: any user with `dashboard.view` may trigger
it, it runs through the job pipeline (so locking and history apply), it is audited as `report.refresh`, and
it is rate-limited to one run per report per 10 minutes. The page shows "as of 02:15 today" and a stale
banner past the threshold.

---

## 3. Term scope (R-D2, amended by R-D2a)

| Report | Current | Previous | Why |
|---|---|---|---|
| R1 Unclassified | ✅ | ❌ | `VIEW_OURM_FCA` / `_STATS` are scoped to `tblOUSA.isCurrent = 1` |
| R2 Freshman Analysis | ✅ | ✅ | Joins `tblOUSA` on `isCurrent = 1 OR wasCurrent = 1`; reads no `VIEW_OURM_*` (R-D2a) |
| R3 Cleared More Than Once | ✅ | ❌ | `VIEW_OURM_CLEARED` is current-term only |
| R4 Enrollee Balance | ✅ | ❌ | `VIEW_OURM_FCA` |
| R5 DNC/DNR | ✅ | ✅ | Reads `tblStudent.LastCleared` against both `isCurrent` and `wasCurrent` rows |
| R6 Currently Cleared | ✅ | ❌ | `VIEW_OURM_STATS` |

Every current-only report carries a short line under its title: *"Current semester only. The clearance views
hold current-term registrations; earlier terms would need term-filtered access to the underlying Jenzabar
rows (open DBA question 8)."* A term selector that silently returns current-term data would be worse than no
selector.

This confirms FINDINGS §8.8 rather than contradicting it: the constraint is already known and already logged
with the DBA. If that access arrives, all six reports gain a full semester picker with no redesign — the
snapshot key already carries a term.

---

## 4. Page design

### 4.1 Reports catalog (`/reports`)

Replaces the Phase 7 placeholder. Cards grouped under two headings:

```
Current & Previous Semester Reports
┌ Unclassified Students ─────────┐ ┌ Freshman Classification ───────┐ ┌ Cleared More Than Once ────────┐
│ Accounts whose classification  │ │ FF/FR codes vs the Global      │ │ Students with more than one    │
│ is missing or unrecognised     │ │ Student Code in Student Master │ │ clearance action this term     │
│ 3 codes · 34 students · 02:15  │ │ 212 students · as of 04:00     │ │ 7 students · as of 02:35       │
│ Current semester only          │ │ Current semester only          │ │ Current semester only          │
└────────────────────────────────┘ └────────────────────────────────┘ └────────────────────────────────┘
┌ Enrollee Account Balance ──────┐ ┌ DNC/DNR Collection ────────────┐ ┌ Currently Cleared ─────────────┐
│ Not-cleared enrollees within a │ │ Debit balances that did not    │ │ Financially cleared students,  │
│ balance range                  │ │ clear or did not return        │ │ by classification              │
│ parameterised · as of 02:45    │ │ 184 students · live            │ │ 1,021 students · as of 02:55   │
│ Current semester only          │ │ Current + previous semester    │ │ Current semester only          │
└────────────────────────────────┘ └────────────────────────────────┘ └────────────────────────────────┘

Data Analysis                                                                          (Phase 7b — §6)
```

Counts on the cards come from the snapshot header, so the catalog costs one cheap query.

### 4.2 A report page

Every report page is the same shell, which is what makes six of them affordable:

```
┌ Unclassified Students ─────────────── population as of 02:15  [↻ Refresh] [🖨 Print] [⬇ CSV] [⬇ XLSX] ┐
│ Current semester only — see note                             Names and balances: live                 │
│ [ parameters, where the report has any ]                                     34 students              │
├───────────────────────────────────────────────────────────────────────────────────────────────────────┤
│  Class │ Student ID │ Last name │ First name │ Status  │ Balance │                                    │
│  ...sortable, paginated, server-rendered — the existing DataTable...                                  │
├───────────────────────────────────────────────────────────────────────────────────────────────────────┤
│  Total debit balance for these students: $48,221.10                                                   │
│  ⓘ How this report is built — source query, snapshot time, what is and is not included                │
└───────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

The header carries **two** timestamps, not one: the population is as old as the snapshot, the names and
balances joined to it are live (§2). Stamping the column groups separately stops the pair being read as a
single point-in-time truth — the risk noted in §9 — and costs nothing but the label.

A shared `<ReportPage>` server component takes a report definition (columns, parameters, permission, snapshot
key, footer totals) and renders header, parameter form, table, footer and the four buttons. Adding report
number seven is then a definition file, not a page.

Per-report specifics:

- **R1** — **two parts**, because the report's subject is the bad code rather than the student.

  *Part one, a summary by code* — the thing to raise. One row per unrecognised or missing class code:
  the code as stored (blank rendered `(blank)`), how many students carry it, and how many of those are
  resolvable from `TEL_WEB_GRP_CDE`. An unrecognised code that is not blank means someone has added a
  class code to the source that the mapping table has never heard of — a single new code affecting 40
  students is one fix, and a student-by-student list buries that.

  ```
  Unrecognised class codes                                            34 students · 3 codes
  ┌──────────┬──────────┬─────────────┬──────────────────────────────────────────────┐
  │ Code     │ Students │ Resolvable  │                                              │
  ├──────────┼──────────┼─────────────┼──────────────────────────────────────────────┤
  │ (blank)  │       21 │          14 │ 7 need a lookup                              │
  │ PS       │       11 │           0 │ not in the classification mapping table ⚠    │
  │ NM       │        2 │           0 │ not in the classification mapping table ⚠    │
  └──────────┴──────────┴─────────────┴──────────────────────────────────────────────┘
  ```

  *Part two, the students* — class code (raw), ID, last, first, **Resolvable as**, status *(context only,
  not authoritative)*, balance. Default sort: no-signal rows first, then code, then last, first — worst
  first, since this is a worklist. Filter: all / resolvable / no signal.

  Footer: student count, count of distinct unrecognised codes, and the two group subtotals. The debit
  balance total is kept but is secondary here — it is not what the report is about.
- **R2** — leads with the **boundary panel**, not the table (§1.4): the term's `SemesterBegins`, a dated bar
  of `DateCreated` counts with the boundary drawn on it and mismatches shaded, the mismatch count, and the
  what-if line for two or three candidate dates. Below it: class code, ID, last, first, balance, web code
  (labelled), most recent year enrolled, current class code, date created, semester start, derived class,
  **mismatch** flagged as a warning. Toggle: *mismatches only*. Default sort date created, last, first, as
  the script has it — chronological, because the pattern in time is the finding.

  The panel carries the note that `SemesterBegins` lives in `tblOUSA`, is edited in the legacy JADI setup
  site rather than here (A-20), and is read by other parts of the application.
- **R3** — grouped by student: header row (ID, name, class, action count) with one line per clearance action
  (date cleared, cleared by, resolved operator name from `OperatorProfile` with effective dates).
- **R4** — parameters: min and max balance (required, min ≤ max, both ≥ 0, validated server-side). Preview
  count before the table renders. Footer: count and total.
- **R5** — the DNR/DNC population with `Category` and `Last cleared` columns and the mail-merge column set;
  the guard-excluded group in a labelled footer block (R-D6); links through to the full DNR/DNC Analysis
  page for filtering.
- **R6** — columns: class (A-19 bucket, per R-D5), raw class code, ID, last, first, date cleared, email.
  Default sort class, last, first.

### 4.3 Print

`PrintButton` already exists for a whole page; `PrintAllRowsButton` already pages the full population into a
print-only table with a 2,000-row cap. R6 at ~1,021 rows fits; R4 with a wide balance range may not. The cap
is raised to **5,000** for report pages with a page-count estimate shown before the dialog opens
("1,021 rows ≈ 23 pages — continue?"), because a silent truncation on a printed collection list is a
different kind of error from a truncated screen.

---

## 5. Cross-cutting work

### 5.1 The three recurring script problems

1. **`FORMAT()` in the SELECT** (R2, R6) — returns strings and defeats sorting and export typing. Removed;
   the provider returns `date` / `money` and `src/lib/format.ts` formats at the edge (Spec §15).
2. **`USE [ousadb];`** (R5) — dropped. Connections are pooled and already scoped by the connection string.
3. **`SELECT [class]` twice** (R6) — de-duplicated.

Each original script stays **verbatim** in `docs/validation-sql/reports/` as the reference, exactly as
`clearance_by_classification.sql` did, and each rewritten query gets an equivalence test that runs both
against staging and asserts identical ID sets. That test is the thing that makes a rewrite safe to trust.

### 5.2 XLSX writer (R-D3)

CSV is done. XLSX needs a new writer. Two routes:

- **`exceljs`** — mature, ~1 MB, handles styling and types. One new production dependency.
- **A ~150-line minimal writer** — `zlib` (built in) plus SheetML, in keeping with the dependency-free SVG
  charts already in the codebase. Types and column widths only, no styling.

Recommendation: **minimal writer**, because the export is a flat typed grid and the dependency surface of a
finance app reading production data is worth keeping small. Formula-injection neutralisation applies to XLSX
too — a cell starting `=` is written as a *string* cell, which is inert, rather than prefixed with an
apostrophe as in CSV. Decide in **R-Q6**.

Column set follows **A-11**: no PID, ever, in any format. Filenames follow the existing
`exportFilename()` convention: `unclassified-FA2026-20260929-1432.xlsx`.

### 5.3 Permissions and audit

- View a report: `dashboard.view`; report rows are student-level, so `student.view` is also required
  (a Viewer without a grant sees the catalog card and count, not the rows).
- Export: `export.create` **or** `mailmerge.create` (R-D3).
- Refresh: `dashboard.view`, rate-limited.
- New audit actions: `report.view`, `report.refresh`, `report.export` (report key, parameters, row count,
  format — never rows).

No new permission is introduced. If you would rather gate the catalog on its own `report.view` permission,
say so — it is a one-line change now and a migration later.

### 5.4 Files touched

```
new   src/server/reports/definitions.ts        one definition per report
new   src/server/reports/snapshot.ts           ReportSnapshot read/write, tblStudent join
new   src/server/services/reports.ts           per-report services + footer totals
new   src/server/repositories/mssql/report-sql.ts   fast equivalents, parameterised
new   src/components/reports/ReportPage.tsx    shared shell
new   src/app/(app)/reports/[key]/page.tsx     one route for all six
new   src/app/api/v1/reports/[key]/route.ts    + /export, + /refresh
new   src/server/services/xlsx.ts              minimal writer (pending R-Q6)
new   db/migrations/00X_reports.sql            dash.ReportSnapshot, dash.ReportSnapshotRow
edit  src/app/(app)/reports/page.tsx           placeholder → catalog
edit  src/server/jobs/definitions.ts           five new jobs
edit  src/server/authz/permissions.ts          (only if R-Q5 says yes)
edit  src/components/print/PrintAllRowsButton.tsx   cap 2,000 → 5,000 + page estimate
new   docs/validation-sql/reports/*.sql        the six scripts, verbatim
new   tests/integration/report-equivalence.test.ts  rewritten ≡ supplied, against staging
```

### 5.5 Sequence and sizing

| Step | Work | Est. |
|---|---|---|
| 7a.1 | Migration, snapshot store, job definitions, shared `ReportPage`, catalog | 3 d |
| 7a.2 | R2 and R5 (no rewrite needed — proves the shell end to end) | 1.5 d |
| 7a.3 | R3 and R6 (fast equivalents over `VIEW_OURM_CLEARED`) | 2 d |
| 7a.4 | R1 and R4 (fast equivalents over `VIEW_OURM`, parameter form) | 2.5 d |
| 7a.5 | XLSX writer, print cap, equivalence tests against staging | 2 d |
| | **Phase 7a total** | **≈ 11 days** |

7a.2 first is deliberate: the two reports that need no SQL rewrite prove the catalog, snapshot, print and
export path before any query is re-derived.

---

## 6. Phase 7b — the three Data Analysis pages (R-D4)

The Report Spec gives three lines with no detail. Here is what I propose each becomes; none of it is agreed.

**A1 — Current vs Previous Semester.** Side-by-side comparison of the two terms `tblOUSA` flags, on the
metrics that exist for both: census, financially cleared, clearance rate, debit balance total and student
count, DNC/DNR counts and balances, and the classification breakdown. Both terms' figures come from
`tblOUSA.census` / `FinanciallyCleared` (the official nightly figures, per A-2) with the current term also
showing the app's fresher snapshot, labelled. Delta column and a percentage-point change on the rate.
*Buildable today* — no new source access.

**A2 — Specific Semester.** The same metric set as A1 for any single term chosen from `tblOUSA`'s 28 rows.
Honest limits: for a past term only the nightly `census` / `FinanciallyCleared` and the `LastCleared`-derived
receivables exist. Per-student detail, clearance dates and operator attribution do **not** exist for past
terms (FINDINGS §8.8), so the page shows aggregates and a clear note rather than empty tables.
*Buildable today, with a visibly reduced metric set for past terms.*

**A3 — All Receivables.** Global debit balance across every term, which is Phase 4's §9.3 view with the
report treatment added: aging buckets (pending **A-6**), the never-cleared `XX0000` bucket, excluded summer
terms as a reconciliation line (A-23), credit balances as a demoted secondary figure never netted (A-5), and
CSV/XLSX export. Largely a re-presentation of shipped work — the new part is aging, which is blocked on A-6.

Est. ≈ 6 days for all three once scoped, A3 partly blocked on **A-6**.

## 7. Re-sequenced Phase 7

| Was | Now | Scope |
|---|---|---|
| Phase 7 | **7a** | The six Report Spec reports + catalog + XLSX (this plan) |
| — | **7b** | The three Data Analysis pages (§6) |
| Phase 7 | **7c** | Mail-merge criteria builder, Revenue Assessment (blocked on **A-8**), Receivable Analysis, Red Flag (blocked on **A-9**) |

7a and 7b are unblocked. 7c is not: Revenue Assessment needs the `fn_CostAnalysis` projection question
answered and Red Flag needs its thresholds. Putting the six concrete reports first gets working reports in
front of users while those two stay open.

---

## 7a. Implementation status (2026-09-29)

Built and passing `npm run typecheck` and `npm run lint`. **Not yet executed** — see the caveat below.

Three things were built differently from this plan, each for a reason worth keeping:

**No new tables.** §2 proposed `dash.ReportSnapshot` / `dash.ReportSnapshotRow`. `dash.Snapshot`
already stores an `nvarchar(max)` JSON payload with a job run, a term key and a row count, so the
report populations go there as new metric families instead. That reuses the job pipeline, the lock,
the run history and the Administration → Refresh Schedules screen for free, and removes a migration.
What it does not give for free is retention, so `AppStore.pruneSnapshots(family, keep)` was added
and the runner calls it after a successful capture of any student-level family — a report refresh
replaces the previous population rather than leaving copies of it at rest in `dash` (A-30). The
`payload` comment in `001_init.sql` was corrected, since it claimed no student rows.

**Exports stay on `export.create`.** §5.3 proposed a `report.export` audit action. `report.view` and
`report.refresh` were added, but exports keep the existing action so there is one export log to read
rather than two — the same call `PLAN.md` §4 made for `ExportLog`.

**Report tables are not paginated.** Print has to capture the whole list, and a paged table prints
one page of it. Every row is therefore in the DOM, with a 5,000-row render cap that says so on
screen when it bites. `PRINT_ROW_CAP` rose from 2,000 to 5,000 as planned.

### Where things live

| | |
|---|---|
| Fast SQL | `src/server/repositories/mssql/report-sql.ts` |
| Catalog and jobs | `src/server/reports/definitions.ts` (jobs are generated from it) |
| Snapshot read/write, live join | `src/server/reports/snapshot.ts` |
| Per-report logic | `src/server/services/reports.ts` |
| Rows for page and export | `src/server/reports/views.ts` (one function, so they cannot diverge) |
| Export | `src/server/services/report-export.ts`, `xlsx.ts` (exceljs, A-31) |
| Pages | `src/app/(app)/reports/page.tsx`, `[key]/page.tsx`, `src/components/reports/*` |
| Routes | `src/app/api/v1/reports/[key]/{route,export,refresh}.ts` |
| Originals | `docs/validation-sql/reports/` + README on every deviation |
| Tests | `tests/unit/report-sql.test.ts`, `tests/integration/reports.test.ts`, `report-equivalence.test.ts` |

### Before this can be trusted

1. `npm install` on the workstation — `exceljs` is in `package.json` but the lockfile was not
   updated (the install ran from the Linux side and timed out).
2. `npm test` — nothing here has executed. The session's Linux VM cannot run vitest against a
   Windows `node_modules`, so every line was typechecked and linted but never run.
3. `npm run test:staging` with `OUSADB_CONNECTION_STRING` set — `report-equivalence.test.ts` runs
   the supplied scripts and the rewrites side by side and asserts the ID sets match. **Until this
   passes, the four rewritten reports are unverified**, and that test is the only thing standing
   between a fast query and a wrong one.
4. Capture each report once from Administration → Refresh Schedules, or wait for the overnight run.

A defect already found this way: `MOST_RECNT_YR_ENR` is numeric in `student_master`, and the
provider called `.trim()` on it. Typecheck could not catch it, because the raw row type was a
hand-written declaration rather than anything derived from the schema. Assume there are more of
these in the four queries that have never met real data.

## 8. Open questions

| # | Question | Why it matters | Answer |
|---|---|---|---|
| **R-Q1** | These snapshots hold student **ID lists** in `dash` (§2) — no names, emails or PID, and balances are always read live. Is that acceptable, or should the reports re-query on demand and accept the 40–120 s wait? | First time `dash` stores anything student-identifying, even as bare IDs. A-3 and A-11 did not cover it. | ______ |
| **R-Q2** ✅ | R1 and R6 report the **raw class code**, so a `TEL_WEB_GRP_CDE = 22` student reads as `JR` on the report and as Transfer Student on the dashboard (A-19). | ~126 students on staging. Two screens disagreeing about a student's classification is the kind of thing that erodes trust in the whole dashboard. | **Closed 2026-09-29 by R-D5** — data-quality reports select on raw and show both; operational views show the A-19 bucket (§1.2). |
| **R-Q3** ✅ | R2 — what exactly is the **exception** you are looking for? | Decides the Mismatch column and the whole shape of the page. | **Closed 2026-09-29 by R-D7** — the anomaly is `cCode` ≠ derived `cClass`; it is a **warning**, since one remedy is changing `SemesterBegins` in `tblOUSA` (§1.4). |
| **R-Q4** ✅ | R5 — confirm it should be a **preset of the existing DNR/DNC population** (which adds the A-1 enrollment guard your script omits) rather than a separate query. | If the two ever diverge, the collection letters and the dashboard card would disagree about who owes money. | **Closed 2026-09-29 by R-D6** — one population, guard-excluded rows shown as a labelled group (§1.3). |
| **R-Q5** | Should the catalog get its own **`report.view`** permission, or is `dashboard.view` + `student.view` right? | Cheap now, a migration later. | ______ |
| **R-Q6** | XLSX: **minimal in-house writer** (recommended) or add `exceljs`? | One production dependency vs ~150 lines to maintain. | ______ |
| **R-Q7** | R4 — sensible **default balance range** for the form, and should $0.01–$999,999 be allowed, or is there a floor below which you never send a letter? | Affects the default view and the print page count. | ______ |
| **R-Q8** | "Send to Printer" — is the browser print dialog with a print stylesheet sufficient, or do you need a **server-generated PDF** (fixed pagination, header/footer on every page, archivable)? | The former is shipped; the latter is roughly 3 extra days and a PDF library. | ______ |
| **R-Q9** | Retention: should a **refreshed snapshot replace** the previous one (proposed), or do you need the history — "who was unclassified on 15 September"? | History means unbounded growth of student-ID rows in `dash` and a retention policy. | ______ |
| **R-Q11** | R1 scopes to students who are **currently enrolled or currently cleared** — that is what the two views hold. Is that the right population for a data-quality report, or do you want *any* active student record with an unrecognised class code, including those with no current-term activity? | `tblStudent` has 39,361 rows against ~1,200 current. The wider reading would catch codes that are wrong on dormant records before those students re-enrol, but it is a different and much larger query — and most of those rows are years stale. | ______ |
| **R-Q12** | When R1 finds an unrecognised code (not blank — a code like `PS` that simply is not in the mapping table), should the report offer an **"add to classification mapping"** link into Administration → Metadata? | Turns the report from a list into a fix. Half a day; only worth it if you would actually add the code rather than correct the student record. | ______ |
| **R-Q10** | R6 returns ~1,021 rows with no filter. Want **classification and date-cleared filters** on it, or is the full list with sorting enough? | Affects whether it reuses the DNR/DNC filter bar. | ______ |

---

## 9. Risks

- **The fast equivalents are the whole plan.** Four reports depend on reproducing a slow view's population
  from underlying objects. This worked for the Clearance Breakdown, and the equivalence test is the control —
  but if one of them cannot be proven equal on staging, that report falls back to the slow query on a nightly
  job with no Refresh button, and the page says so.
- **Staging is not isolated from production** (FINDINGS §7). None of these six reports touch
  `VIEW_OURM_ACAD`, so none cross the linked server. Worth restating because the report phase is when
  someone will ask for a GPA column.
- **R2 invites someone to tune a shared parameter.** `SemesterBegins` is read by term metadata and the
  historical academic-year pairing, not only by this report. The page recommends a date and says where it is
  changed (A-20: the legacy setup site owns `tblOUSA`); it must never present the change as local to R2.
- **Five new nightly jobs** run against `ousadb` in the 02:00–03:00 window, two of them 2-minute queries.
  Confirm with the DBA that this does not collide with the 21:00 SQL Agent job or a backup window.
- **A snapshot's population can be hours old while the balance beside it is live.** That is deliberate (§2)
  and is handled by the two-timestamp header in §4.2 — but it stays on this list, because the first person
  to build report seven will be tempted to print one date at the top of the page.
