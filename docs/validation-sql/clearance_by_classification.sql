-- Clearance Breakdown (Spec Sec.7.3) source query supplied by J. Wilson, 2026-09-18.
-- Preserved VERBATIM as the acceptance reference. The application runs an equivalent over
-- VIEW_OURM / VIEW_OURM_CLEARED + [jadi].dbo.student_master (see src/server/repositories/mssql/sql.ts,
-- Q.clearanceByClassification); tests/staging asserts the two return identical rows.
USE [ousadb];
WITH ClassCodes AS
(
    SELECT *
    FROM (VALUES
        ('FR', 'Freshmen',          1),
        ('SP', 'Special',           2),
        ('AE', 'Leap',              3),
        ('AD', 'Academy',           4),
        ('XX', 'UnClassified',      5),
        ('JR', 'Junior',            6),
        ('EM', 'Employee',          7),
        ('DI', 'Dietetic',          8),
        ('SO', 'Sophomore',         9),
        ('SR', 'Senior',           10),
        ('TR', 'Transfer Student', 11),
        ('GR', 'Graduate',         12)
    ) AS C(cCode, ClassName, SortOrder)
),
Enrolled AS
(
    SELECT
        CASE
            -- Incoming transfers are reported separately
            WHEN what = 'Incoming Transfer'
                THEN 'TR'
            -- Combine FF and FR into Freshmen
            WHEN cCode IN ('FF', 'FR')
                THEN 'FR'
            ELSE cCode
        END AS cCode,
        COUNT(*) AS Enrolled
    FROM view_ourm_fca
    GROUP BY
        CASE
            WHEN what = 'Incoming Transfer'
                THEN 'TR'
            WHEN cCode IN ('FF', 'FR')
                THEN 'FR'
            ELSE cCode
        END
),
Cleared AS
(
    SELECT
        CASE
            -- Incoming transfers are reported separately
            WHEN what = 'Incoming Transfer'
                THEN 'TR'
            -- Combine FF and FR into Freshmen
            WHEN Class IN ('FF', 'FR')
                THEN 'FR'
            -- Blank class is reported as UnClassified
            WHEN ISNULL(Class, '') = ''
                THEN 'XX'
            ELSE Class
        END AS cCode,
        COUNT(*) AS Cleared
    FROM view_ourm_stats
    WHERE [rows] = 1
    GROUP BY
        CASE
            WHEN what = 'Incoming Transfer'
                THEN 'TR'
            WHEN Class IN ('FF', 'FR')
                THEN 'FR'
            WHEN ISNULL(Class, '') = ''
                THEN 'XX'
            ELSE Class
        END
),
ReportData AS
(
    SELECT
        C.cCode,
        C.ClassName,
        ISNULL(E.Enrolled, 0) AS Enrolled,
        ISNULL(CL.Cleared, 0) AS Cleared,
        ISNULL(E.Enrolled, 0) - ISNULL(CL.Cleared, 0) AS NotCleared,
        C.SortOrder
    FROM ClassCodes C
    LEFT JOIN Enrolled E
        ON E.cCode = C.cCode
    LEFT JOIN Cleared CL
        ON CL.cCode = C.cCode
)
SELECT
    cCode,
    ClassName,
    Enrolled,
    Cleared,
    NotCleared,
   isnull(   CAST(
        CAST(
            Cleared * 100.0 / NULLIF(Enrolled, 0)
            AS DECIMAL(6,2)
        )
        AS VARCHAR(10)
    ),'0') + '%' AS ClearedPercent
FROM
(
    ------------------------------------------------
    -- Individual Classifications
    ------------------------------------------------
    SELECT
        cCode,
        ClassName,
        Enrolled,
        Cleared,
        NotCleared,
        SortOrder
    FROM ReportData
    UNION ALL
    ------------------------------------------------
    -- Grand Total
    ------------------------------------------------
    SELECT
        '',
        'Total',
        SUM(Enrolled),
        SUM(Cleared),
        SUM(NotCleared),
        99
    FROM ReportData
) AS FinalReport
ORDER BY SortOrder;
