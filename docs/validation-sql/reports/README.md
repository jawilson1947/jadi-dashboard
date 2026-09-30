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
| `FreshmanWebCodeAnalysis.sql` | R2 Freshman Classification Analysis | `RQ.freshmanAnalysis` | Already fast; only `FORMAT()` removed |
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

Two differences are deliberate and are decisions, not corrections:

- **R5 adds the A-1 enrollment guard** the script omits (`NOT EXISTS (VIEW_OURM)` on the DNR leg).
  The excluded students are shown in a labelled group on the report rather than dropped silently.
  On staging that group is empty, so the row sets match (R-D6).
- **R6 orders by `DateCleared`** when choosing the single instance per student. `VIEW_OURM_STATS`
  defines `[rows]` as `row_number() over (partition by ID_NUM order by ID_NUM)`, so which action
  wins is undefined and may differ between runs. One instance is all that is required
  (J. Wilson, 2026-09-29); ordering makes it the *same* instance each time. The equivalence test
  therefore compares ID sets, not `DateCleared`, for the seven students with two actions.
