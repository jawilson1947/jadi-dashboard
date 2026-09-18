/**
 * Parameterized T-SQL for the mssql provider. One place, reviewed against
 * docs/discovery/FINDINGS.md and docs/validation-sql/. Rules:
 *   - read-only against ousadb/jadi; the only writes are to per-batch #temp tables
 *   - tblStudent: only the columns listed in SAFE_STUDENT_COLUMNS (never SSN, dob, gender, BankAccount)
 *   - no VIEW_OURM_FCA / VIEW_OURM_STATS aggregates (40–120 s), no VIEW_OURM_ACAD, no linked servers
 *   - current/previous term are always taken from tblOUSA.isCurrent / wasCurrent inside the query
 *
 * Performance notes (measured on staging 2026-09-17, scripts/probe-timing.ps1):
 *   VIEW_OURM count 0.2 s · VIEW_OURM_CLEARED distinct 0.0 s (= VIEW_OURM_STATS [rows]=1 count, diff 0, 41 s)
 *   correlated NOT EXISTS against VIEW_OURM: 107 s  → materialize the enrolled set once (#enrolled)
 */

/** Columns the application may read from tblStudent. Enforced by tests (tests/unit/mssql-sql.test.ts). */
export const SAFE_STUDENT_COLUMNS = ["idnumber", "lastname", "firstname", "midname", "pid", "email", "cCode", "ClearedCurrentSession", "AccountBalance", "LastCleared"] as const;

/**
 * Batch prelude: materialize the two populations every metric is built from.
 *   #enrolled  = VIEW_OURM (current-term registrations; ≡ VIEW_OURM_FCA rows)
 *   #cleared   = one row per student with a clearance action this term (VIEW_OURM_CLEARED, same `items`
 *                rows that VIEW_OURM_STATS reads; the [rows] = 1 dedup is the GROUP BY)
 * Temp tables are connection-scoped and dropped at the end of each batch.
 */
const PRELUDE = `
SET NOCOUNT ON;
SELECT CAST(idnumber AS varchar(50)) AS idnumber, CAST(ISNULL(ClearedCurrentSession, 0) AS bit) AS cleared
INTO #enrolled FROM dbo.VIEW_OURM;
SELECT CAST(ID_NUMBER AS varchar(50)) AS idnumber, MIN(DateCleared) AS DateCleared, MIN(USER_NAME) AS ClearedBy
INTO #cleared FROM dbo.VIEW_OURM_CLEARED GROUP BY ID_NUMBER;
CREATE UNIQUE CLUSTERED INDEX ix_e ON #enrolled(idnumber);
CREATE UNIQUE CLUSTERED INDEX ix_c ON #cleared(idnumber);
WITH cur AS (SELECT JADI_TradName AS t, JADI_LeapName AS l FROM dbo.tblOUSA WHERE isCurrent = 1),
     prev AS (SELECT JADI_TradName AS t, JADI_LeapName AS l FROM dbo.tblOUSA WHERE wasCurrent = 1)`;

const EPILOGUE = `
DROP TABLE #enrolled; DROP TABLE #cleared;`;

export const Q = {
  terms: `
SELECT id, SemesterName, JADI_TradName, JADI_LeapName, JADI_YR_CDE, SemesterBegins, SemesterEnds,
       isCurrent, wasCurrent, census, FinanciallyCleared, DropClassesDate, WorksheetFolder
FROM dbo.tblOUSA
ORDER BY SemesterBegins;`,

  nightlyFigures: `SELECT census, FinanciallyCleared FROM dbo.tblOUSA WHERE isCurrent = 1;`,

  /** A-2: Enrolled = VIEW_OURM rows, Cleared = distinct clearance actions, Not Cleared = enrolled with flag 0. */
  enrollmentClearance: `${PRELUDE}
SELECT
  (SELECT COUNT(*) FROM #enrolled)                          AS enrolled,
  (SELECT COUNT(*) FROM #enrolled WHERE cleared = 0)         AS notCleared,
  (SELECT COUNT(*) FROM #cleared)                           AS cleared,
  (SELECT COUNT(*) FROM #cleared c LEFT JOIN #enrolled e ON e.idnumber = c.idnumber WHERE e.idnumber IS NULL) AS clearedNotEnrolled;${EPILOGUE}`,

  /** Spec §6.2: positive tblStudent balances whose LastCleared is a current-term code (A-16). */
  currentReceivable: `
SELECT SUM(AccountBalance) AS total, COUNT(*) AS studentCount
FROM dbo.tblStudent
WHERE AccountBalance > 0 AND LastCleared IN (@t1, @t2);`,

  /** Spec §6.3: the views are per-student; totals are summed here. Past DropClassesDate they read the frozen copy (FINDINGS §5). */
  chargesCredits: `
SELECT
  (SELECT SUM(Charges) FROM dbo.VIEW_OURM_CHARGES) AS charges,
  (SELECT SUM(credits) FROM dbo.VIEW_OURM_CREDITS) AS credits,
  (SELECT CASE WHEN CAST(GETDATE() AS date) >= CAST(DropClassesDate AS date) THEN 1 ELSE 0 END FROM dbo.tblOUSA WHERE isCurrent = 1) AS afterDropDate;`,

  /** A-1 exactly as supplied (docs/validation-sql/dnr_dnc_source.sql) plus the DNR enrollment guard. */
  dnrDncSummary: `${PRELUDE},
dnc AS (SELECT S.idnumber, S.AccountBalance FROM dbo.tblStudent S JOIN cur ON S.LastCleared IN (cur.t, cur.l) WHERE ISNULL(S.ClearedCurrentSession, 0) = 0 AND S.AccountBalance > 0),
dnr0 AS (SELECT S.idnumber, S.AccountBalance FROM dbo.tblStudent S JOIN prev ON S.LastCleared IN (prev.t, prev.l) WHERE S.ClearedCurrentSession = 1 AND S.AccountBalance > 0),
dnr AS (SELECT d.* FROM dnr0 d LEFT JOIN #enrolled e ON e.idnumber = d.idnumber WHERE e.idnumber IS NULL)
SELECT
  (SELECT COUNT(*) FROM dnc) AS dncCount, (SELECT SUM(AccountBalance) FROM dnc) AS dncBalance,
  (SELECT COUNT(*) FROM dnr) AS dnrCount, (SELECT SUM(AccountBalance) FROM dnr) AS dnrBalance,
  (SELECT COUNT(*) FROM dnr0 d JOIN #enrolled e ON e.idnumber = d.idnumber) AS dnrGuardViolations;${EPILOGUE}`,

  /**
   * Clearance Breakdown (Spec §7.3) — fast equivalent of docs/validation-sql/clearance_by_classification.sql.
   * Source of each column in the supplied query:  FCA.cCode = ISNULL(student_master.CURRENT_CLASS_CDE,'XX'),
   * FCA.what / STATS.what = 'Incoming Transfer' when student_master.TEL_WEB_GRP_CDE = 22, STATS.Class =
   * ISNULL(CURRENT_CLASS_CDE,''). FCA rows = VIEW_OURM ∩ student_master; STATS [rows]=1 = distinct VIEW_OURM_CLEARED.
   * Returns (kind, code, n); the service applies the fixed class list, NotCleared, %, and Total.
   */
  classificationCounts: `
SET NOCOUNT ON;
WITH sm AS (
  SELECT CAST(ID_NUM AS varchar(50)) AS idnumber,
         CASE WHEN LTRIM(RTRIM(CAST(TEL_WEB_GRP_CDE AS varchar(10)))) = '22' THEN 'TR'
              WHEN UPPER(LTRIM(RTRIM(ISNULL(CURRENT_CLASS_CDE, '')))) IN ('FF', 'FR') THEN 'FR'
              WHEN LTRIM(RTRIM(ISNULL(CURRENT_CLASS_CDE, ''))) = '' THEN 'XX'
              ELSE UPPER(LTRIM(RTRIM(CURRENT_CLASS_CDE))) END AS code
  FROM [jadi].[dbo].[student_master]
),
e AS (SELECT CAST(idnumber AS varchar(50)) AS idnumber FROM dbo.VIEW_OURM),
c AS (SELECT DISTINCT CAST(ID_NUMBER AS varchar(50)) AS idnumber FROM dbo.VIEW_OURM_CLEARED)
SELECT 'enrolled' AS kind, sm.code, COUNT(*) AS n FROM e JOIN sm ON sm.idnumber = e.idnumber GROUP BY sm.code
UNION ALL
SELECT 'cleared',  sm.code, COUNT(*)      FROM c JOIN sm ON sm.idnumber = c.idnumber GROUP BY sm.code;`,

  /** Drill-down populations as WHERE fragments over alias S (tblStudent) with cur/prev and #enrolled/#cleared available. */
  populationWhere: {
    enrolled: `EXISTS (SELECT 1 FROM #enrolled e WHERE e.idnumber = S.idnumber)`,
    cleared: `EXISTS (SELECT 1 FROM #cleared c WHERE c.idnumber = S.idnumber)`,
    notCleared: `EXISTS (SELECT 1 FROM #enrolled e WHERE e.idnumber = S.idnumber AND e.cleared = 0)`,
    receivable: `S.AccountBalance > 0 AND EXISTS (SELECT 1 FROM cur WHERE S.LastCleared IN (cur.t, cur.l))`,
    dnc: `EXISTS (SELECT 1 FROM cur WHERE S.LastCleared IN (cur.t, cur.l)) AND ISNULL(S.ClearedCurrentSession, 0) = 0 AND S.AccountBalance > 0`,
    dnr: `EXISTS (SELECT 1 FROM prev WHERE S.LastCleared IN (prev.t, prev.l)) AND S.ClearedCurrentSession = 1 AND S.AccountBalance > 0 AND NOT EXISTS (SELECT 1 FROM #enrolled e WHERE e.idnumber = S.idnumber)`,
  } as const,

  /**
   * Student page. Incoming-transfer flag (A-19) needs student_master.TEL_WEB_GRP_CDE from the co-located
   * [jadi] database; LEFT JOIN so a missing grant degrades to "not transfer" rather than failing.
   */
  studentPage: (where: string, sortColumn: string, dir: "ASC" | "DESC") => `${PRELUDE}
SELECT S.idnumber, S.lastname, S.firstname, S.midname, S.pid, S.email, S.cCode, S.ClearedCurrentSession, S.AccountBalance, S.LastCleared,
       c.ClearedBy, c.DateCleared,
       CASE WHEN e.idnumber IS NULL THEN 0 ELSE 1 END AS enrolled,
       CASE WHEN SM.TEL_WEB_GRP_CDE = '22' THEN 1 ELSE 0 END AS isIncomingTransfer
FROM dbo.tblStudent S
LEFT JOIN #cleared c ON c.idnumber = S.idnumber
LEFT JOIN #enrolled e ON e.idnumber = S.idnumber
LEFT JOIN [jadi].[dbo].[student_master] SM ON CAST(SM.ID_NUM AS varchar(50)) = S.idnumber
WHERE ${where}
ORDER BY ${sortColumn} ${dir}, S.idnumber
OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY;${EPILOGUE}`,

  studentCount: (where: string) => `${PRELUDE}
SELECT COUNT(*) AS n FROM dbo.tblStudent S WHERE ${where};${EPILOGUE}`,
};
