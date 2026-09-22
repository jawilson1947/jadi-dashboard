/*===========================================================================
  99_undo_dash_in_master.sql — remove a dash schema created in the wrong DB
  ---------------------------------------------------------------------------
  Recovery for the case where 02_schema.sql ran with its `USE [ousadb]`
  skipped (SSMS with SQLCMD Mode off turned the ":on error exit" line above
  it into a syntax error, killing that batch) and built the whole dash schema
  in [master] instead.

  RUN AS:  sysadmin, on the affected instance
  SAFETY:  Section 1 only REPORTS. Read it, satisfy yourself that the tables
           in master are the stray ones and hold no data you need, then
           uncomment section 2. Nothing is dropped until you do.

  This only ever touches [master]. It cannot affect ousadb.
===========================================================================*/
SET NOCOUNT ON;
GO

USE [master];
GO

IF DB_NAME() <> N'master'
BEGIN
    RAISERROR('ABORTED: not connected to [master].', 16, 1);
    SET NOEXEC ON;
END
GO

/*--- 1. REPORT ------------------------------------------------------------*/
PRINT '=== dash tables in [master] (should be none) ===';
SELECT t.name AS table_name, SUM(p.rows) AS row_count
FROM sys.tables t
LEFT JOIN sys.partitions p ON p.object_id = t.object_id AND p.index_id IN (0,1)
WHERE SCHEMA_NAME(t.schema_id) = 'dash'
GROUP BY t.name ORDER BY t.name;

PRINT '=== dash tables in [ousadb] (where they belong) ===';
SELECT t.name AS table_name, SUM(p.rows) AS row_count
FROM ousadb.sys.tables t
LEFT JOIN ousadb.sys.partitions p ON p.object_id = t.object_id AND p.index_id IN (0,1)
WHERE t.schema_id = (SELECT schema_id FROM ousadb.sys.schemas WHERE name = 'dash')
GROUP BY t.name ORDER BY t.name;
GO

/*  Expect: master lists 16 tables with 0 rows (except Role/Permission/
    RolePermission, seeded by the MERGE), and ousadb lists nothing yet.
    If any master table holds rows you care about, STOP and copy them out
    first — this is the only warning you get.                              */

/*--- 2. DROP (uncomment the whole block once section 1 looks right) -------

DECLARE @sql nvarchar(max) = N'';

-- Foreign keys first, so table order does not matter.
SELECT @sql = @sql + N'ALTER TABLE dash.' + QUOTENAME(OBJECT_NAME(parent_object_id))
            + N' DROP CONSTRAINT ' + QUOTENAME(name) + N';' + CHAR(10)
FROM sys.foreign_keys
WHERE SCHEMA_NAME(schema_id) = 'dash';

SELECT @sql = @sql + N'DROP TABLE dash.' + QUOTENAME(name) + N';' + CHAR(10)
FROM sys.tables
WHERE SCHEMA_NAME(schema_id) = 'dash';

PRINT @sql;
EXEC sp_executesql @sql;

IF SCHEMA_ID('dash') IS NOT NULL
BEGIN
    EXEC('DROP SCHEMA dash');
    PRINT 'dropped schema dash from master';
END

-- 01_login_and_grants.sql does not create a user in master, but a stray run
-- might have. Remove it only if it exists and owns nothing.
-- IF USER_ID('jadi_dash') IS NOT NULL DROP USER [jadi_dash];

--------------------------------------------------------------------------*/

SET NOEXEC OFF;
GO
