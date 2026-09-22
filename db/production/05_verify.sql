/*===========================================================================
  05_verify.sql — post-deployment verification
  ---------------------------------------------------------------------------
  Read-only. Run after 01-04. Every section prints PASS or FAIL; nothing is
  changed. Run it again any time to audit the production dash schema.

  RUN AS:  sysadmin, on the PRODUCTION instance
  RUN VIA: sqlcmd -S PRODSQL -d ousadb -E -b -I -i 05_verify.sql
===========================================================================*/
SET NOCOUNT ON;
GO

USE [ousadb];
GO

/*--- DATABASE GUARD ------------------------------------------------------
  Everything below must run in ousadb. This works whether or not SSMS is in
  SQLCMD Mode: if the USE above did not take effect, NOEXEC stops every later
  batch in this session instead of writing objects into the wrong database.
  Turned off again at the end of the file.
-------------------------------------------------------------------------*/
IF DB_NAME() <> N'ousadb'
BEGIN
    RAISERROR('ABORTED: connected to [%s], not [ousadb]. Nothing was changed. Reconnect to ousadb and re-run.', 16, 1, @@SERVERNAME);
    SET NOEXEC ON;
END
GO

PRINT '=== 1. Objects ===';
;WITH expected(name) AS (SELECT * FROM (VALUES
  ('SchemaMigration'),('Job'),('JobRun'),('Snapshot'),('Setting'),('AuditEvent'),
  ('User'),('Role'),('Permission'),('RolePermission'),('UserRole'),('UserPermission'),
  ('Session'),('CredentialToken'),('SemesterSprint'),('OperatorProfile')) v(name))
SELECT e.name AS table_name,
       CASE WHEN t.object_id IS NULL THEN 'FAIL - MISSING' ELSE 'PASS' END AS status
FROM expected e
LEFT JOIN sys.tables t ON t.name = e.name AND SCHEMA_NAME(t.schema_id) = 'dash'
ORDER BY status DESC, e.name;
GO

PRINT '=== 2. Migration ledger ===';
SELECT name, appliedAt FROM dash.SchemaMigration ORDER BY name;
GO

PRINT '=== 3. Row counts ===';
SELECT t.name AS table_name, SUM(p.rows) AS row_count
FROM sys.tables t
JOIN sys.partitions p ON p.object_id = t.object_id AND p.index_id IN (0,1)
WHERE SCHEMA_NAME(t.schema_id) = 'dash'
GROUP BY t.name ORDER BY t.name;
GO

PRINT '=== 3b. Against the export manifest (if dash_import is still attached) ===';
IF DB_ID('dash_import') IS NOT NULL
BEGIN
    EXEC('
    SELECT m.table_name,
           m.row_count            AS exported,
           ISNULL(a.row_count, 0) AS imported,
           CASE WHEN m.table_name = ''Session''    THEN ''SKIPPED BY DESIGN''
                WHEN ISNULL(a.row_count,0) >= m.row_count THEN ''PASS''
                ELSE ''CHECK'' END AS status
    FROM dash_import.dbo._ExportManifest m
    LEFT JOIN (
        SELECT t.name AS table_name, SUM(p.rows) AS row_count
        FROM sys.tables t JOIN sys.partitions p
          ON p.object_id = t.object_id AND p.index_id IN (0,1)
        WHERE SCHEMA_NAME(t.schema_id) = ''dash''
        GROUP BY t.name
    ) a ON a.table_name = m.table_name
    ORDER BY status DESC, m.table_name;');
END
ELSE PRINT 'dash_import not attached - skipped';
GO

PRINT '=== 4. Seed integrity ===';
SELECT CASE WHEN COUNT(*) = 3  THEN 'PASS' ELSE 'FAIL' END AS roles_3,       COUNT(*) AS n FROM dash.[Role];
SELECT CASE WHEN COUNT(*) = 15 THEN 'PASS' ELSE 'FAIL' END AS permissions_15,COUNT(*) AS n FROM dash.[Permission];
SELECT CASE WHEN COUNT(*) = 24 THEN 'PASS' ELSE 'FAIL' END AS rolePerms_24,  COUNT(*) AS n FROM dash.RolePermission;
SELECT CASE WHEN COUNT(*) = 10 THEN 'PASS' ELSE 'FAIL' END AS jobs_10,       COUNT(*) AS n FROM dash.Job;
GO

PRINT '=== 5. At least one usable administrator ===';
SELECT CASE WHEN COUNT(*) >= 1 THEN 'PASS' ELSE 'FAIL - no active administrator' END AS admin_present,
       COUNT(*) AS n
FROM dash.[User] u
JOIN dash.UserRole ur ON ur.userId = u.id AND ur.roleKey = 'ADMINISTRATOR'
WHERE u.status = 'ACTIVE' AND u.passwordHash IS NOT NULL;

SELECT username, email, status, mustChangePassword, lastSignInAt
FROM dash.[User] u
JOIN dash.UserRole ur ON ur.userId = u.id AND ur.roleKey = 'ADMINISTRATOR'
ORDER BY username;
GO

PRINT '=== 6. Referential integrity ===';
SELECT 'Snapshot -> JobRun' AS check_name,
       CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS status, COUNT(*) AS orphans
FROM dash.Snapshot s LEFT JOIN dash.JobRun r ON r.id = s.jobRunId WHERE r.id IS NULL;

SELECT 'JobRun -> Job', CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END, COUNT(*)
FROM dash.JobRun r LEFT JOIN dash.Job j ON j.[key] = r.jobKey WHERE j.[key] IS NULL;

SELECT 'No job left locked', CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END, COUNT(*)
FROM dash.Job WHERE lockedAt IS NOT NULL;

SELECT 'No run left RUNNING', CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END, COUNT(*)
FROM dash.JobRun WHERE status = 'RUNNING';
GO

PRINT '=== 7. Grants - the A-21 promise ===';
EXECUTE AS USER = 'jadi_dash';

SELECT 'jadi_dash can write dash' AS check_name,
       CASE WHEN COUNT(*) >= 4 THEN 'PASS' ELSE 'FAIL' END AS status
FROM fn_my_permissions('dash', 'SCHEMA')
WHERE permission_name IN ('INSERT','UPDATE','DELETE','ALTER');

SELECT 'jadi_dash CANNOT write dbo.tblStudent' AS check_name,
       CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL - DENY missing' END AS status
FROM fn_my_permissions('dbo.tblStudent', 'OBJECT')
WHERE permission_name IN ('INSERT','UPDATE','DELETE','ALTER');

SELECT 'jadi_dash CAN read dbo.tblStudent' AS check_name,
       CASE WHEN COUNT(*) >= 1 THEN 'PASS' ELSE 'FAIL' END AS status
FROM fn_my_permissions('dbo.tblStudent', 'OBJECT')
WHERE permission_name = 'SELECT';

REVERT;
GO

PRINT '=== 8. Staging-derived history still present? (informational) ===';
SELECT COUNT(*) AS snapshots, MIN(capturedAt) AS oldest, MAX(capturedAt) AS newest,
       COUNT(DISTINCT sourceProvider) AS providers
FROM dash.Snapshot;
SELECT DISTINCT sourceProvider FROM dash.Snapshot;
GO

PRINT '05_verify.sql complete - review any FAIL above before starting the services';
GO

SET NOEXEC OFF;
GO
