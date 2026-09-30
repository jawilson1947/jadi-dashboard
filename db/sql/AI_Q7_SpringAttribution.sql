/*
  AI_Q7_SpringAttribution.sql — is the Spring receivable pattern attrition, or the measure?

  Read-only. Compatibility level 100 safe.

  THE QUESTION (ASSUMPTIONS A-39, AI-ANALYSIS-PLAN section 4.2). Section 9.3 groups TODAY's debit
  balances by tblStudent.LastCleared, which holds one value per student and is overwritten on every
  roll. A balance therefore rests under a term only while that record stopped there. If leavers'
  records come to rest on Spring codes -- which is what you would expect when the academic year ends
  in Spring -- Spring buckets accumulate residual debt and the chart shows higher Spring receivables
  with no attrition effect at all.

  The proposed cause (DNR attrition) and this artefact overlap heavily, so the point is not to
  choose between them from a chart. It is to see WHERE the money sits.

  READ IT LIKE THIS:
    - Spring excess concentrated in notEnrolled, older terms  -> consistent with attrition AND with
      the artefact; they are the same students. The lever is retention, and A-40 (accumulate the
      per-term DNR series) is how it gets measured properly from here.
    - Spring excess concentrated in stillEnrolled, recent terms -> NOT attrition. A billing-cycle or
      collections effect, and the Spring/Fall gap is about when charges land.
    - Excess spread evenly across all old terms regardless of season -> the attribution artefact
      alone. Fix the measure, not the business.

  VIEW_OURM is the fast view (0.2 s per FINDINGS) and is current-term by construction, so
  "stillEnrolled" means enrolled NOW -- not enrolled in the term named on the row. That is the
  correct test here: it asks whether the debt belongs to someone still with us.
*/

WITH enrolled AS (SELECT DISTINCT idnumber FROM dbo.VIEW_OURM)
SELECT o.SemesterName,
       MIN(o.SemesterBegins)                                        AS termBegins,
       COUNT(*)                                                     AS students,
       SUM(s.AccountBalance)                                        AS owed,
       SUM(CASE WHEN e.idnumber IS NOT NULL THEN 1 ELSE 0 END)      AS stillEnrolled,
       SUM(CASE WHEN e.idnumber IS NOT NULL
                THEN s.AccountBalance ELSE 0 END)                   AS owedByEnrolled,
       SUM(CASE WHEN e.idnumber IS NULL
                THEN s.AccountBalance ELSE 0 END)                   AS owedByNotEnrolled,
       -- A-22a: flag = 1 against an older LastCleared is a PAST clearance. Cleared and gone is the
       -- DNR shape; never cleared and gone is a different problem with a different remedy.
       SUM(CASE WHEN ISNULL(s.ClearedCurrentSession, 0) = 1 AND e.idnumber IS NULL
                THEN s.AccountBalance ELSE 0 END)                   AS owedClearedNotReturned,
       SUM(CASE WHEN ISNULL(s.ClearedCurrentSession, 0) = 0 AND e.idnumber IS NULL
                THEN s.AccountBalance ELSE 0 END)                   AS owedNeverClearedGone
FROM dbo.tblStudent AS s
JOIN dbo.tblOUSA AS o
  ON s.LastCleared IN (o.JADI_TradName, o.JADI_LeapName)
-- LEFT JOIN, not EXISTS inside the aggregate: SQL Server refuses a subquery within SUM().
LEFT JOIN enrolled AS e ON e.idnumber = s.idnumber
WHERE s.AccountBalance > 0
GROUP BY o.SemesterName
ORDER BY MIN(o.SemesterBegins);

-- The residue: debit balances whose LastCleared matches no tblOUSA row at all, including the
-- XX0000 sentinel. A-23 keeps this visible so semester totals still reconcile to the global figure.
SELECT ISNULL(s.LastCleared, '(null)') AS termKey,
       COUNT(*)                        AS students,
       SUM(s.AccountBalance)           AS owed
FROM dbo.tblStudent AS s
WHERE s.AccountBalance > 0
  AND NOT EXISTS (SELECT 1 FROM dbo.tblOUSA o
                   WHERE s.LastCleared IN (o.JADI_TradName, o.JADI_LeapName))
GROUP BY ISNULL(s.LastCleared, '(null)')
ORDER BY SUM(s.AccountBalance) DESC;
