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

/**
 * Classification bucket exactly as decided in A-19 and mirrored by breakdownCode():
 * TEL_WEB_GRP_CDE = 22 ("Incoming Transfer") wins over the class code, then FF/FR collapse to FR,
 * then blank becomes XX. Used by both the term-wide and sprint-scoped counts so they cannot drift.
 */
export function CLASS_BUCKET(alias: string): string {
  return `CASE WHEN LTRIM(RTRIM(CAST(${alias}.TEL_WEB_GRP_CDE AS varchar(10)))) = '22' THEN 'TR'
              WHEN UPPER(LTRIM(RTRIM(ISNULL(${alias}.CURRENT_CLASS_CDE, '')))) IN ('FF', 'FR') THEN 'FR'
              WHEN LTRIM(RTRIM(ISNULL(${alias}.CURRENT_CLASS_CDE, ''))) = '' THEN 'XX'
              ELSE UPPER(LTRIM(RTRIM(${alias}.CURRENT_CLASS_CDE))) END`;
}

/**
 * Paging without OFFSET/FETCH.
 *
 * ousadb runs at database compatibility level 100 (SQL Server 2008) on a 2019 server, and
 * OFFSET ... FETCH NEXT needs level 110. The connection's current database decides which rules
 * apply, so every statement the application sends to ousadb is parsed at 2008 level — which is
 * also why TRY_CONVERT and THROW are absent from this codebase.
 *
 * ROW_NUMBER() is available from 2005, so it pages at any level. The ORDER BY is duplicated into
 * the window and the outer sort deliberately: the window decides which rows fall in the page, the
 * outer ORDER BY decides the order they come back in, and dropping the second one would leave the
 * page's own ordering to the optimiser.
 */
function paged(select: string, from: string, orderBy: string, chained = false): string {
  // `chained` matters: PRELUDE ends with an OPEN `WITH cur AS (...), prev AS (...)`, so its page
  // must be appended as another CTE in the same WITH. Starting a second `WITH` after the first is
  // a syntax error, and the kind that only shows up against a real server.
  const open = chained ? `, page AS (` : `WITH page AS (`;
  return `${open}
  SELECT ${select},
         ROW_NUMBER() OVER (ORDER BY ${orderBy}) AS __rn
  ${from}
)
SELECT * FROM page
WHERE __rn > @offset AND __rn <= @offset + @pageSize
ORDER BY __rn;`;
}

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
  /**
   * Clearance Breakdown, whole term (Spec §7.3) — fast equivalent of
   * docs/validation-sql/clearance_by_classification.sql. In the supplied query the columns come from
   * FCA.cCode = ISNULL(student_master.CURRENT_CLASS_CDE,'XX') and FCA.what / STATS.what =
   * 'Incoming Transfer' when TEL_WEB_GRP_CDE = 22; CLASS_BUCKET() encodes exactly that rule and is
   * shared with the sprint-scoped version, so the two can never drift apart.
   * FCA rows = VIEW_OURM ∩ student_master; STATS [rows] = 1 = distinct VIEW_OURM_CLEARED.
   * Returns (kind, code, n); the service applies the fixed class list, NotCleared, %, and Total.
   */
  classificationCounts: `
SET NOCOUNT ON;
WITH sm AS (
  SELECT CAST(ID_NUM AS varchar(50)) AS idnumber, ${CLASS_BUCKET("student_master")} AS code
  FROM [jadi].[dbo].[student_master]
),
e AS (SELECT CAST(idnumber AS varchar(50)) AS idnumber FROM dbo.VIEW_OURM),
c AS (SELECT DISTINCT CAST(ID_NUMBER AS varchar(50)) AS idnumber FROM dbo.VIEW_OURM_CLEARED)
SELECT 'enrolled' AS kind, sm.code, COUNT(*) AS n FROM e JOIN sm ON sm.idnumber = e.idnumber GROUP BY sm.code
UNION ALL
SELECT 'cleared',  sm.code, COUNT(*)      FROM c JOIN sm ON sm.idnumber = c.idnumber GROUP BY sm.code;`,

  /**
   * Clearance Sprint (Spec §7). Every sprint metric is built from ONE population: the student's
   * FIRST clearance action (ROW_NUMBER = 1), which is the same [rows] = 1 dedup the hero card uses
   * (A-2) — so a student is counted on exactly one day, for one operator, in one classification, and
   * the sprint totals reconcile with Cleared on the dashboard.
   * The window is a pair of calendar dates: >= @start and < @end + 1 day, so the whole end day counts.
   * #enrolled is materialized rather than correlated (a correlated NOT EXISTS on VIEW_OURM took 107 s).
   */
  sprintPrelude: (withEnrolled = false) => `
SET NOCOUNT ON;
SELECT idnumber, DateCleared, ClearedBy
INTO #first
FROM (SELECT CAST(ID_NUMBER AS varchar(50)) AS idnumber, DateCleared, USER_NAME AS ClearedBy,
             ROW_NUMBER() OVER (PARTITION BY ID_NUMBER ORDER BY DateCleared, USER_NAME) AS rn
      FROM dbo.VIEW_OURM_CLEARED) r
WHERE rn = 1 AND DateCleared >= @start AND DateCleared < DATEADD(day, 1, @end);
CREATE UNIQUE CLUSTERED INDEX ix_f ON #first(idnumber);${
    withEnrolled
      ? `
SELECT CAST(idnumber AS varchar(50)) AS idnumber INTO #enrolled FROM dbo.VIEW_OURM;
CREATE UNIQUE CLUSTERED INDEX ix_e ON #enrolled(idnumber);`
      : ""
  }`,

  sprintEpilogue: (withEnrolled = false) => `
DROP TABLE #first;${withEnrolled ? " DROP TABLE #enrolled;" : ""}`,

  /** §7.1 — students cleared per calendar day inside the window. */
  clearanceByDate: `
SELECT CAST(DateCleared AS date) AS d, COUNT(*) AS n
FROM #first GROUP BY CAST(DateCleared AS date) ORDER BY 1;`,

  /** §7.2 — per ClearedBy code, with first/last action (seeds OperatorProfile effective dates). */
  clearanceByOperator: `
SELECT ISNULL(ClearedBy, '') AS code, COUNT(*) AS n, MIN(DateCleared) AS firstAt, MAX(DateCleared) AS lastAt
FROM #first GROUP BY ISNULL(ClearedBy, '') ORDER BY n DESC;`,

  /** §7.3 scoped to the sprint window: enrolled is current enrollment, cleared is actions inside the window. */
  classificationCountsInRange: `
SELECT 'enrolled' AS kind, ${CLASS_BUCKET("sm")} AS code, COUNT(*) AS n
FROM #enrolled e JOIN [jadi].[dbo].[student_master] sm ON CAST(sm.ID_NUM AS varchar(50)) = e.idnumber
GROUP BY ${CLASS_BUCKET("sm")}
UNION ALL
SELECT 'cleared', ${CLASS_BUCKET("sm")}, COUNT(*)
FROM #first f JOIN [jadi].[dbo].[student_master] sm ON CAST(sm.ID_NUM AS varchar(50)) = f.idnumber
GROUP BY ${CLASS_BUCKET("sm")};`,

  /** Students behind a sprint cell (day / operator / classification). Filters are parameterized. */
  sprintStudentPage: (where: string, sortColumn: string, dir: "ASC" | "DESC") =>
    paged(
      `S.idnumber, S.lastname, S.firstname, S.midname, S.pid, S.email, S.cCode, S.ClearedCurrentSession, S.AccountBalance, S.LastCleared,
         f.ClearedBy, f.DateCleared,
         CASE WHEN e.idnumber IS NULL THEN 0 ELSE 1 END AS enrolled,
         CASE WHEN SM.TEL_WEB_GRP_CDE = '22' THEN 1 ELSE 0 END AS isIncomingTransfer`,
      `FROM #first f
  JOIN dbo.tblStudent S ON S.idnumber = f.idnumber
  LEFT JOIN #enrolled e ON e.idnumber = f.idnumber
  LEFT JOIN [jadi].[dbo].[student_master] SM ON CAST(SM.ID_NUM AS varchar(50)) = f.idnumber
  WHERE ${where}`,
      `${sortColumn} ${dir}, S.idnumber`,
    ),

  sprintStudentCount: (where: string) => `
SELECT COUNT(*) AS n
FROM #first f
JOIN dbo.tblStudent S ON S.idnumber = f.idnumber
LEFT JOIN [jadi].[dbo].[student_master] SM ON CAST(SM.ID_NUM AS varchar(50)) = f.idnumber
WHERE ${where};`,

  /** Sprint filter fragments; every value is bound, never interpolated. */
  sprintWhere: {
    all: "1 = 1",
    day: "CAST(f.DateCleared AS date) = @day",
    operator: "ISNULL(f.ClearedBy, '') = @operator",
    classification: `${CLASS_BUCKET("SM")} = @classification`,
  } as const,

  /**
   * Spec §9.2 — global balance totals in one scan of tblStudent. `AccountBalance` is the
   * authoritative column (A-18, decided 2026-09-18); the negative total is reported as an absolute
   * value and is never netted against the positive one (A-5).
   */
  globalBalances: `
SELECT
  ISNULL(SUM(CASE WHEN AccountBalance > 0 THEN AccountBalance END), 0) AS positiveTotal,
  SUM(CASE WHEN AccountBalance > 0 THEN 1 ELSE 0 END)                  AS positiveCount,
  ISNULL(ABS(SUM(CASE WHEN AccountBalance < 0 THEN AccountBalance END)), 0) AS negativeTotal,
  SUM(CASE WHEN AccountBalance < 0 THEN 1 ELSE 0 END)                  AS negativeCount,
  SUM(CASE WHEN AccountBalance = 0 THEN 1 ELSE 0 END)                  AS zeroCount
FROM dbo.tblStudent;`,

  /**
   * Spec §9.3 — positive balances grouped by the term code in LastCleared (A-22). Grouping happens in
   * SQL; mapping a code to its semester, and splitting summer (A-23) and unmatched codes out, happens
   * in the service, so one resolver serves every screen.
   */
  receivablesByTerm: `
SELECT ISNULL(LastCleared, '') AS termKey, COUNT(*) AS students, SUM(AccountBalance) AS positiveBalance
FROM dbo.tblStudent
WHERE AccountBalance > 0
GROUP BY ISNULL(LastCleared, '')
ORDER BY 1;`,

  /**
   * Phase 8 M2 — the semester receivable, decomposed (AI-ANALYSIS-PLAN section 4.2, A-39).
   *
   * receivablesByTerm above gives one total per bucket, and A-39 established that the total is NOT
   * "the receivable for that semester": LastCleared holds one value per student and is overwritten
   * on every roll, so a balance rests under a term only while that record stopped there. Measured
   * on staging 2026-09-30, stillEnrolled is 0 for every past term -- the buckets contain nothing
   * but leavers.
   *
   * This splits each bucket so the narrative can say WHICH kind of money it is:
   *   owedByEnrolled          live debt on active students -- collections and clearance
   *   owedClearedNotReturned  cleared, then gone -- the DNR shape, and the majority in most terms
   *   owedNeverClearedGone    never got through the gate, and left
   *
   * LEFT JOIN rather than EXISTS inside the aggregate: SQL Server rejects a subquery within SUM()
   * (error 130), which is how the first draft of this failed.
   */
  receivableDecomposition: `
WITH enrolled AS (SELECT DISTINCT idnumber FROM dbo.VIEW_OURM)
SELECT o.SemesterName                                           AS semesterName,
       MIN(o.SemesterBegins)                                    AS termBegins,
       COUNT(*)                                                 AS students,
       SUM(s.AccountBalance)                                    AS owed,
       SUM(CASE WHEN e.idnumber IS NOT NULL THEN 1 ELSE 0 END)  AS stillEnrolled,
       SUM(CASE WHEN e.idnumber IS NOT NULL THEN s.AccountBalance ELSE 0 END) AS owedByEnrolled,
       SUM(CASE WHEN e.idnumber IS NULL     THEN s.AccountBalance ELSE 0 END) AS owedByNotEnrolled,
       SUM(CASE WHEN ISNULL(s.ClearedCurrentSession, 0) = 1 AND e.idnumber IS NULL
                THEN s.AccountBalance ELSE 0 END)               AS owedClearedNotReturned,
       SUM(CASE WHEN ISNULL(s.ClearedCurrentSession, 0) = 0 AND e.idnumber IS NULL
                THEN s.AccountBalance ELSE 0 END)               AS owedNeverClearedGone
FROM dbo.tblStudent AS s
JOIN dbo.tblOUSA AS o ON s.LastCleared IN (o.JADI_TradName, o.JADI_LeapName)
LEFT JOIN enrolled AS e ON e.idnumber = s.idnumber
WHERE s.AccountBalance > 0
GROUP BY o.SemesterName
ORDER BY MIN(o.SemesterBegins);`,

  /**
   * Phase 8 M5 — debit balances on term codes that match no tblOUSA row (A-42).
   *
   * Measured at $971,656 across 166 students on 2026-09-30, $807,010 of it on the XX0000 sentinel
   * and the rest across 41 codes back to SP1998 plus an unrecognised LM2025 family. That is 7.9% of
   * the global receivable and it is absent from every semester chart, so the data-quality briefing
   * leads with it rather than footnoting it.
   */
  unmatchedTermResidue: `
SELECT ISNULL(s.LastCleared, '') AS termKey, COUNT(*) AS students, SUM(s.AccountBalance) AS owed
FROM dbo.tblStudent AS s
WHERE s.AccountBalance > 0
  AND NOT EXISTS (SELECT 1 FROM dbo.tblOUSA o WHERE s.LastCleared IN (o.JADI_TradName, o.JADI_LeapName))
GROUP BY ISNULL(s.LastCleared, '')
ORDER BY SUM(s.AccountBalance) DESC;`,

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
  studentPage: (where: string, sortColumn: string, dir: "ASC" | "DESC") =>
    `${PRELUDE}
${paged(
      `S.idnumber, S.lastname, S.firstname, S.midname, S.pid, S.email, S.cCode, S.ClearedCurrentSession, S.AccountBalance, S.LastCleared,
         c.ClearedBy, c.DateCleared,
         CASE WHEN e.idnumber IS NULL THEN 0 ELSE 1 END AS enrolled,
         CASE WHEN SM.TEL_WEB_GRP_CDE = '22' THEN 1 ELSE 0 END AS isIncomingTransfer`,
      `FROM dbo.tblStudent S
  LEFT JOIN #cleared c ON c.idnumber = S.idnumber
  LEFT JOIN #enrolled e ON e.idnumber = S.idnumber
  LEFT JOIN [jadi].[dbo].[student_master] SM ON CAST(SM.ID_NUM AS varchar(50)) = S.idnumber
  WHERE ${where}`,
      `${sortColumn} ${dir}, S.idnumber`,
      true, // PRELUDE leaves a WITH open
    )}${EPILOGUE}`,

  /**
   * The whole DNR/DNC population (Spec §8) in one batch: both categories, the A-1 rules verbatim
   * (including the DNR enrollment guard), the columns §8 lists, and the A-19 transfer flag. Bounded by
   * `AccountBalance > 0`, so TOP is a safety net rather than paging — the service does the filtering,
   * sorting and totalling so the table, its footer and the export always agree.
   */
  dnrDncPopulation: `${PRELUDE}
SELECT TOP (@limit) category, idnumber, lastname, firstname, midname, pid, email, cCode, ClearedCurrentSession,
       AccountBalance, LastCleared, ClearedBy, DateCleared, enrolled, isIncomingTransfer
FROM (
  SELECT 'DNC' AS category, S.idnumber, S.lastname, S.firstname, S.midname, S.pid, S.email, S.cCode,
         S.ClearedCurrentSession, S.AccountBalance, S.LastCleared, c.ClearedBy, c.DateCleared,
         CASE WHEN e.idnumber IS NULL THEN 0 ELSE 1 END AS enrolled,
         CASE WHEN SM.TEL_WEB_GRP_CDE = '22' THEN 1 ELSE 0 END AS isIncomingTransfer
  FROM dbo.tblStudent S
  LEFT JOIN #cleared c ON c.idnumber = S.idnumber
  LEFT JOIN #enrolled e ON e.idnumber = S.idnumber
  LEFT JOIN [jadi].[dbo].[student_master] SM ON CAST(SM.ID_NUM AS varchar(50)) = S.idnumber
  WHERE ${"EXISTS (SELECT 1 FROM cur WHERE S.LastCleared IN (cur.t, cur.l)) AND ISNULL(S.ClearedCurrentSession, 0) = 0 AND S.AccountBalance > 0"}
  UNION ALL
  SELECT 'DNR', S.idnumber, S.lastname, S.firstname, S.midname, S.pid, S.email, S.cCode,
         S.ClearedCurrentSession, S.AccountBalance, S.LastCleared, c.ClearedBy, c.DateCleared,
         CASE WHEN e.idnumber IS NULL THEN 0 ELSE 1 END,
         CASE WHEN SM.TEL_WEB_GRP_CDE = '22' THEN 1 ELSE 0 END
  FROM dbo.tblStudent S
  LEFT JOIN #cleared c ON c.idnumber = S.idnumber
  LEFT JOIN #enrolled e ON e.idnumber = S.idnumber
  LEFT JOIN [jadi].[dbo].[student_master] SM ON CAST(SM.ID_NUM AS varchar(50)) = S.idnumber
  WHERE ${"EXISTS (SELECT 1 FROM prev WHERE S.LastCleared IN (prev.t, prev.l)) AND S.ClearedCurrentSession = 1 AND S.AccountBalance > 0 AND NOT EXISTS (SELECT 1 FROM #enrolled e2 WHERE e2.idnumber = S.idnumber)"}
) p
ORDER BY category, lastname, firstname, idnumber;${EPILOGUE}`,

  studentCount: (where: string) => `${PRELUDE}
SELECT COUNT(*) AS n FROM dbo.tblStudent S WHERE ${where};${EPILOGUE}`,
};
