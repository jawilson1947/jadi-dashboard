/*===========================================================================
  00_export_from_staging.sql — package the staging dash schema for transfer
  ---------------------------------------------------------------------------
  Copies every dash table into a scratch database and backs it up, so the
  content can be carried to production without a linked server.

  SELECT ... INTO is used deliberately: no dash table uses an IDENTITY column
  (all primary keys are uniqueidentifier or varchar), so the round trip is
  lossless and needs no IDENTITY_INSERT.

  RUN AS:  sysadmin, on the STAGING instance
  RUN VIA: sqlcmd -S STAGINGSQL -E -b -I -i 00_export_from_staging.sql
           In SSMS instead? Turn ON SQLCMD Mode first:
           Query menu -> SQLCMD Mode. Without it the ":" directives below are
           a syntax error and the script runs past its own error handling.
  RERUN:   safe — drops and rebuilds the scratch database each time

  Output:  <instance default backup folder>\dash_export.bak
           The folder is resolved at run time, so no path is hard-coded.
           Override it by setting @BackupDir in section 4.
===========================================================================*/
SET NOCOUNT ON;
SET XACT_ABORT ON;
GO

:on error exit

/*--- 1. Remove any previous scratch database ------------------------------
  Never SET SINGLE_USER here. A failed earlier run can leave the database in
  single-user mode with one connection already holding it (often an SSMS
  Object Explorer node), and then ALTER DATABASE itself fails with msg 5064 —
  the exact deadlock this script hit before. Instead: force MULTI_USER if
  needed, kill every session using the database, then drop it.
--------------------------------------------------------------------------*/
USE [master];
GO

IF DB_ID('dash_export') IS NOT NULL
BEGIN
    PRINT 'existing dash_export found - removing';

    -- Kill everything connected to it, including this session's siblings.
    DECLARE @kill nvarchar(max) = N'';
    SELECT @kill = @kill + N'KILL ' + CAST(session_id AS nvarchar(10)) + N'; '
    FROM sys.dm_exec_sessions
    WHERE database_id = DB_ID('dash_export') AND session_id <> @@SPID;

    IF LEN(@kill) > 0
    BEGIN
        PRINT 'terminating ' + CAST(LEN(@kill) - LEN(REPLACE(@kill, ';', '')) AS varchar(10))
              + ' connection(s) to dash_export';
        EXEC sp_executesql @kill;
    END

    -- If a previous run left it single-user, restore multi-user before dropping.
    IF EXISTS (SELECT 1 FROM sys.databases
               WHERE name = 'dash_export' AND user_access_desc <> 'MULTI_USER')
        ALTER DATABASE [dash_export] SET MULTI_USER WITH ROLLBACK IMMEDIATE;

    DROP DATABASE [dash_export];
    PRINT 'dropped dash_export';
END
GO

CREATE DATABASE [dash_export];
ALTER DATABASE [dash_export] SET RECOVERY SIMPLE;
GO

/*--- 2. Copy the content -------------------------------------------------*/
USE [dash_export];
GO

SELECT * INTO dbo.[Role]          FROM ousadb.dash.[Role];
SELECT * INTO dbo.[Permission]    FROM ousadb.dash.[Permission];
SELECT * INTO dbo.RolePermission  FROM ousadb.dash.RolePermission;
SELECT * INTO dbo.[User]          FROM ousadb.dash.[User];
SELECT * INTO dbo.UserRole        FROM ousadb.dash.UserRole;
SELECT * INTO dbo.UserPermission  FROM ousadb.dash.UserPermission;
SELECT * INTO dbo.[Session]       FROM ousadb.dash.[Session];
SELECT * INTO dbo.CredentialToken FROM ousadb.dash.CredentialToken;
SELECT * INTO dbo.Job             FROM ousadb.dash.Job;
SELECT * INTO dbo.JobRun          FROM ousadb.dash.JobRun;
SELECT * INTO dbo.Snapshot        FROM ousadb.dash.Snapshot;
SELECT * INTO dbo.Setting         FROM ousadb.dash.Setting;
SELECT * INTO dbo.AuditEvent      FROM ousadb.dash.AuditEvent;
SELECT * INTO dbo.SemesterSprint  FROM ousadb.dash.SemesterSprint;
SELECT * INTO dbo.OperatorProfile FROM ousadb.dash.OperatorProfile;
GO

/* dash.SchemaMigration is deliberately NOT exported: 02_schema.sql writes
   production's own ledger. Copying staging's would be meaningless. */

/*--- 3. Manifest (05_verify.sql checks the import against this) ----------*/
SELECT t.name AS table_name, SUM(p.rows) AS row_count
INTO dbo._ExportManifest
FROM sys.tables t
JOIN sys.partitions p ON p.object_id = t.object_id AND p.index_id IN (0,1)
WHERE t.name <> '_ExportManifest'
GROUP BY t.name;
GO

SELECT table_name, row_count FROM dbo._ExportManifest ORDER BY table_name;
GO

/*--- 4. Back it up -------------------------------------------------------
  The path is resolved from the instance's own configured backup folder, so
  it always exists and the SQL Server service account can always write to it.
  Hard-coding 'D:\Backup' is what produced OS error 3 (path not found).

  To use a different folder, set @BackupDir below to a path that EXISTS and
  that the SQL Server SERVICE ACCOUNT can write to — not your own account,
  and not a mapped drive letter, which the service cannot see.
--------------------------------------------------------------------------*/
USE [master];
GO

DECLARE @BackupDir  nvarchar(512) = CAST(SERVERPROPERTY('InstanceDefaultBackupPath') AS nvarchar(512));
DECLARE @BackupFile nvarchar(1024);

IF @BackupDir IS NULL
BEGIN
    EXEC master.dbo.xp_instance_regread
        N'HKEY_LOCAL_MACHINE', N'Software\Microsoft\MSSQLServer\MSSQLServer',
        N'BackupDirectory', @BackupDir OUTPUT;
END

IF @BackupDir IS NULL
    THROW 50010, 'Could not resolve the default backup folder. Set @BackupDir explicitly.', 1;

IF RIGHT(@BackupDir, 1) <> '\' SET @BackupDir = @BackupDir + '\';
SET @BackupFile = @BackupDir + N'dash_export.bak';

PRINT 'backing up to: ' + @BackupFile;

DECLARE @sql nvarchar(max) =
    N'BACKUP DATABASE [dash_export] TO DISK = ' + QUOTENAME(@BackupFile, '''') +
    N' WITH INIT, CHECKSUM, COMPRESSION, STATS = 10;' +
    N'RESTORE VERIFYONLY FROM DISK = ' + QUOTENAME(@BackupFile, '''') + N' WITH CHECKSUM;';
EXEC sp_executesql @sql;

PRINT '00_export_from_staging.sql complete';
PRINT 'Copy this file to the production server: ' + @BackupFile;
GO
