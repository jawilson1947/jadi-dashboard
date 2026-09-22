/*===========================================================================
  03_seed_jobs.sql — job definitions
  ---------------------------------------------------------------------------
  Roles, permissions and role-permission mappings are seeded by 02_schema.sql
  (they live in migration 002). Job definitions are NOT: in development the
  worker seeds them at startup from src/server/jobs/definitions.ts
  (ensureJobsSeeded). Production is T-SQL-managed, so they are seeded here.

  Keys, names, cron expressions and minimum intervals mirror JOB_DEFINITIONS
  exactly. If that file changes, add a numbered migration (see
  _template_migration.sql) rather than editing this one.

  RUN AS:  jadi_dash (or sysadmin), on the PRODUCTION instance, in ousadb
  RUN VIA: sqlcmd -S PRODSQL -d ousadb -E -b -I -i 03_seed_jobs.sql
  RERUN:   safe — inserts only missing rows, never overwrites an
           administrator's schedule change made in Administration -> Jobs
===========================================================================*/
SET NOCOUNT ON;
SET XACT_ABORT ON;
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

MERGE dash.Job AS t
USING (VALUES
  ('metadata.terms',                N'Semester metadata (tblOUSA)',                          '5 21 * * *',   5),
  ('dashboard.enrollmentClearance', N'Enrolled vs. financially cleared',                     '*/15 * * * *', 5),
  ('dashboard.currentReceivable',   N'Current receivable',                                   '*/30 * * * *', 10),
  ('dashboard.chargesCredits',      N'Charges, credits and delta',                           '0 * * * *',    15),
  ('dashboard.clearanceBreakdown',  N'Clearance breakdown by classification',                '*/15 * * * *', 5),
  ('sprint.daily',                  N'Clearance sprint (by date, operator, classification)', '*/15 * * * *', 5),
  ('history.enrollmentClearance',   N'Historical enrolled vs. financially cleared',          '10 21 * * *',  60),
  ('history.globalBalances',        N'Global receivables and credit balances',               '15 21 * * *',  60),
  ('history.receivablesBySemester', N'Receivables by semester',                              '20 21 * * *',  60),
  ('dashboard.dnrDnc',              N'DNC / DNR summary',                                    '0 * * * *',    15)
) AS s([key], name, cronExpression, minIntervalMinutes)
ON t.[key] = s.[key]
WHEN NOT MATCHED THEN
  INSERT ([key], name, cronExpression, isEnabled, minIntervalMinutes, lockedAt, lockedBy)
  VALUES (s.[key], s.name, s.cronExpression, 1, s.minIntervalMinutes, NULL, NULL);
GO

/* Report any job in the database that the application does not know about,
   and any definition missing from the database. Both are drift, not errors. */
SELECT j.[key] AS unknown_job_in_database
FROM dash.Job j
WHERE j.[key] NOT IN (
  'metadata.terms','dashboard.enrollmentClearance','dashboard.currentReceivable',
  'dashboard.chargesCredits','dashboard.clearanceBreakdown','sprint.daily',
  'history.enrollmentClearance','history.globalBalances',
  'history.receivablesBySemester','dashboard.dnrDnc');
GO

SELECT [key], cronExpression, isEnabled, minIntervalMinutes FROM dash.Job ORDER BY [key];
PRINT '03_seed_jobs.sql complete';
GO

SET NOEXEC OFF;
GO
