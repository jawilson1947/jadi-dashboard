/*
  AI_M1_HistoricalCoverage.sql — does M1 have a trend to analyse?

  Read-only. Compatibility level 100 safe (no TRY_*, no OFFSET/FETCH).

  HISTORICAL-PLAN section 8 flagged this and it has never been run: the enrolment/clearance trend
  module reads tblOUSA.census and tblOUSA.FinanciallyCleared per term. The application already
  renders an uncaptured term as "-" rather than 0 (TermFigures.captured), so nothing breaks either
  way -- but if only the last few terms carry figures, M1 has two or three points and no trend, and
  that changes the module from "analyse 15 years" to "start accumulating".

  Run both batches and send the output.
*/

-- 1. Coverage summary. The number that decides whether M1 is worth building now.
SELECT COUNT(*)                                                            AS terms,
       SUM(CASE WHEN ISNULL(census, 0) > 0 THEN 1 ELSE 0 END)              AS termsWithCensus,
       SUM(CASE WHEN ISNULL(FinanciallyCleared, 0) > 0 THEN 1 ELSE 0 END)  AS termsWithCleared,
       MIN(CASE WHEN ISNULL(census, 0) > 0 THEN SemesterBegins END)        AS earliestCensus,
       MAX(CASE WHEN ISNULL(census, 0) > 0 THEN SemesterBegins END)        AS latestCensus
FROM dbo.tblOUSA;

-- 2. Term by term, so a gap in the middle is visible rather than averaged away.
SELECT SemesterName,
       JADI_TradName,
       JADI_LeapName,
       SemesterBegins,
       census,
       FinanciallyCleared,
       CASE WHEN ISNULL(census, 0) > 0 AND ISNULL(FinanciallyCleared, 0) > 0
            THEN CAST(ROUND(100.0 * FinanciallyCleared / census, 1) AS decimal(5,1)) END AS clearedPct
FROM dbo.tblOUSA
ORDER BY SemesterBegins;
