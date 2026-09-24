/* =============================================================================================
   tblStudent — name search optimization                                    2026-09-24, Phase 5a
   =============================================================================================

   THE PROBLEM, precisely

   dbo.tblStudent is 39,361 rows x 38 columns, and the three name columns are varchar(MAX):

       lastname   varchar(max)      firstname  varchar(max)      midname  varchar(max)

   SQL Server will not accept a varchar(MAX) column as an INDEX KEY (it may only be an INCLUDE
   column). So no index on lastname can exist today, and every name search reads the whole table
   including its MAX columns. That is the cost you are seeing.

   There is a second, separate limit worth stating plainly, because it decides how much any index
   can help:

       LIKE '%smith%'   leading wildcard  ->  NO SEEK IS POSSIBLE, on any B-tree index, ever
       LIKE 'smith%'    prefix            ->  seek

   The Bio Spec asks for `like <%lastname%>` — contains, not prefix. So the realistic goal is not
   "make the search seek"; it is "make the scan read 2 MB of narrow index instead of ~40 MB of
   38-column table". On this row count that is the difference between roughly a second and roughly
   a few milliseconds. If the search is later allowed to be prefix-first (see Section 5), the same
   index then seeks and the query becomes effectively free.

   CHOOSE SECTION 3 OR SECTION 4.
     Section 3 (PREFERRED) narrows lastname/firstname to a real length and indexes them directly.
       It changes no column COUNT, so `SELECT *` consumers keep working, and the application needs
       no code change. It requires a DBA and a short maintenance window.
     Section 3-ALT keeps varchar(MAX) and adds persisted computed columns — use only if the ALTER
       is refused; it adds columns, which is the thing that can break a `SELECT *` consumer.
     Section 4 touches nothing in dbo at all: a narrow search table in schema [dash], which this
       application already owns (ASSUMPTIONS A-21).

   Run Section 1 first: it tells you what is already there, so you do not add a duplicate index.
   ============================================================================================= */


/* ---------------------------------------------------------------------------------------------
   SECTION 1 — Discovery. Run this before anything else and keep the output.
   --------------------------------------------------------------------------------------------- */

-- 1a. What indexes exist today, and what do they cost?
SELECT
    ix.name                AS index_name,
    ix.type_desc,
    ix.is_unique,
    ix.is_primary_key,
    ix.fill_factor,
    STUFF((SELECT ', ' + c.name + CASE WHEN ic.is_descending_key = 1 THEN ' DESC' ELSE '' END
           FROM sys.index_columns ic
           JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
           WHERE ic.object_id = ix.object_id AND ic.index_id = ix.index_id AND ic.is_included_column = 0
           ORDER BY ic.key_ordinal
           FOR XML PATH('')), 1, 2, '')                              AS key_columns,
    STUFF((SELECT ', ' + c.name
           FROM sys.index_columns ic
           JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
           WHERE ic.object_id = ix.object_id AND ic.index_id = ix.index_id AND ic.is_included_column = 1
           ORDER BY c.name
           FOR XML PATH('')), 1, 2, '')                              AS included_columns,
    ps.row_count,
    CAST(ps.reserved_page_count * 8.0 / 1024 AS decimal(10,2))        AS reserved_mb
FROM sys.indexes ix
LEFT JOIN sys.dm_db_partition_stats ps ON ps.object_id = ix.object_id AND ps.index_id = ix.index_id
WHERE ix.object_id = OBJECT_ID('dbo.tblStudent')
ORDER BY ix.index_id;

-- 1b. Is the table a heap? A heap makes every non-covered lookup worse and is worth fixing first.
SELECT CASE WHEN EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.tblStudent') AND index_id = 1)
            THEN 'clustered' ELSE 'HEAP — see Section 2' END AS table_organization;

-- 1c. How wide do the names actually get? This decides the computed-column length in Section 3.
--     Sizing the key to the data keeps the index small; an oversized key wastes every page.
SELECT
    MAX(DATALENGTH(lastname))  AS max_lastname_bytes,
    MAX(DATALENGTH(firstname)) AS max_firstname_bytes,
    MAX(DATALENGTH(midname))   AS max_midname_bytes,
    COUNT(*)                   AS rows_total,
    SUM(CASE WHEN DATALENGTH(lastname)  > 100 THEN 1 ELSE 0 END) AS lastname_over_100,
    SUM(CASE WHEN DATALENGTH(firstname) > 100 THEN 1 ELSE 0 END) AS firstname_over_100
FROM dbo.tblStudent;

-- 1d. Baseline the query you are trying to fix, so the improvement is measured rather than assumed.
SET STATISTICS IO, TIME ON;
SELECT TOP (50) idnumber, lastname, firstname, email, phone, LastCleared, AccountBalance, cCode, ClearedCurrentSession
FROM dbo.tblStudent
WHERE lastname LIKE '%son%'
ORDER BY lastname, firstname, idnumber;
SET STATISTICS IO, TIME OFF;
-- Record the "logical reads" figure. That is the number Section 3 or 4 has to move.


/* ---------------------------------------------------------------------------------------------
   SECTION 2 — If 1b says HEAP: give the table a clustered index first.
   Everything else is built on this. idnumber is unique and is the natural key.
   Skip this section entirely if the table is already clustered.
   --------------------------------------------------------------------------------------------- */

-- CREATE UNIQUE CLUSTERED INDEX CIX_tblStudent_idnumber
--     ON dbo.tblStudent (idnumber)
--     WITH (DATA_COMPRESSION = PAGE, FILLFACTOR = 95, SORT_IN_TEMPDB = ON);
--
-- Rebuilding 39k rows takes seconds, but it holds a schema-modification lock for the duration:
-- run it in a maintenance window unless the edition supports ONLINE = ON (Enterprise, or
-- Standard 2016 SP1+ for some operations).


/* ---------------------------------------------------------------------------------------------
   SECTION 3 — Option A (PREFERRED): narrow the columns themselves, then index them.

   Changing lastname/firstname from varchar(MAX) to a real length is the better fix, and it is
   better for a reason worth stating: it does not change the SHAPE of the table. No column is added
   or removed, so `SELECT *` returns exactly what it returned before, and a typed DataSet in the
   legacy C# JADI site keeps binding. The persisted-computed-column approach in Section 3-ALT adds
   columns, which is precisely the thing that can break a `SELECT *` consumer.

   It is also better on the merits:
     • the application needs NO code change — its query already filters `S.lastname`
     • rows get narrower: varchar(MAX) values over 8,000 bytes live off-row in LOB pages, and even
       short ones carry MAX-column overhead. Every scan of this table gets cheaper, not just search
     • one less concept to maintain; nothing to keep in sync

   What it costs: a size-reducing ALTER rewrites the table and holds a schema-modification lock for
   the duration. At 39,361 rows that is seconds, not minutes — but it is an outage on this table
   while it runs, so do it in a window, with a backup, not at 10 a.m. on a clearance day.

   ⚠ RUN 3a FIRST. If a single name exceeds the chosen length the ALTER fails outright with
   "String or binary data would be truncated" — it does not silently trim. That failure is the
   safe outcome; the unsafe one is picking 40 without looking.
   --------------------------------------------------------------------------------------------- */

-- 3a. Does the data fit? Run this before choosing the length.
SELECT
    MAX(DATALENGTH(lastname))                                    AS max_lastname,
    MAX(DATALENGTH(firstname))                                   AS max_firstname,
    MAX(DATALENGTH(midname))                                     AS max_midname,
    SUM(CASE WHEN DATALENGTH(lastname)  > 40 THEN 1 ELSE 0 END)  AS lastname_over_40,
    SUM(CASE WHEN DATALENGTH(firstname) > 40 THEN 1 ELSE 0 END)  AS firstname_over_40,
    SUM(CASE WHEN DATALENGTH(midname)   > 40 THEN 1 ELSE 0 END)  AS midname_over_40
FROM dbo.tblStudent;

-- See the offenders before deciding whether to widen the target or clean the data:
SELECT TOP (50) idnumber, DATALENGTH(lastname) AS len, lastname
FROM dbo.tblStudent
WHERE DATALENGTH(lastname) > 40
ORDER BY DATALENGTH(lastname) DESC;

/*  ON 40 SPECIFICALLY — it is probably fine, and I would still take 60.

    40 characters holds essentially every surname you will meet, and the index-size difference
    between 40 and 60 here is trivial: 39k rows x 20 extra bytes is under 1 MB, and the index is
    only ever scanned or seeked, never sorted in memory at a size where it matters.

    What is NOT trivial is discovering in two years that a hyphenated or compound surname —
    "Fernández de la Vega Sanz", a married double-barrelled name, a transliterated name with
    diacritics expanded — will not save, and that fixing it means another locking ALTER on a table
    the legacy app writes to. Jenzabar's own name fields are typically 25-50; matching or slightly
    exceeding the widest upstream source is the safe choice.

    My recommendation: lastname varchar(60), firstname varchar(60), midname varchar(40) —
    unless 3a shows real data above that, in which case size from the data plus headroom.
    If you prefer to stay at 40, the DDL is identical; only the number changes.            */

-- 3b. Check what would block the ALTER. A schema-bound view, a constraint or an index on these
--     columns must be dropped and recreated around it. (VIEW_OURM_FCA selects these columns but is
--     not schema-bound, so it is unaffected — confirm with this, do not assume.)
SELECT o.name AS referencing_object, o.type_desc, d.is_schema_bound_reference
FROM sys.sql_expression_dependencies d
JOIN sys.objects o ON o.object_id = d.referencing_id
WHERE d.referenced_id = OBJECT_ID('dbo.tblStudent')
  AND (d.referenced_minor_id = 0 OR d.referenced_minor_id IN (
        SELECT column_id FROM sys.columns WHERE object_id = OBJECT_ID('dbo.tblStudent')
          AND name IN ('lastname','firstname','midname')))
ORDER BY d.is_schema_bound_reference DESC, o.name;

-- 3c. The ALTER. One column at a time; each is a separate rewrite.
--     NOT NULL / NULL must be restated — omitting it makes the column nullable regardless of what
--     it was, which is a silent schema change nobody asked for. These three are nullable today.

ALTER TABLE dbo.tblStudent ALTER COLUMN lastname  varchar(60) NULL;
GO
ALTER TABLE dbo.tblStudent ALTER COLUMN firstname varchar(60) NULL;
GO
ALTER TABLE dbo.tblStudent ALTER COLUMN midname   varchar(40) NULL;
GO

-- 3d. Reclaim the space the MAX columns were holding. The ALTER frees rows logically but leaves
--     the pages allocated; this compacts them and rebuilds statistics in one pass.
ALTER INDEX ALL ON dbo.tblStudent REBUILD WITH (FILLFACTOR = 95, SORT_IN_TEMPDB = ON);
GO

-- 3e. The covering index — now directly on the real columns, no computed column in sight.
--     KEY:     last name, then first name — the Bio Spec's search order AND its sort order, so one
--              index answers the filter and the ORDER BY with no sort operator.
--     INCLUDE: exactly the Bio Spec 1.3 result columns, so the query never reads the base table.
CREATE NONCLUSTERED INDEX IX_tblStudent_name_search
    ON dbo.tblStudent (lastname, firstname)
    INCLUDE (idnumber, email, phone, LastCleared, AccountBalance, cCode, ClearedCurrentSession)
    WITH (DATA_COMPRESSION = PAGE, FILLFACTOR = 90, SORT_IN_TEMPDB = ON);
GO

-- 3f. Optional, as in the original script — add only when something actually reads them.
-- CREATE NONCLUSTERED INDEX IX_tblStudent_firstname_search
--     ON dbo.tblStudent (firstname, lastname)
--     INCLUDE (idnumber, email, phone, LastCleared, AccountBalance, cCode, ClearedCurrentSession)
--     WITH (DATA_COMPRESSION = PAGE, FILLFACTOR = 90);
-- CREATE NONCLUSTERED INDEX IX_tblStudent_pid ON dbo.tblStudent (pid) INCLUDE (idnumber);

UPDATE STATISTICS dbo.tblStudent WITH FULLSCAN;
GO

/*  AFTER 3c, CHECK THE WRITERS. Narrowing a column moves the failure from "stores anything" to
    "rejects anything too long". Anywhere that WRITES a name must now handle it:
      • the legacy C# JADI setup site — its text boxes should cap at the new length
      • any import or ETL that loads names from Jenzabar
    A load that used to succeed silently will now raise error 8152/2628 (truncation). That is the
    correct behaviour — but find it on purpose, rather than during a registration run.        */


/* ---------------------------------------------------------------------------------------------
   SECTION 3-ALT — Option A-fallback: persisted computed columns, WITHOUT altering the base columns.
   Use this ONLY if the ALTER in 3c is refused — an owner who will not accept the lock window, or
   a writer that genuinely needs unbounded names.

   ⚠ This ADDS columns, so `SELECT *` consumers change shape. That is the risk Section 3 avoids.
   --------------------------------------------------------------------------------------------- */

-- ALTER TABLE dbo.tblStudent
--     ADD lastname_srch  AS CONVERT(varchar(60), LEFT(lastname,  60)) PERSISTED;
-- ALTER TABLE dbo.tblStudent
--     ADD firstname_srch AS CONVERT(varchar(60), LEFT(firstname, 60)) PERSISTED;
-- GO
--
-- CREATE NONCLUSTERED INDEX IX_tblStudent_name_search
--     ON dbo.tblStudent (lastname_srch, firstname_srch)
--     INCLUDE (idnumber, email, phone, LastCleared, AccountBalance, cCode, ClearedCurrentSession)
--     WITH (DATA_COMPRESSION = PAGE, FILLFACTOR = 90, SORT_IN_TEMPDB = ON);
-- GO
--
-- With this variant the APPLICATION MUST CHANGE: the predicate has to name lastname_srch, or the
-- index is never used. With Section 3 it does not change at all.


/* ---------------------------------------------------------------------------------------------
   SECTION 4 — Option B: no DDL on dbo at all.
   A narrow search table in schema [dash], which the jadi_dash login already owns and which is
   explicitly denied writes on dbo (A-21, db/grants/jadi_dash.sql). Nothing about tblStudent
   changes, so the legacy site cannot be affected.

   Cost: the copy is as fresh as its last refresh. At 39k rows a full rebuild is about a second,
   so a 5-minute schedule keeps it effectively live. Search hits this table; the profile still
   reads tblStudent directly, so what a user opens is never stale.
   --------------------------------------------------------------------------------------------- */

-- IF SCHEMA_ID('dash') IS NULL EXEC('CREATE SCHEMA dash');
-- GO
--
-- IF OBJECT_ID('dash.StudentSearch') IS NULL
-- BEGIN
--     CREATE TABLE dash.StudentSearch (
--         idnumber              varchar(50)   NOT NULL,
--         lastname              varchar(100)  NULL,
--         firstname             varchar(100)  NULL,
--         email                 varchar(128)  NULL,
--         phone                 varchar(50)   NULL,
--         cCode                 varchar(50)   NULL,
--         LastCleared           varchar(50)   NULL,
--         AccountBalance        money         NULL,
--         ClearedCurrentSession bit           NULL,
--         RefreshedAt           datetime2(0)  NOT NULL CONSTRAINT DF_StudentSearch_RefreshedAt DEFAULT SYSUTCDATETIME(),
--         CONSTRAINT PK_StudentSearch PRIMARY KEY CLUSTERED (idnumber)
--     );
--
--     CREATE NONCLUSTERED INDEX IX_StudentSearch_name
--         ON dash.StudentSearch (lastname, firstname)
--         INCLUDE (idnumber, email, phone, cCode, LastCleared, AccountBalance, ClearedCurrentSession);
-- END
-- GO
--
-- CREATE OR ALTER PROCEDURE dash.usp_RefreshStudentSearch
-- AS
-- BEGIN
--     SET NOCOUNT ON;
--     -- MERGE in one statement: readers never see a half-empty table, and only changed rows are written.
--     MERGE dash.StudentSearch WITH (HOLDLOCK) AS T
--     USING (
--         SELECT idnumber,
--                lastname  = CONVERT(varchar(100), LEFT(lastname,  100)),
--                firstname = CONVERT(varchar(100), LEFT(firstname, 100)),
--                email, phone, cCode, LastCleared, AccountBalance, ClearedCurrentSession
--         FROM dbo.tblStudent
--     ) AS S ON S.idnumber = T.idnumber
--     WHEN MATCHED AND EXISTS (
--             SELECT S.lastname, S.firstname, S.email, S.phone, S.cCode, S.LastCleared, S.AccountBalance, S.ClearedCurrentSession
--             EXCEPT
--             SELECT T.lastname, T.firstname, T.email, T.phone, T.cCode, T.LastCleared, T.AccountBalance, T.ClearedCurrentSession)
--         THEN UPDATE SET T.lastname = S.lastname, T.firstname = S.firstname, T.email = S.email, T.phone = S.phone,
--                         T.cCode = S.cCode, T.LastCleared = S.LastCleared, T.AccountBalance = S.AccountBalance,
--                         T.ClearedCurrentSession = S.ClearedCurrentSession, T.RefreshedAt = SYSUTCDATETIME()
--     WHEN NOT MATCHED BY TARGET
--         THEN INSERT (idnumber, lastname, firstname, email, phone, cCode, LastCleared, AccountBalance, ClearedCurrentSession)
--              VALUES (S.idnumber, S.lastname, S.firstname, S.email, S.phone, S.cCode, S.LastCleared, S.AccountBalance, S.ClearedCurrentSession)
--     WHEN NOT MATCHED BY SOURCE
--         THEN DELETE;   -- a student removed from tblStudent must not linger in search results
-- END
-- GO
--
-- Schedule it as a job in the application's own worker (jobs/definitions.ts) rather than SQL Agent,
-- so its status shows on the Job Status screen with everything else.


/* ---------------------------------------------------------------------------------------------
   SECTION 5 — What the application must do to get the benefit.

   1. SELECT ONLY THE SEARCH COLUMNS. The index covers the Bio Spec 1.3 result set and nothing
      more. A `SELECT *` — or adding one more column to the search result — abandons the covering
      index and goes back to the base table. The app already selects exactly this list
      (src/server/repositories/mssql/student-sql.ts, QS.searchByName).

   2. FILTER ON THE INDEXED COLUMN. With Section 3 (the ALTER), the application's existing
      predicate `WHERE S.lastname LIKE @last ESCAPE '\'` uses the new index as-is — no change.
      With Section 3-ALT (computed columns), the predicate must name lastname_srch instead, or the
      index is never touched.

   3. PREFER PREFIX, ALLOW CONTAINS. This is where the real win is. A prefix search seeks; a
      contains search can only scan:

          LIKE 'smi%'    ->  index seek, a handful of reads
          LIKE '%smi%'   ->  index scan, ~2.5 MB — fast here, but linear in table growth

      Recommended query shape: search prefix-first, and fall back to contains only when the prefix
      returns nothing. Most searches are someone typing the start of a surname, so most searches
      then seek:

          WHERE S.lastname_srch LIKE @prefix ESCAPE '\'          -- 'smi%'
          ...and if @@ROWCOUNT = 0, retry with @contains         -- '%smi%'

      I have NOT changed the application to do this: the Bio Spec specifies `like <%lastname%>`,
      and quietly narrowing a documented search is a behaviour change, not an optimization. Say the
      word and I will add it as a "starts with / contains anywhere" choice on the search form,
      defaulting to starts-with.

   4. DO NOT WRAP THE COLUMN IN A FUNCTION. `WHERE UPPER(lastname_srch) LIKE ...` makes the index
      unusable. Case-insensitivity comes from the column's collation, which is already
      case-insensitive on this database — the application relies on that rather than on UPPER().

   5. FULL-TEXT IS NOT THE ANSWER HERE. A full-text index does support varchar(MAX), but CONTAINS
      matches whole words and prefixes only: it will not find 'son' inside 'Anderson', which is the
      case the Bio Spec's `%lastname%` exists to serve. It would also add a service dependency for
      39k rows that a 2.5 MB index handles outright.


   SECTION 6 — Verification. Re-run 1d afterwards and compare logical reads.

       SET STATISTICS IO ON;
       SELECT TOP (50) idnumber, lastname, firstname, email, phone, LastCleared, AccountBalance, cCode, ClearedCurrentSession
       FROM dbo.tblStudent
       WHERE lastname_srch LIKE '%son%'
       ORDER BY lastname_srch, firstname_srch, idnumber;
       SET STATISTICS IO OFF;

   Expect the plan to show an Index Scan (or Seek, for a prefix) on IX_tblStudent_name_search with
   no Key Lookup. A Key Lookup means the SELECT list drifted outside the INCLUDE list — fix the
   query rather than widening the index, unless the new column is genuinely needed in results.

       SELECT ix.name, s.user_seeks, s.user_scans, s.user_lookups, s.user_updates, s.last_user_seek
       FROM sys.dm_db_index_usage_stats s
       JOIN sys.indexes ix ON ix.object_id = s.object_id AND ix.index_id = s.index_id
       WHERE s.object_id = OBJECT_ID('dbo.tblStudent') AND s.database_id = DB_ID();

   Check that again after a week: an index with zero seeks and scans but a rising user_updates
   count is pure cost, and should be dropped.

       -- Rollback, in the order that works:
       -- DROP INDEX IX_tblStudent_name_search ON dbo.tblStudent;
       -- ALTER TABLE dbo.tblStudent DROP COLUMN lastname_srch, firstname_srch;
   ============================================================================================= */
