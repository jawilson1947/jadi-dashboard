# Historical Analysis Plan — Phase 4

Status: **Implemented 2026-09-18** (H1–H5; verification of historical figures pending a staging run) · Spec §9 (§9.1–§9.4), §5, §11, §19 · Follows Phase 3 (Clearance Sprint) and 3b (DNR/DNC + export core)
Decisions this builds on: A-2 (nightly `tblOUSA` figures are the official historical numbers), A-16 (term keys), A-20 (`tblOUSA` is read-through), A-22 (`LastCleared` resolves to a semester), A-11 (export columns)
Decisions taken 2026-09-18 (J. Wilson): **A-5** (negative balances are not a business metric; secondary figure labelled "Credit balances", never "payments"), **A-18** (`tblStudent.AccountBalance` is authoritative — the last 🔴 on the board is cleared), **A-23** (summer terms omitted from historical analysis)

---

## 1. The good news from discovery

Phase 4 is mostly **arithmetic over metadata the institution already keeps**, not new extraction:

- `tblOUSA` already stores `census` and `FinanciallyCleared` per semester **back to Spring 2015** (28 rows, FINDINGS §3). §9.1 needs no student-level query at all — it reads the same table the app already snapshots nightly as `metadata.terms`.
- Those are the same nightly figures A-2 designated as the official historical numbers and that the sprint's Compare tab already benchmarks against, so §9.1 and §7.4 agree by construction rather than by coincidence.
- §9.2 is two aggregates over `tblStudent` (staging: 2,190 positive = $12.36M; 6,669 negative = −$7.49M; 30,502 zero — FINDINGS §4).
- §9.3 is the `LastCleared` → `tblOUSA` join Jim identified (A-22), grouped by term.

None of it touches `VIEW_OURM_FCA`, `VIEW_OURM_STATS`, `VIEW_OURM_ACAD` or a linked server. Phase 4 should be the cheapest phase yet in query cost.

## 2. What has to be built

### H1 — Semester resolver (A-22, deferred here from Phase 3)

`src/server/metadata/semesters.ts`: a registry built from the `terms` snapshot that maps any term code — Traditional or LEAP — to its semester: display name, academic year, begins/ends, drop date, nightly census and cleared figures, and whether it is the current or previous term. `'XX0000'` and any code with no matching row resolve to an explicit **Unmatched** bucket that is shown, never dropped.

Immediate uses: the DNR/DNC table's "last cleared" column stops showing raw `FA2025`; §9.3 gets its grouping key; Phase 5's student profile inherits it.

### H2 — §9.1 Enrolled vs. Financially Cleared

Two full-record trend charts at the top of the page — **Census, every semester on record** and **Financially cleared, every semester on record** — running from the first captured semester to the current one. They deliberately ignore the range picker: the request was the whole history, and each carries a collapsible table of its own figures so the numbers are readable, not just the shape.

Below them, the academic-year view: Fall YYYY paired with the following Spring, a range picker, Fall/Spring census and cleared with clearance percentages, and a grouped-column ⇄ line toggle over one companion table. Extends the Phase 3 SVG chart kit with a grouped-column mark; no new dependency.

A semester with no captured figure is left out of the trend and shown as "—" in the table, never as a zero: no term in this institution's history had nobody enrolled, so a zero point would read as fact when it is absence of data.

### H3 — §9.2 Global receivables

Global Receivables — the sum of positive `tblStudent.AccountBalance` (A-18) — is the headline figure, with the number of students carrying a balance. The negative total is present but demoted: a secondary line labelled **Credit balances** (A-5), never "payments", never netted against receivables. Nothing in the application subtracts credits from what is owed.

### H4 — §9.3 Receivables by semester

Positive balances grouped by the term each student's `LastCleared` points at, with a semester ⇄ school-year toggle, a trend chart, a sortable table, and CSV export through the Phase 3b export core. Aggregate rows only — no student data leaves this screen, so it needs `history.view` rather than `student.view`.

Summer terms are omitted from the chart and table (A-23). Because dropping a term would otherwise drop money, the table carries two reconciliation lines below the total — **Excluded terms** (summer) and **Unmatched** (`XX0000` and codes with no `tblOUSA` row) — so the semester figures plus those two lines always equal the Global Receivables figure from H3. A chart that doesn't reconcile to the headline number is how people stop trusting a dashboard.

### H5 — §9.4 Snapshot discipline

Three new daily jobs (`history.enrollmentClearance`, `history.globalBalances`, `history.receivablesBySemester`) writing their own snapshot families, plus the snapshot picker the wireframe calls for: job ID, source timestamp, completion timestamp, row counts. The point of §9.4 is that **a trend chart must not silently change retroactively** — with snapshots, a figure that moves is traceable to a run.

## 3. Data sources, exactly

| Screen | Source | Cost |
|---|---|---|
| §9.1 Enrolled vs cleared | `tblOUSA.census` / `FinanciallyCleared` per row, paired by `SemesterName` | metadata read, already snapshotted |
| §9.2 Global receivables | `SUM(AccountBalance)` where `> 0` over `tblStudent` | single indexed scan |
| §9.2 Global credits | `ABS(SUM(AccountBalance))` where `< 0` | same scan |
| §9.3 Receivables by semester | `tblStudent.AccountBalance > 0` grouped by `LastCleared`, joined to `tblOUSA` on `JADI_TradName` / `JADI_LeapName` (A-22) | single scan + 28-row join |

## 4. Additions to the API contract (PLAN §5)

| Method & path | Permission | Returns |
|---|---|---|
| `GET /api/v1/history/enrollment-clearance?from=&to=` | history.view | per academic year: fallCensus, springCensus, fallCleared, springCleared, percentages, unmatched terms |
| `GET /api/v1/history/balances` | history.view | globalPositive, globalNegative, studentCounts, configured labels |
| `GET /api/v1/history/receivables?groupBy=semester\|schoolYear` | history.view | rows {termKey, semesterName, academicYear, students, positiveBalance}, unmatched bucket, grand total |
| `POST /api/v1/history/receivables/export` | history.view + export.create | CSV of the aggregate rows, audited |

## 5. Phasing and acceptance

| Step | Exit criteria |
|---|---|
| H1 resolver | Every term code in `tblStudent.LastCleared` either resolves or lands in Unmatched; staging test asserts the Unmatched count and names the codes |
| H2 §9.1 | Academic-year rows reconcile with `tblOUSA` row by row; percentages use the divide-by-zero rule; chart and table carry identical numbers |
| H3 §9.2 | Totals match a direct `SUM` against staging; negative-balance card label comes from configuration, never hard-coded |
| H4 §9.3 | Semester totals sum to the global positive figure minus the Unmatched bucket; export ≡ on-screen rows |
| H5 §9.4 | Trends read snapshots; the picker shows job ID and both timestamps; re-running a job does not rewrite history, it adds a capture |

Acceptance 7 (Spec §21) is met when §9.1 and §9.3 reconcile against the validation SQL on staging.

## 6. Decisions taken, and what they mean in the build

| # | Decision (J. Wilson, 2026-09-18) | Consequence |
|---|---|---|
| A-23 | Summer terms are omitted — the volume is not significant | §9.1 pairs Fall + following Spring only. §9.3 leaves summer out of the chart and table but carries its balances in an "Excluded terms" line so totals still reconcile |
| A-5 | Negative balances are not a business metric | §9.2 leads with Global Receivables; the negative total is a secondary "Credit balances" line, never "payments", never netted against receivables |
| A-18 | `tblStudent.AccountBalance` is authoritative | Every money figure in the app comes from one column. The other two balance definitions appear only where the spec names them, always labelled with their source. The last 🔴 assumption is cleared |

## 7. Handed to Phase 8 (AI Analyses)

Trend *analysis* — what the census and clearance curves actually say — belongs to the AI phase (Spec §12), not to this one. Phase 4 produces the series; Phase 8 adds a **Historical trends** module that reads the captured `historyEnrollment` and `historyReceivables` snapshots and writes a labelled narrative: direction and size of the movement in census and in clearance rate, years that break the pattern, and how the receivable has tracked enrolment. It is aggregate-only by construction (no names, IDs or transactions leave the server), cites metric, period and snapshot ID like every other AI output, and stays dark until A-13 — model hosting and data-sharing approval — is signed.

## 8. Remaining verification

**Before H2 ships**: confirm on staging that `census` / `FinanciallyCleared` are populated for every historical `tblOUSA` row, not only recent ones. If older rows are null or zero, the range picker needs a documented "no figure captured" state rather than a zero line that reads as "nobody enrolled". A staging test asserts this and names any term missing a figure.
