WITH Combined AS
(
    SELECT
        cCode, idnumber, firstname, lastname,
        [status], accountbalance,
        1 AS source_priority
    FROM view_ourm_FCA
    WHERE cCode NOT IN ('AD','AE','EM','FF','FR','GR','JR','SO','SR','DI')

    UNION ALL

    SELECT
        [class] AS cCode, idnumber, firstname, lastname,
        [status] = 'Cleared',
        accountbalance,
        2 AS source_priority
    FROM view_ourm_STATS
    WHERE [class] NOT IN ('AD','AE','EM','FF','FR','GR','JR','SO','SR','DI')
),
Ranked AS
(
    SELECT *,
           ROW_NUMBER() OVER (
               PARTITION BY idnumber
               ORDER BY source_priority
           ) AS rn
    FROM Combined
)
SELECT
    cCode, idnumber, firstname, lastname,
    [status], accountbalance
FROM Ranked
WHERE rn = 1
ORDER BY lastname, firstname;