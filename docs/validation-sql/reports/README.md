# Supplied report scripts — the reference

These are the six T-SQL scripts from the Report Spec, **verbatim** as supplied (2026-09-29), kept
here as the reference the application's rewritten queries are measured against. Do not "fix" them:
their value is being exactly what was asked for.

`src/server/repositories/mssql/report-sql.ts` holds fast equivalents, because four of these read
`VIEW_OURM_FCA` or `VIEW_OURM_STATS`, which take 40–120 s (FINDINGS §6).
`tests/integration/report-equivalence.test.ts` runs both against staging and asserts the ID sets
match.

| Script | Report | Rewritten as | Why a rewrite |
|---|---|---|---|
| `GetUnclassifiedStudents.sql` | R1 Unclassified Students | `RQ.unclassified` | FCA `COUNT(*)` exceeded 120 s |
| `FreshmanWebCodeAnalysis.sql` | R2 Freshman Classification Analysis | `RQ.freshmanAnalysis` | Already fast; `FORMAT()` removed, term scope widened (R-D2a) |
| `StudentsClearedMoreThanOnce.sql` | R3 Cleared More Than Once | `RQ.clearedMoreThanOnce` | STATS 41 s vs `VIEW_OURM_CLEARED` 0.0 s |
| `fcaAccountBalanceMailMerge.sql` | R4 Enrollee Account Balance | `RQ.enrolleeBalancePopulation` | FCA; also `? and ?` → named parameters |
| `DNC_DNR_CollectionMailMerge.sql` | R5 DNC/DNR Collection | shipped DNR/DNC population | One population for the card and the letters (R-D6) |
| `CurrentlyCleared.sql` | R6 Currently Cleared | `RQ.currentlyCleared` | STATS 41 s vs `VIEW_OURM_CLEARED` 0.0 s |

## Deviations, and why

Three defects were corrected in the copies under `db/sql/` rather than reproduced:

1. **`FORMAT()` in the SELECT** (R2, R6) returns strings, which defeats sorting and typed export.
   The providers return `date` / `money` and formatting happens in `src/lib/format.ts` (Spec §15).
2. **`USE [ousadb];`** (R5) cannot run on a pooled connection.
3. **`SELECT [class]` twice** (R6) produced two identical columns.

Three differences are deliberate and are decisions, not corrections:

- **R5 adds the A-1 enrollment guard** the script omits (`NOT EXISTS (VIEW_OURM)` on the DNR leg).
  The excluded students are shown in a labelled group on the report rather than dropped silently.
  On staging that group is empty, so the row sets match (R-D6).
- **R2 covers the current AND previous semester** (J. Wilson, 2026-09-29). The script joins
  `tblOUSA` on `isCurrent = 1`; the rewrite joins on `isCurrent = 1 OR wasCurrent = 1`. This is
  sound because R2 reads `tblStudent` and `jadi.dbo.student_master` directly and never touches the
  current-term-only `VIEW_OURM_*` views. Each student matches exactly one `tblOUSA` row through
  `LastCleared`, so no row is duplicated, and `cClass` is derived against **that row's**
  `SemesterBegins` — the two terms have different boundaries, which is why the report renders one
  boundary panel and one what-if per term rather than one for the report. The equivalence test
  therefore compares the `isCurrentTerm` slice against the script, and asserts separately that
  every added row belongs to the previous term (R-D2a).
- **R6 orders by `DateCleared`** when choosing the single instance per student. `VIEW_OURM_STATS`
  defines `[rows]` as `row_number() over (partition by ID_NUM order by ID_NUM)`, so which action
  wins is undefined and may differ between runs. One instance is all that is required
  (J. Wilson, 2026-09-29); ordering makes it the *same* instance each time. The equivalence test
  therefore compares ID sets, not `DateCleared`, for the seven students with two actions.
