/*===========================================================================
  04_import_from_staging.sql — load the exported content into production
  ---------------------------------------------------------------------------
  Restores the package produced by 00_export_from_staging.sql into a scratch
  database, then copies the rows into dash.* in foreign-key order.

  RUN AS:  sysadmin, on the PRODUCTION instance
  RUN VIA: sqlcmd -S PRODSQL -d ousadb -E -b -I -i 04_import_from_staging.sql
           In SSMS instead? Turn ON SQLCMD Mode (Query -> SQLCMD Mode) or the
           ":" directives are a syntax error and error handling is skipped.
  RERUN:   safe — every insert is guarded by NOT EXISTS on the primary key.
           Rerunning adds rows that are missing; it never updates or
           duplicates rows that are already there.

  PREREQUISITES: 01, 02 and 03 have run. The application services are STOPPED.

  ---------------------------------------------------------------------------
  READ THIS ONCE:

  This imports staging's Snapshot, JobRun and AuditEvent rows as chosen.
  Those snapshots were captured against staging TEST data (FINDINGS: staging
  is SQL Server 2019 Developer holding test data; DNC = 73, DNR = 111 there).
  Once imported, the dashboard and the Historical Analysis module will render
  them as production history, indistinguishable from real figures, and the
  worker's startup catch-up will NOT re-capture a family that already has a
  SUCCEEDED run.

  Section 6 at the end purges them in one statement if you decide against it.
  Deciding later is fine; deciding never is the risk.
  ---------------------------------------------------------------------------
===========================================================================*/
SET NOCOUNT ON;
SET XACT_ABORT ON;
GO

/*--- 1. Restore the package ----------------------------------------------*/
USE [master];
GO

/* Never SET SINGLE_USER to drop a scratch database: a failed earlier run can
   leave it single-user with one connection already held (often an SSMS Object
   Explorer node), and ALTER DATABASE then fails with msg 5064. Kill the
   sessions, force MULTI_USER, then drop. */
IF DB_ID('dash_import') IS NOT NULL
BEGIN
    DECLARE @kill nvarchar(max) = N'';
    SELECT @kill = @kill + N'KILL ' + CAST(session_id AS nvarchar(10)) + N'; '
    FROM sys.dm_exec_sessions
    WHERE database_id = DB_ID('dash_import') AND session_id <> @@SPID;
    IF LEN(@kill) > 0 EXEC sp_executesql @kill;

    IF EXISTS (SELECT 1 FROM sys.databases
               WHERE name = 'dash_import' AND user_access_desc <> 'MULTI_USER')
        ALTER DATABASE [dash_import] SET MULTI_USER WITH ROLLBACK IMMEDIATE;

    DROP DATABASE [dash_import];
    PRINT 'dropped previous dash_import';
END
GO

/* ---- PATHS: set these three to values that EXIST on THIS server ---------
   @BakFile   where you copied dash_export.bak
   @DataDir / @LogDir   the instance's data and log folders

   All three must be writable by the SQL Server SERVICE ACCOUNT, not by your
   own login, and must not be mapped drive letters (the service cannot see
   them). The defaults below are resolved from the instance itself.

   If the logical file names inside the backup are not 'dash_export' and
   'dash_export_log', run this first and use what it reports:
       RESTORE FILELISTONLY FROM DISK = '<path to dash_export.bak>';
------------------------------------------------------------------------- */
DECLARE @BakFile nvarchar(1024);
DECLARE @DataDir nvarchar(512) = CAST(SERVERPROPERTY('InstanceDefaultDataPath') AS nvarchar(512));
DECLARE @LogDir  nvarchar(512) = CAST(SERVERPROPERTY('InstanceDefaultLogPath')  AS nvarchar(512));
DECLARE @BakDir  nvarchar(512) = CAST(SERVERPROPERTY('InstanceDefaultBackupPath') AS nvarchar(512));

IF RIGHT(@BakDir,1)  <> '\' SET @BakDir  = @BakDir  + '\';
IF RIGHT(@DataDir,1) <> '\' SET @DataDir = @DataDir + '\';
IF RIGHT(@LogDir,1)  <> '\' SET @LogDir  = @LogDir  + '\';

SET @BakFile = @BakDir + N'dash_export.bak';   -- <- override if copied elsewhere

PRINT 'restoring from: ' + @BakFile;

DECLARE @sql nvarchar(max) =
  N'RESTORE DATABASE [dash_import] FROM DISK = ' + QUOTENAME(@BakFile, '''') +
  N' WITH RECOVERY, CHECKSUM, STATS = 10,' +
  N'  MOVE ''dash_export''     TO ' + QUOTENAME(@DataDir + N'dash_import.mdf', '''') + N',' +
  N'  MOVE ''dash_export_log'' TO ' + QUOTENAME(@LogDir  + N'dash_import_log.ldf', '''') + N';';
EXEC sp_executesql @sql;
GO

/*--- 2. Reference data ---------------------------------------------------*/
USE [ousadb];
GO

/*--- DATABASE GUARD: must be in ousadb ---------------------------------
  Works whether or not SSMS is in SQLCMD Mode. If the USE above did not take
  effect, NOEXEC stops every later batch instead of writing into the wrong
  database.
-------------------------------------------------------------------------*/
IF DB_NAME() <> N'ousadb'
BEGIN
    RAISERROR('ABORTED: not connected to [ousadb]. Nothing was changed.', 16, 1);
    SET NOEXEC ON;
END
GO

BEGIN TRANSACTION;

INSERT INTO dash.[Role] ([key], name, description, isSystem)
SELECT s.[key], s.name, s.description, s.isSystem
FROM dash_import.dbo.[Role] s
WHERE NOT EXISTS (SELECT 1 FROM dash.[Role] t WHERE t.[key] = s.[key]);

INSERT INTO dash.[Permission] ([key], description)
SELECT s.[key], s.description
FROM dash_import.dbo.[Permission] s
WHERE NOT EXISTS (SELECT 1 FROM dash.[Permission] t WHERE t.[key] = s.[key]);

INSERT INTO dash.RolePermission (roleKey, permissionKey)
SELECT s.roleKey, s.permissionKey
FROM dash_import.dbo.RolePermission s
WHERE NOT EXISTS (SELECT 1 FROM dash.RolePermission t
                  WHERE t.roleKey = s.roleKey AND t.permissionKey = s.permissionKey);

/*--- 3. Identity ---------------------------------------------------------
  passwordHash is a scrypt PHC string, so accounts keep their existing
  passwords. The unique constraints on username and email mean a clash with
  an account already created in production will fail this transaction — that
  is intended: resolve it rather than silently picking a winner.
-------------------------------------------------------------------------*/
INSERT INTO dash.[User]
  (id, username, email, displayName, status, passwordHash, passwordSetAt,
   mustChangePassword, failedSignIns, lockedUntil, externalProvider, externalId,
   createdAt, createdById, updatedAt, updatedById, lastSignInAt)
SELECT
   s.id, s.username, s.email, s.displayName, s.status, s.passwordHash, s.passwordSetAt,
   s.mustChangePassword, 0 /* reset lockout counters on arrival */, NULL,
   s.externalProvider, s.externalId,
   s.createdAt, s.createdById, s.updatedAt, s.updatedById, s.lastSignInAt
FROM dash_import.dbo.[User] s
WHERE NOT EXISTS (SELECT 1 FROM dash.[User] t WHERE t.id = s.id);

INSERT INTO dash.UserRole (userId, roleKey, grantedAt, grantedById)
SELECT s.userId, s.roleKey, s.grantedAt, s.grantedById
FROM dash_import.dbo.UserRole s
WHERE NOT EXISTS (SELECT 1 FROM dash.UserRole t
                  WHERE t.userId = s.userId AND t.roleKey = s.roleKey);

INSERT INTO dash.UserPermission (userId, permissionKey, grantedAt, grantedById, expiresAt)
SELECT s.userId, s.permissionKey, s.grantedAt, s.grantedById, s.expiresAt
FROM dash_import.dbo.UserPermission s
WHERE NOT EXISTS (SELECT 1 FROM dash.UserPermission t
                  WHERE t.userId = s.userId AND t.permissionKey = s.permissionKey);

/* dash.[Session] is deliberately NOT imported. Session cookies are HMAC-signed
   with SESSION_SECRET, which differs between staging and production, so an
   imported session can never be presented successfully. Importing them would
   add unusable rows and misleading "active session" counts. Everyone signs in
   again on production — correct behaviour for a new environment. */

/* Outstanding one-time set-password links carry over so an invited user who
   has not yet set a password can still complete it. Expired ones are skipped. */
INSERT INTO dash.CredentialToken (id, userId, tokenHash, purpose, expiresAt, usedAt, createdAt)
SELECT s.id, s.userId, s.tokenHash, s.purpose, s.expiresAt, s.usedAt, s.createdAt
FROM dash_import.dbo.CredentialToken s
WHERE s.usedAt IS NULL AND s.expiresAt > SYSUTCDATETIME()
  AND EXISTS (SELECT 1 FROM dash.[User] u WHERE u.id = s.userId)
  AND NOT EXISTS (SELECT 1 FROM dash.CredentialToken t WHERE t.id = s.id);

/*--- 4. Operational content ---------------------------------------------*/
INSERT INTO dash.Job ([key], name, cronExpression, isEnabled, minIntervalMinutes, lockedAt, lockedBy)
SELECT s.[key], s.name, s.cronExpression, s.isEnabled, s.minIntervalMinutes,
       NULL /* never import a lock */, NULL
FROM dash_import.dbo.Job s
WHERE NOT EXISTS (SELECT 1 FROM dash.Job t WHERE t.[key] = s.[key]);

INSERT INTO dash.JobRun
  (id, jobKey, status, triggeredBy, startedAt, finishedAt, durationMs, rowsProcessed, errorSummary)
SELECT s.id, s.jobKey,
       CASE WHEN s.status = 'RUNNING' THEN 'FAILED' ELSE s.status END,  -- no run survives the move
       s.triggeredBy, s.startedAt, s.finishedAt, s.durationMs, s.rowsProcessed, s.errorSummary
FROM dash_import.dbo.JobRun s
WHERE EXISTS (SELECT 1 FROM dash.Job j WHERE j.[key] = s.jobKey)
  AND NOT EXISTS (SELECT 1 FROM dash.JobRun t WHERE t.id = s.id);

INSERT INTO dash.Snapshot
  (id, jobRunId, metricFamily, termKey, capturedAt, sourceProvider, payload, [rowCount])
SELECT s.id, s.jobRunId, s.metricFamily, s.termKey, s.capturedAt, s.sourceProvider, s.payload, s.[rowCount]
FROM dash_import.dbo.Snapshot s
WHERE EXISTS (SELECT 1 FROM dash.JobRun r WHERE r.id = s.jobRunId)
  AND NOT EXISTS (SELECT 1 FROM dash.Snapshot t WHERE t.id = s.id);

INSERT INTO dash.Setting ([key], value, updatedAt, updatedBy)
SELECT s.[key], s.value, s.updatedAt, s.updatedBy
FROM dash_import.dbo.Setting s
WHERE NOT EXISTS (SELECT 1 FROM dash.Setting t WHERE t.[key] = s.[key]);

INSERT INTO dash.AuditEvent
  (id, createdAt, actorUserId, actorEmail, action, targetType, targetId, correlationId, metadata)
SELECT s.id, s.createdAt, s.actorUserId, s.actorEmail, s.action, s.targetType, s.targetId,
       s.correlationId, s.metadata
FROM dash_import.dbo.AuditEvent s
WHERE NOT EXISTS (SELECT 1 FROM dash.AuditEvent t WHERE t.id = s.id);

INSERT INTO dash.SemesterSprint (termKey, sprintStart, sprintEnd, updatedAt, updatedBy)
SELECT s.termKey, s.sprintStart, s.sprintEnd, s.updatedAt, s.updatedBy
FROM dash_import.dbo.SemesterSprint s
WHERE NOT EXISTS (SELECT 1 FROM dash.SemesterSprint t WHERE t.termKey = s.termKey);

INSERT INTO dash.OperatorProfile
  (id, sourceCode, displayName, email, department, isActive, isSystem,
   effectiveFrom, effectiveTo, updatedAt, updatedBy)
SELECT s.id, s.sourceCode, s.displayName, s.email, s.department, s.isActive, s.isSystem,
       s.effectiveFrom, s.effectiveTo, s.updatedAt, s.updatedBy
FROM dash_import.dbo.OperatorProfile s
WHERE NOT EXISTS (SELECT 1 FROM dash.OperatorProfile t WHERE t.id = s.id);

COMMIT TRANSACTION;
GO

/*--- 5. Clear anything that must not survive the move --------------------*/
UPDATE dash.Job SET lockedAt = NULL, lockedBy = NULL WHERE lockedAt IS NOT NULL;
GO

/*--- 6. OPTIONAL: discard staging-derived history ------------------------
  Uncomment to start production's snapshot history clean. Order matters:
  Snapshot references JobRun, JobRun references Job. Job definitions and all
  identity/config rows are untouched.
-------------------------------------------------------------------------*/
-- DELETE FROM dash.Snapshot;
-- DELETE FROM dash.JobRun;
-- DELETE FROM dash.AuditEvent;
-- PRINT 'staging-derived history discarded';
GO

/*--- 7. Release the scratch database -------------------------------------*/
USE [master];
GO
-- Keep dash_import until 05_verify.sql passes, then drop it. Change your
-- session's database context away from it first (USE [master]) or the drop
-- blocks on your own connection.
-- DROP DATABASE [dash_import];
PRINT '04_import_from_staging.sql complete — now run 05_verify.sql';
GO

SET NOEXEC OFF;
GO
