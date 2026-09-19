# Discovery findings — staging `ousadb` (2026-09-17)

Source: `ousadb-discovery-2026-09-17_2215.md` (metadata + aggregates only). Staging holds **test data**; the server is SQL Server 2019 Developer Edition. Each finding notes which ASSUMPTIONS item or Spec section it affects.

## 1. Object names confirmed (Spec §15, A-4, Appendix A)

| Spec name | Actual object | Notes |
|---|---|---|
| `view_ourm_fca` | `dbo.VIEW_OURM_FCA` (20 cols) | Enrolled-student view. **Very slow** — see §6 below |
| `view_ourm_stats` | `dbo.VIEW_OURM_STATS` (13 cols) | Cleared students; `idnumber` is **bigint** here, varchar elsewhere |
| `view_ourm_charges` / `view_ourm_credits` | `dbo.VIEW_OURM_CHARGES` (`idnumber, Charges, dcd`) / `dbo.VIEW_OURM_CREDITS` (`idnumber, credits, dcd`) | One row per student, not a total; the app must `SUM()` |
| `VIEW_OURM_ACAD` vs `OURM_VIEW_ACAD` | **`dbo.VIEW_OURM_ACAD`** — A-4 name question resolved | Reads the **production** Jenzabar server through a linked server; see §7 |
| `tblStudent` | `dbo.tblStudent` (38 cols, 39,361 rows, `idnumber` unique) | Contains SSN, DOB, gender, bank account — must never be selected by the app |
| `tblOUSA` | `dbo.tblOUSA` (19 cols, 28 rows) | Richer than the spec implies — see §3 |
| `jenzabar_cloud.trans_hist` | `dbo.VIEW_OURM_TRANS_HIST` (local view over `[jadi].dbo.trans_hist`, current term only) and `dbo.tblFCA_TRANS_HIST` (frozen copy after drop date) | Payment profile source (§10.3) |

Additional objects not in the spec that matter: `VIEW_OURM_CLEARED` (clearance events with `DateCleared`, `USER_NAME`), `VIEW_OURM_CONTROL` (enrollment + clearance action per student), `VIEW_OURM_SEMESTER_HOURS`, `VIEW_LAST_SEMESTER` (2 cols — likely relevant to DNR, definition not yet captured), `VIEW_OUSA_CONSOLIDATED_BALANCES`, `tblFCA*` tables (worksheet data), `cashier`, `emailV`.

## 2. Column facts that change the plan

- **Classification** in `VIEW_OURM_FCA` is `cCode` (Jenzabar `CURRENT_CLASS_CDE`, defaults to `'XX'`), plus a descriptive `what` column derived from `TEL_WEB_GRP_CDE` (First-Time Freshman, Incoming Transfer, Leap Student, …). In `VIEW_OURM_STATS` the same code is called `Class`. There is no column named `classification`. → §7.3 mappings key on `cCode`; the `what` text is a useful cross-check for "Incoming Transfer".
- **Status** in FCA is `CASE tblStudent.ClearedCurrentSession WHEN 1 THEN 'Cleared' ELSE 'Not Cleared' END` — exactly two values; there is no "Pending". The mock provider's third status should be dropped.
- **PID** is `tblStudent.pid` (int) and FCA also exposes `PIN` = last 4 of SSN. The app must never select `PIN`, `SSN`, `dob`, `gender`, `BankAccount`.
- `AccountBalance` is `money` in tblStudent/FCA but `numeric(8,2)` in STATS (taken from Jenzabar `subsid_master.AR_BAL_TO_DTE`) — two different balance sources. **Which one is authoritative for the receivable cards is a business question (new item A-18).**
- `LastCleared` uses `tblOUSA.JADI_TradName` / `JADI_LeapName` codes: `FA2026`, `SP2026`, `LF2026` (LEAP Fall), `LS2026` (LEAP Spring), `SU`/`SL` for summer. `'XX0000'` (19,803 rows) is the never-cleared sentinel. → A-16 resolved: receivable terms for the current semester are `{JADI_TradName, JADI_LeapName}` of the `isCurrent` row, i.e. `FA2026` and `LF2026`.

## 3. `tblOUSA` is the semester-metadata table the plan wanted to build (§14.3, §9.1, §7)

Columns: `SemesterName`, `JADI_TradName`, `JADI_LeapName`, `EX_Trad_TRM_CDE`, `EX_Leap_TRM_CDE`, `Trad_ActionCode`, `Leap_ActionCode`, `JADI_YR_CDE`, `EX_YR_CDE`, `SemesterBegins`, `SemesterEnds`, **`isCurrent`**, **`wasCurrent`** (= previous term), **`census`**, **`FinanciallyCleared`**, `DropClassesDate`, `WorksheetFolder`, `FCW_Version`.

- Current term: Fall 2026 (`isCurrent=1`, census 1,186, FinanciallyCleared 1,012). Previous: Spring 2026 (`wasCurrent=1`). Exactly one of each — the validation rule in Spec §14.3 already holds.
- Historical census and financially-cleared totals per semester back to Spring 2015 are **already stored here** → Historical Analysis §9.1 can be built from `tblOUSA` directly, with Fall/Spring pairing by `SemesterName`.
- `WorksheetFolder` gives the clearance-worksheet location per semester (`W:\2026 Fall\Worksheets`; older terms use UNC paths) → answers DBA question Q4 in ASSUMPTIONS; the worksheet endpoint (§10.5) reads from that folder with the drive mapping resolved server-side.
- `DropClassesDate` controls a switch inside the charges/credits views (below).
- Summer terms exist (`SU2025`/`SL2025`); the academic-year rule should assign them explicitly.

**Decision for Phase 2:** the app's `Semester` table should mirror/sync from `tblOUSA` rather than replace it, and the legacy C# JADI setup site (§14.4) is almost certainly the editor for this table.

## 4. Counts observed (test data)

| Measure | Value | Source |
|---|---|---|
| Cleared (STATS, rows = 1) | 1,021 rows = 1,021 distinct | confirms `[rows]=1` dedup is needed: 7 students have 2 `items` rows |
| Not cleared (FCA, Status <> 'Cleared') | 192 | |
| Enrolled (FCA count) | **timed out** (> 120 s) | see §6 |
| tblOUSA census / cleared for Fall 2026 | 1,186 / 1,012 | manually maintained figures |
| `LastCleared = 'FA2026'` | 1,153 | differs from STATS 1,021 and tblOUSA 1,012 — **three different "cleared" figures; owner must pick the source of truth (A-1/A-2)** |
| tblStudent balances | 2,190 positive = $12.36M; 6,669 negative = −$7.49M; 30,502 zero | §9.2 global figures |
| ClearedBy codes | HSMITH 291, **sa 280**, DSHARPE 240, KCLARK 163, GCALDWELL 37, KJOSEPH 17 | `sa` = automatic clearance (§10.5); seed for Operator Profiles |
| Charges / credits view rows | 1,108 / 677 | |

## 5. How charges and credits are actually defined (§6.3)

`VIEW_OURM_CHARGES` = `SUM(TRANS_AMT)` where `SOURCE_CDE = '@C'`; `VIEW_OURM_CREDITS` = `SUM(ABS(TRANS_AMT))` where `SOURCE_CDE = '@F'` **or** (`SUBSID_TRANS_STS = 'S'` and `TRANS_DESC LIKE '%*%'`). Before `DropClassesDate` they read live Jenzabar `trans_hist`; after it they read the frozen `tblFCA_TRANS_HIST` copy (`dcd` = 'yes'). This directly answers A-7's "which transaction categories" for *credits* and gives the app a documented rule to cite; it also means charges/credits change semantics on the drop date, which the UI should label.

## 6. Performance: the FCA view cannot be queried per page load (§19)

`VIEW_OURM_FCA` calls the scalar function `dbo.fn_CostAnalysis` five times per row and joins three nested views, each of which re-joins `tblOUSA` and Jenzabar tables. A plain `COUNT(*)` exceeded 120 s on staging. Consequences:

1. The Phase 2 snapshot worker is not an optimization — it is required. Dashboard reads come from `Snapshot` rows only.
2. The mssql provider should compute enrolled/cleared/not-cleared from the **underlying** objects (`VIEW_OURM` for enrollment, `tblStudent.ClearedCurrentSession`, `VIEW_OURM_STATS`) rather than through FCA, and use FCA only for the drill-down columns it uniquely provides (`needed`, `amtdue`, `eighty`).
3. Ask the DBA whether `fn_CostAnalysis` can be inlined or the FCA result materialized on a schedule (indexed view or ETL table).

## 7. Risks to raise

- **Staging is not isolated from production.** `VIEW_OURM_ACAD` joins `[172.18.96.11,1433\MSSQL].[TMSEPRD]` — a linked server to what appears to be the production Jenzabar instance. Querying ACAD on staging touches production. The academic module (§10.4) must not be tested against staging until the DBA confirms that linked server points at a non-production copy.
- The other `VIEW_OURM_*` views use a co-located database `[jadi]` (a Jenzabar subset) rather than the linked server; the app's read-only login needs `SELECT` on `jadi` as well as `ousadb`.
- The discovery login (`DataOps`) is not read-only; `jadi_readonly` still needs creating for Phase 6.
- `VIEW_OURM_STATS.idnumber` is bigint while every other object uses varchar; joins must cast consistently or they will scan.

## 8. Second pass (`ousadb-discovery-2026-09-17_2225.md`) — additional findings

### 8.1 Four different "cleared" figures exist for the same term (A-1, A-2 — decision required)

| Figure | Value | Definition |
|---|---|---|
| `VIEW_OURM` enrolled | **1,188** distinct | students in `jadi.stud_term_sum_div` for the current term (fast query, < 1 s) |
| `tblStudent.ClearedCurrentSession = 1` within enrolled | **996** | what `VIEW_OURM_FCA.Status = 'Cleared'` is based on |
| `VIEW_OURM_FCA.Status <> 'Cleared'` | 192 | 1,188 − 996 = 192 ✔ consistent with the flag |
| `VIEW_OURM_STATS` rows = 1 | **1,021** | students with a clearance `items` action for the current term (7 students have 2 actions) |
| `tblOUSA.FinanciallyCleared` | **1,012** | manually maintained figure |
| `tblStudent.LastCleared = 'FA2026'` | 1,153 | includes students no longer enrolled or cleared then reversed? |

The spec's hero card mixes sources: Enrolled from FCA (1,188), Cleared from STATS (1,021), Not Cleared from FCA (192). With those sources 1,021 + 192 = 1,213 ≠ 1,188, so **Appendix B's warning is real on this data**: the cleared population (clearance *events*) is not a subset of the enrolled population (term registrations). 25+ students have a clearance action but no current-term registration row (or the reverse). The business owner must choose: (a) show STATS-cleared and FCA-not-cleared as the spec says and label the discrepancy, or (b) derive all three from one universe (`VIEW_OURM` + `ClearedCurrentSession`). The app will surface the reconciliation count either way.

### 8.2 Classification: `TEL_WEB_GRP_CDE` is not a classification (Sec.7.3, A-19)

Cross-tab of `cCode` × `TEL_WEB_GRP_CDE` shows code 21 ("Incoming First-time Freshmen") attached to seniors, juniors and sophomores — it is a web-portal group, not class standing. Therefore:
- Classification = `cCode` / `Class` (`FR, FF, SO, JR, SR, GR, AE, AD, EM, DI, XX, blank`). Observed codes match the spec's mapping list exactly, except **no `TR` code exists**.
- "Incoming Transfer" is `TEL_WEB_GRP_CDE = 22` (≈126 enrolled students carrying FR/FF/SO/JR/SR class codes). The spec's rule "treat Incoming Transfer as TR before combining FF/FR as Freshmen" must therefore be implemented as: *if TEL_WEB_GRP_CDE = 22 then Transfer Student, else map cCode*. The Classification Mapping table needs an override column or a second mapping table for group codes. Owner confirmation needed (new item A-19).

### 8.3 Clearance sprint shape (Sec.7)

Clearance dates for Fall 2026 run 4/28 → 8/26, with the bulk 7/28 → 8/19 and the peak on 8/6–8/9 (~80/day). `DropClassesDate` is 8/14. This suggests sprint defaults of `SemesterBegins` (6/17) → `DropClassesDate` + N days rather than fixed calendar dates (A-10). `ClearedBy` first/last-seen dates give `OperatorProfile.effectiveFrom` seeds.

### 8.4 Charges and credits after the drop date

Both views currently return only `dcd = 'yes'` rows (frozen `tblFCA_TRANS_HIST` copy): charges $17,075,603 across 1,108 students; credits $7,302,949 across 677. `tblFCA_TRANS_HIST` contains only `@C` (8,346 rows) and `@F` (2,729 rows) source codes — so after the drop date the "credits" definition reduces to financial aid only; the `SUBSID_TRANS_STS='S'` branch has no rows there. The live `VIEW_OURM_TRANS_HIST` distribution timed out (> 45 s) and needs a narrower query.

### 8.5 `fn_CostAnalysis` (Spec 13.1 Revenue Assessment, A-8)

The function encodes the institution's payment-plan policy: cost = charges − credits; amount due = balance + cost; "eighty" = 80% of charges; if credits exceed 80% + balance the whole amount due becomes the loan, otherwise amount-to-clear = 80% + (balance − credits) and loan = remainder; payment = loan / 5. This is the documented formula the spec said not to invent — it can be cited for the FCA drill-down columns (`eighty`, `amtdue`, `needed`, `Loan`, `payment`). Whether it also defines "projected collections" is still a business question.

### 8.6 Other objects

- `VIEW_LAST_SEMESTER` = `MAX(YR_CDE)+MAX(TRM_CDE)` per student from `stud_term_sum_div` — the natural source for "last enrolled semester" (Sec.10.1) and for proving DNR non-enrollment.
- `VIEW_OUSA_CONSOLIDATED_BALANCES` = `SUM(AR_BAL_TO_DTE)` for subsidiaries `AR` + `CL` from Jenzabar — a third balance definition (see A-18).
- `VIEW_OUSA_ONLINE_PAYMENTS` reads a **second linked server** `[JICSSQL].[tmseprd]`.
- Discovery login `DataOps` is `db_owner` and `sysadmin`; the read-only login for the app is still to be created.

### 8.6a Decision recorded (2026-09-17, J. Wilson) — resolves the "four cleared numbers"

`tblOUSA.census` and `tblOUSA.FinanciallyCleared` on the `isCurrent = 1` row are nightly (9:00 pm) captures of `COUNT(*) FROM VIEW_OURM_FCA` and `COUNT(*) FROM VIEW_OURM_STATS`, written by a SQL Agent job / scheduled task. That explains 1,186 vs 1,188 and 1,012 vs 1,021 (a day's drift). Decisions: Cleared counts distinct students (`[rows] = 1`); Not Cleared stays FCA `Status <> 'Cleared'`; the hero card shows a reconciliation line for cleared-but-not-enrolled students; `tblOUSA` values are the official off-sprint and historical figures and are never written by the app. Full text in ASSUMPTIONS A-2.

### 8.6b DNC/DNR validation (scripts/validate-dnr-dnc.ps1, counts only)

| Measure | n |
|---|---|
| DNC: LastCleared = current term AND ClearedCurrentSession = 0 | 192 (73 with balance > 0) |
| ... present in VIEW_OURM / not present | 191 / 1 |
| VIEW_OURM not-cleared not captured by the DNC rule | 1 (LastCleared = previous term) |
| DNR: LastCleared = previous term AND ClearedCurrentSession = 1 | 360 (111 with balance > 0) |
| ... present in VIEW_OURM (false-DNR risk) | **0** |
| Enrolled with LastCleared = current / previous / other | 1,187 / 1 / 0 |

Reading: `LastCleared` is effectively the term the student record was last rolled to; a record rolled to the current term with the flag still 0 is DNC, and a record left on the previous term with the flag still 1 is DNR. The supplied query is sound; the app adds a `NOT EXISTS (VIEW_OURM)` guard on DNR and a one-row reconciliation note for the single edge case. Decision recorded in ASSUMPTIONS A-1.

### 8.6c Phase 2 verification against staging (2026-09-17, `npm run test:staging`, `npm run snapshot:once`)

`VIEW_OURM_CLEARED` (distinct `ID_NUMBER`) returns the same 1,021 as `VIEW_OURM_STATS [rows] = 1` (difference 0 on staging) in 0.0 s versus 41 s, because both read the same Jenzabar `items` rows; the app therefore counts clearance actions from `VIEW_OURM_CLEARED` and treats STATS as the spec-named equivalent. A correlated `NOT EXISTS` against `VIEW_OURM` took 107 s; materializing the enrolled set once per batch (`#enrolled`) brings every metric under 0.5 s. All five snapshot jobs succeeded against staging:

| Job | Result | Time |
|---|---|---|
| metadata.terms | 28 tblOUSA rows | 219 ms |
| dashboard.enrollmentClearance | enrolled 1,188 · cleared 1,021 · not cleared 192 · cleared-not-enrolled 25 · nightly 1,186 / 1,012 | 156 ms |
| dashboard.currentReceivable | $1,111,403.14 across 267 students (FA2026 + LF2026) | 61 ms |
| dashboard.chargesCredits | charges $17,075,603 · credits $7,302,949 · after drop date | 47 ms |
| dashboard.dnrDnc | DNC 73 / $417,758.99 · DNR 111 / $372,458.63 · guard 0 | 273 ms |

### 8.8 Sprint history is forward-only (Sec.7.4, decided 2026-09-18)

All `VIEW_OURM_*` views are scoped to `tblOUSA.isCurrent = 1`, so dated clearance actions exist for the **current term only**; `tblStudent.LastCleared` carries a term code, not a date. An earlier sprint's **daily shape** therefore cannot be reconstructed. Consequence for Sec.7.4: the app archives one `sprintDaily` snapshot per term and the day-of-sprint overlay reads that archive; Fall 2026 is the first captured sprint, so curves for earlier terms begin with Spring 2027. Backfilling the shape would need read access to the underlying Jenzabar `items` rows with a term filter — open question 8 in ASSUMPTIONS.md.

**Prior-semester TOTALS are available, and are what the Compare tab draws (J. Wilson, 2026-09-18).** `LastCleared` matches `tblOUSA.JADI_TradName` / `JADI_LeapName` for *every* row, not only the `isCurrent` / `wasCurrent` ones, so any semester's metadata can be derived from a matching record (`'XX0000'` = never cleared falls through). The Compare tab therefore benchmarks the running sprint against the same-season prior semesters' **nightly `tblOUSA.FinanciallyCleared`** figures — the official historical number under A-2 — drawn as dotted target rules with census and cleared-%-of-census beside them. Counting `LastCleared = <term>` instead would give 1,153 for FA2026 against the official 1,012: that is the rolled-to population, not clearance actions, so it is deliberately not used as the benchmark.

The general `LastCleared` → `tblOUSA` resolver (term code → semester name, academic year, dates, nightly figures, Traditional vs LEAP) is **deferred to Phase 4** with Historical Analysis, where Sec.9.3 "receivables by semester" needs it. Until then term codes render raw (`FA2025`) outside the current/previous pair.

Sprint counting rule (implemented in `Q.sprintPrelude`): each student is counted on their **first** clearance action inside the window (`ROW_NUMBER() OVER (PARTITION BY ID_NUMBER ORDER BY DateCleared, USER_NAME) = 1`). That is the same one-row-per-student dedup as the hero card (A-2), so By Date, By Operator and By Classification each sum to Cleared. It differs from the Phase 2 prelude only for the 7 students with two clearance actions, whose operator attribution now follows the first action rather than `MIN(USER_NAME)`.

### 8.7 Remaining follow-ups
- Narrow the `VIEW_OURM_TRANS_HIST` SOURCE_CDE query (e.g. `TOP` by month) or run it against `[jadi].dbo.trans_hist` with a term filter.
- Confirm with the DBA where `[172.18.96.11]\TMSEPRD` and `[JICSSQL]` point on staging.
