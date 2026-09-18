# Validation SQL (reference only)

Place the SQL supplied with the mind map / requirements here **verbatim**. These
statements are the approved reference for Acceptance Criteria 2–4 (Spec §21) and
are compared against the parameterized statements in
`src/server/repositories/mssql/sql/` during Phase 6. They are never executed by the
application itself.

Known so far (Spec §6.1):

```sql
-- Enrolled
SELECT COUNT(*) FROM view_ourm_fca;
-- Cleared
SELECT COUNT(*) FROM view_ourm_stats WHERE [rows] = 1;
-- Not cleared
SELECT COUNT(*) FROM view_ourm_fca WHERE [status] <> 'Cleared';
```

Files in this folder:

| File | Supplied | Used by |
|---|---|---|
| `dnr_dnc_source.sql` | 2026-09-17 (A-1, signed off) | `Q.dnrDncSummary` / `populationWhere.dnc|dnr` must match; `tests/staging/mssql-provider.test.ts` |
| `clearance_by_classification.sql` | 2026-09-17 (Spec §7.3, Clearance Breakdown card) | The app runs a fast equivalent (`Q.classificationCounts` over VIEW_OURM / VIEW_OURM_CLEARED / student_master, < 1 s) instead of this 40–120 s FCA/STATS query; `tests/staging/clearance-breakdown.test.ts` executes this file verbatim and asserts the rows are identical |

These files are the only place the slow views are ever queried, and only by the staging test suite.
