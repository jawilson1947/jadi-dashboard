/*
  Why are students in jadi.dbo.student_master missing from ousadb.dbo.tblStudent?

  CreateNewStudentFromJenzabar.sql inner-joins four source objects, so a candidate is dropped
  silently if ANY of them has no row for them. This counts each cause separately rather than
  leaving it to be guessed.

  Read-only. Safe to run any time.
*/
SET QUERY_GOVERNOR_COST_LIMIT 0;
USE [ousadb];

WITH sm AS (
    SELECT id_num FROM [jadi].[dbo].[student_master]
    EXCEPT
    SELECT idnumber FROM [ousadb].[dbo].[tblStudent]
)
SELECT
  (SELECT COUNT(*) FROM sm) AS candidates,

  -- No name record: rare, but it happens for records created directly in a subsystem.
  (SELECT COUNT(*) FROM sm WHERE NOT EXISTS
      (SELECT 1 FROM [jadi].[dbo].[name_master] n     WHERE n.ID_NUM = sm.id_num)) AS no_name_master,

  -- No biographical record: common for applicants and non-degree registrations.
  (SELECT COUNT(*) FROM sm WHERE NOT EXISTS
      (SELECT 1 FROM [jadi].[dbo].[biograph_master] b WHERE b.ID_NUM = sm.id_num)) AS no_biograph,

  -- No address row at all.
  (SELECT COUNT(*) FROM sm WHERE NOT EXISTS
      (SELECT 1 FROM [jadi].[dbo].[address_master] a  WHERE a.ID_NUM = sm.id_num)) AS no_address_at_all,

  -- Has an address, but under a code the loader's WHERE clause does not look for. This is usually
  -- the largest bucket, and the fix is the loader rather than the student record.
  (SELECT COUNT(*) FROM sm
     WHERE EXISTS     (SELECT 1 FROM [jadi].[dbo].[address_master] a WHERE a.ID_NUM = sm.id_num)
       AND NOT EXISTS (SELECT 1 FROM [jadi].[dbo].[address_master] a WHERE a.ID_NUM = sm.id_num
                         AND (a.ADDR_CDE LIKE '%LHP%' OR a.ADDR_CDE LIKE '%CUR%' OR a.ADDR_CDE LIKE '%EML%')))
                                                                                AS address_wrong_code_only;

/*
  Would the INSERT fail outright rather than filter?

  The insert is atomic: one constraint violation rolls the whole batch back and NO students are
  added, which looks identical from outside to "it filtered everyone". The batch script dedups
  addresses (rows = 1) but NOT names or biographs, so a duplicate in either produces duplicate
  idnumber values and a primary-key violation.
*/
SELECT 'name_master' AS source_table, COUNT(*) AS ids_with_more_than_one_row
FROM (SELECT ID_NUM FROM [jadi].[dbo].[name_master]     GROUP BY ID_NUM HAVING COUNT(*) > 1) d
UNION ALL
SELECT 'biograph_master', COUNT(*)
FROM (SELECT ID_NUM FROM [jadi].[dbo].[biograph_master] GROUP BY ID_NUM HAVING COUNT(*) > 1) d;

/*
  What address codes are actually in use? Compare this against the loader's three patterns
  (%LHP%, %CUR%, %EML%). A code with a high count that matches none of them is the loader's bug,
  not the student's.
*/
SELECT ADDR_CDE,
       COUNT(*) AS rows_,
       CASE WHEN ADDR_CDE LIKE '%LHP%' OR ADDR_CDE LIKE '%CUR%' OR ADDR_CDE LIKE '%EML%'
            THEN 'loaded' ELSE 'IGNORED BY LOADER' END AS loader_sees_it
FROM [jadi].[dbo].[address_master]
GROUP BY ADDR_CDE
ORDER BY rows_ DESC;

/*
  The candidates themselves, with their causes, for spot-checking a named student.
*/
WITH sm AS (
    SELECT id_num FROM [jadi].[dbo].[student_master]
    EXCEPT
    SELECT idnumber FROM [ousadb].[dbo].[tblStudent]
)
SELECT TOP (200)
    sm.id_num,
    n.LAST_NAME, n.FIRST_NAME,
    CASE WHEN n.ID_NUM IS NULL THEN 'missing' ELSE 'found' END AS name_master,
    CASE WHEN b.ID_NUM IS NULL THEN 'missing' ELSE 'found' END AS biograph_master,
    (SELECT COUNT(*) FROM [jadi].[dbo].[address_master] a WHERE a.ID_NUM = sm.id_num) AS address_rows,
    (SELECT COUNT(*) FROM [jadi].[dbo].[address_master] a WHERE a.ID_NUM = sm.id_num
        AND (a.ADDR_CDE LIKE '%LHP%' OR a.ADDR_CDE LIKE '%CUR%' OR a.ADDR_CDE LIKE '%EML%')) AS qualifying_address_rows
FROM sm
LEFT JOIN [jadi].[dbo].[name_master]     n ON n.ID_NUM = sm.id_num
LEFT JOIN [jadi].[dbo].[biograph_master] b ON b.ID_NUM = sm.id_num
ORDER BY sm.id_num;
