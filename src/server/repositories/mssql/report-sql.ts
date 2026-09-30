/**
 * Parameterized T-SQL for the Phase 7a report catalog (docs/REPORTS-PLAN.md).
 *
 * Each statement is a fast equivalent of a script in db/sql/, which is preserved verbatim in
 * docs/validation-sql/reports/ and compared against these by tests/integration/report-equivalence.
 * The rewrites exist because VIEW_OURM_FCA and VIEW_OURM_STATS take 40-120 s (FINDINGS §6): FCA
 * calls dbo.fn_CostAnalysis five times per row, STATS joins seven Jenzabar objects per row. Both
 * are replaced by the objects underneath them, which the dashboard already reads in under a second.
 *
 * Rules, same as ./sql.ts:
 *   - read-only; the only writes are to per-batch #temp tables
 *   - tblStudent: only SAFE_STUDENT_COLUMNS; never SSN, dob, gender, BankAccount, PIN
 *   - no FORMAT() — typed values out, formatting in src/lib/format.ts (Spec §15)
 *   - current term is taken from tblOUSA.isCurrent inside the query, never from the client
 *
 * What these return is an ID list plus derived codes (A-30). Names, emails and balances are NOT
 * selected here: the service joins dbo.tblStudent at read time so a snapshot can never serve a
 * stale balance on a collection report.
 */

/**
 * Classification bucket per A-19, byte-identical to CLASS_BUCKET() in ./sql.ts and breakdownCode():
 * TEL_WEB_GRP_CDE = 22 ("Incoming Transfer") wins over the class code, then FF/FR collapse to FR,
 * then blank becomes XX. Duplicated deliberately rather than imported, and asserted equal by
 * tests/unit/report-sql.test.ts — the two files must agree, and a test says so louder than a comment.
 */
export function CLASS_BUCKET(alias: string): string {
  return `CASE WHEN LTRIM(RTRIM(CAST(${alias}.TEL_WEB_GRP_CDE AS varchar(10)))) = '22' THEN 'TR'
              WHEN UPPER(LTRIM(RTRIM(ISNULL(${alias}.CURRENT_CLASS_CDE, '')))) IN ('FF', 'FR') THEN 'FR'
              WHEN LTRIM(RTRIM(ISNULL(${alias}.CURRENT_CLASS_CDE, ''))) = '' THEN 'XX'
              ELSE UPPER(LTRIM(RTRIM(${alias}.CURRENT_CLASS_CDE))) END`;
}

/** Raw class code as the supplied scripts read it: student_master.CURRENT_CLASS_CDE, blank not null. */
const RAW_CLASS = `UPPER(LTRIM(RTRIM(ISNULL(sm.CURRENT_CLASS_CDE, ''))))`;

/**
 * The classification codes the application recognises (FINDINGS §8.2 — observed codes match the
 * spec's mapping list exactly, and no TR code exists in the data). Anything outside this list is
 * what R1 reports. Kept in one place so adding a code to the mapping table changes one line.
 */
export const KNOWN_CLASS_CODES = ["AD", "AE", "EM", "FF", "FR", "GR", "JR", "SO", "SR", "DI"] as const;
const KNOWN_LIST = KNOWN_CLASS_CODES.map((c) => `'${c}'`).join(", ");

/**
 * One clearance action per student, chosen deterministically.
 *
 * VIEW_OURM_STATS defines [rows] as row_number() over (partition by ID_NUM order by ID_NUM) — the
 * ORDER BY is the partition key, so which action wins is undefined and can differ between runs.
 * A single instance is all the reports require (J. Wilson, 2026-09-29), but ordering by DateCleared
 * costs nothing and stops a page showing a different date on two consecutive refreshes. It also
 * matches the sprint's #first population, so R6 and the Clearance Sprint name the same action.
 */
const FIRST_CLEARED = `
SELECT idnumber, DateCleared, ClearedBy
INTO #first
FROM (SELECT CAST(ID_NUMBER AS varchar(50)) AS idnumber, DateCleared, USER_NAME AS ClearedBy,
             ROW_NUMBER() OVER (PARTITION BY ID_NUMBER ORDER BY DateCleared, USER_NAME) AS rn
      FROM dbo.VIEW_OURM_CLEARED) c
WHERE c.rn = 1;
CREATE UNIQUE CLUSTERED INDEX ix_f ON #first(idnumber);`;

export const RQ = {
  /**
   * R1 — Unclassified students (db/sql/GetUnclassifiedStudents.sql).
   *
   * The supplied script unions VIEW_OURM_FCA (enrolled) and VIEW_OURM_STATS (cleared) and dedups by
   * idnumber preferring the FCA row. Equivalents: FCA rows = VIEW_OURM ∩ student_master, and its
   * [status] = CASE tblStudent.ClearedCurrentSession (FINDINGS §2); STATS [rows] = 1 = one row per
   * student in VIEW_OURM_CLEARED. The STATS branch's hard-coded 'Cleared' is reproduced as written —
   * status is incidental context on this report, not a figure to reconcile (REPORTS-PLAN §1.1).
   *
   * Selection is on the RAW class code (R-D5): applying A-19 here would hide the defect this report
   * exists to find. `resolvableAs` carries the A-19 reading so the page can split the list into
   * records that are already answerable from TEL_WEB_GRP_CDE and records that need a human lookup.
   */
  unclassified: `
SET NOCOUNT ON;
${FIRST_CLEARED}
SELECT e.idnumber, e.classCode, e.resolvableAs, e.[status], e.source
FROM (
  SELECT CAST(v.idnumber AS varchar(50)) AS idnumber,
         ${RAW_CLASS} AS classCode,
         ${CLASS_BUCKET("sm")} AS resolvableAs,
         CASE WHEN ISNULL(s.ClearedCurrentSession, 0) = 1 THEN 'Cleared' ELSE 'Not Cleared' END AS [status],
         'enrolled' AS source,
         1 AS sourcePriority
  FROM dbo.VIEW_OURM v
  JOIN [jadi].[dbo].[student_master] sm ON CAST(sm.ID_NUM AS varchar(50)) = CAST(v.idnumber AS varchar(50))
  LEFT JOIN dbo.tblStudent s ON s.idnumber = v.idnumber
  WHERE ${RAW_CLASS} NOT IN (${KNOWN_LIST})
  UNION ALL
  SELECT f.idnumber,
         ${RAW_CLASS} AS classCode,
         ${CLASS_BUCKET("sm")} AS resolvableAs,
         'Cleared' AS [status],
         'cleared' AS source,
         2 AS sourcePriority
  FROM #first f
  JOIN [jadi].[dbo].[student_master] sm ON CAST(sm.ID_NUM AS varchar(50)) = f.idnumber
  WHERE ${RAW_CLASS} NOT IN (${KNOWN_LIST})
) e
JOIN (SELECT idnumber, MIN(sourcePriority) AS p FROM (
        SELECT CAST(v.idnumber AS varchar(50)) AS idnumber, 1 AS sourcePriority
        FROM dbo.VIEW_OURM v
        JOIN [jadi].[dbo].[student_master] sm ON CAST(sm.ID_NUM AS varchar(50)) = CAST(v.idnumber AS varchar(50))
        WHERE ${RAW_CLASS} NOT IN (${KNOWN_LIST})
        UNION ALL
        SELECT f.idnumber, 2
        FROM #first f
        JOIN [jadi].[dbo].[student_master] sm ON CAST(sm.ID_NUM AS varchar(50)) = f.idnumber
        WHERE ${RAW_CLASS} NOT IN (${KNOWN_LIST})) u
      GROUP BY idnumber) w ON w.idnumber = e.idnumber AND w.p = e.sourcePriority;
DROP TABLE #first;`,

  /**
   * R2 — Freshman classification analysis (db/sql/FreshmanWebCodeAnalysis.sql).
   *
   * Already fast: tblStudent is indexed on idnumber and student_master joins on ID_NUM. The rewrite
   * only drops FORMAT() so dates arrive typed. cClass is derived exactly as the script does, from
   * student_master.DateCreated against tblOUSA.SemesterBegins; `mismatch` is cCode <> cClass, which
   * is the anomaly (R-D7). It is a warning, not a defect: one remedy is changing SemesterBegins.
   *
   * semesterBegins is returned on every row so the page can redraw the boundary and recompute the
   * what-if ("if SemesterBegins were X, mismatches would be N") without another query.
   */
  freshmanAnalysis: `
SET NOCOUNT ON;
SELECT CAST(s.idnumber AS varchar(50))                       AS idnumber,
       UPPER(LTRIM(RTRIM(ISNULL(s.cCode, ''))))              AS classCode,
       CAST(sm.TEL_WEB_GRP_CDE AS int)                       AS webCode,
       -- MOST_RECNT_YR_ENR is numeric in student_master; cast so the driver returns one type
       -- rather than a number here and a string elsewhere.
       LTRIM(RTRIM(CAST(sm.MOST_RECNT_YR_ENR AS varchar(10))))  AS mostRecentYearEnrolled,
       UPPER(LTRIM(RTRIM(ISNULL(sm.CURRENT_CLASS_CDE, ''))))  AS currentClassCode,
       CAST(sm.DateCreated AS datetime)                      AS dateCreated,
       CAST(o.SemesterBegins AS datetime)                    AS semesterBegins,
       CASE WHEN sm.DateCreated > o.SemesterBegins THEN 'FF' ELSE 'FR' END AS derivedClass,
       CASE WHEN UPPER(LTRIM(RTRIM(ISNULL(s.cCode, ''))))
                 <> CASE WHEN sm.DateCreated > o.SemesterBegins THEN 'FF' ELSE 'FR' END
            THEN CAST(1 AS bit) ELSE CAST(0 AS bit) END      AS mismatch
FROM dbo.tblStudent s
JOIN [jadi].[dbo].[student_master] sm ON CAST(sm.ID_NUM AS varchar(50)) = CAST(s.idnumber AS varchar(50))
JOIN dbo.tblOUSA o ON o.isCurrent = 1 AND s.LastCleared IN (o.JADI_TradName, o.JADI_LeapName)
WHERE UPPER(LTRIM(RTRIM(ISNULL(s.cCode, '')))) IN ('FR', 'FF')
-- Chronological, because the pattern in time is the finding (REPORTS-PLAN §4.2). The supplied
-- script tie-breaks on name; this uses the id instead, so the captured population carries no name
-- column at all and the A-30 guarantee is visible in the SELECT list rather than argued for.
ORDER BY sm.DateCreated, CAST(s.idnumber AS varchar(50));`,

  /**
   * R3 — Students cleared more than once (db/sql/StudentsClearedMoreThanOnce.sql).
   *
   * VIEW_OURM_STATS [rows] > 1 identifies students with more than one clearance action; the script
   * then joins back to list every action for those students. VIEW_OURM_CLEARED holds the same items
   * rows in 0.0 s instead of 41 s (FINDINGS §8.6c), so the population is a HAVING COUNT(*) > 1 and
   * the detail is every row for those ids. Seven students on staging.
   *
   * Every action is returned, in order, with its own date AND its own operator — the pairing matters
   * here in a way it does not on R6, so this must not be built from MIN(date), MIN(user).
   */
  clearedMoreThanOnce: `
SET NOCOUNT ON;
WITH dupes AS (
  SELECT CAST(ID_NUMBER AS varchar(50)) AS idnumber
  FROM dbo.VIEW_OURM_CLEARED
  GROUP BY ID_NUMBER
  HAVING COUNT(*) > 1
)
SELECT CAST(c.ID_NUMBER AS varchar(50))          AS idnumber,
       ${CLASS_BUCKET("sm")}                     AS classCode,
       CAST(c.DateCleared AS datetime)           AS dateCleared,
       c.USER_NAME                               AS clearedBy,
       ROW_NUMBER() OVER (PARTITION BY c.ID_NUMBER ORDER BY c.DateCleared, c.USER_NAME) AS actionNo,
       COUNT(*) OVER (PARTITION BY c.ID_NUMBER)  AS actionCount
FROM dbo.VIEW_OURM_CLEARED c
JOIN dupes d ON d.idnumber = CAST(c.ID_NUMBER AS varchar(50))
LEFT JOIN [jadi].[dbo].[student_master] sm ON CAST(sm.ID_NUM AS varchar(50)) = CAST(c.ID_NUMBER AS varchar(50))
ORDER BY idnumber, actionNo;`,

  /**
   * R4 — Enrollee account balance (db/sql/fcaAccountBalanceMailMerge.sql).
   *
   * The script's `between ? and ?` ODBC placeholders become @minBalance / @maxBalance. FCA's
   * accountbalance is tblStudent.AccountBalance (money) per FINDINGS §2, so this is A-18-consistent
   * and needs no reconciliation note. [status] != 'Cleared' is ClearedCurrentSession = 0.
   *
   * The balance predicate is applied at capture time as a WIDE net: the snapshot holds every
   * not-cleared enrollee with a debit balance, and the page filters the range in memory. One
   * snapshot then serves every range the user types, and the count under the form is always
   * consistent with the table below it.
   */
  enrolleeBalancePopulation: `
SET NOCOUNT ON;
SELECT CAST(v.idnumber AS varchar(50))  AS idnumber,
       ${CLASS_BUCKET("sm")}            AS classCode,
       UPPER(LTRIM(RTRIM(ISNULL(sm.CURRENT_CLASS_CDE, '')))) AS rawClassCode
FROM dbo.VIEW_OURM v
JOIN dbo.tblStudent s ON s.idnumber = v.idnumber
LEFT JOIN [jadi].[dbo].[student_master] sm ON CAST(sm.ID_NUM AS varchar(50)) = CAST(v.idnumber AS varchar(50))
WHERE ISNULL(s.ClearedCurrentSession, 0) = 0
  AND s.AccountBalance > 0;`,

  /**
   * R6 — Currently cleared (db/sql/CurrentlyCleared.sql).
   *
   * One row per student (the script's [rows] = 1), from VIEW_OURM_CLEARED in 0.0 s rather than
   * VIEW_OURM_STATS in 41 s. classCode is the A-19 bucket because R6 is an operational roster read
   * beside the dashboard (R-D5); rawClassCode is carried too, for anyone tracing a figure back to
   * the view.
   */
  currentlyCleared: `
SET NOCOUNT ON;
${FIRST_CLEARED}
SELECT f.idnumber,
       ${CLASS_BUCKET("sm")}                                  AS classCode,
       UPPER(LTRIM(RTRIM(ISNULL(sm.CURRENT_CLASS_CDE, ''))))   AS rawClassCode,
       CAST(f.DateCleared AS datetime)                        AS dateCleared
FROM #first f
LEFT JOIN [jadi].[dbo].[student_master] sm ON CAST(sm.ID_NUM AS varchar(50)) = f.idnumber;
DROP TABLE #first;`,
} as const;

export type ReportQueryKey = keyof typeof RQ;
