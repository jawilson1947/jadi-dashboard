/*===========================================================================
  02_schema.sql — dash schema objects (baseline)
  ---------------------------------------------------------------------------
  Creates every table, index, constraint and seed row for schema [dash],
  then records the baseline in dash.SchemaMigration.

  This file is the concatenation of db/migrations/001_init.sql,
  002_identity.sql and 003_sprint.sql, which are themselves idempotent
  (IF OBJECT_ID guards and MERGE seeds). It is generated, not hand-written:
  regenerate after changing the migrations rather than editing it here.

  RUN AS:  jadi_dash (or sysadmin), on the PRODUCTION instance, in ousadb
  RUN VIA: sqlcmd -S PRODSQL -d ousadb -E -b -I -i 02_schema.sql
  RERUN:   safe — creates only what is missing

  The ledger rows at the end use the SAME filenames the Node migrator writes,
  so if anyone ever points `npm run db:migrate` at production it finds the
  baseline already applied and does nothing. Production is T-SQL-managed
  (see README.md), but the safety net costs nothing.
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

/*=========================== 001_init.sql ================================*/
-- Application-owned tables, schema [dash] inside ousadb (ASSUMPTIONS A-21, USER-MANAGEMENT-PLAN Sec.1).
-- Applied by scripts/migrate-app-db.ts as login jadi_dash (tracks applied files in dash.SchemaMigration).
-- Nothing here reads or writes dbo.* — jadi_dash is DENIED writes on schema dbo (db/grants/jadi_dash.sql).
-- PLAN.md Sec.4; Spec Sec.9.4, 14.6, 18.

IF SCHEMA_ID('dash') IS NULL EXEC('CREATE SCHEMA dash AUTHORIZATION dbo');

IF OBJECT_ID('dash.SchemaMigration') IS NULL
CREATE TABLE dash.SchemaMigration (
  name       nvarchar(200) NOT NULL PRIMARY KEY,
  appliedAt  datetime2     NOT NULL DEFAULT SYSUTCDATETIME()
);

IF OBJECT_ID('dash.Job') IS NULL
CREATE TABLE dash.Job (
  [key]              varchar(100)  NOT NULL PRIMARY KEY,
  name               nvarchar(200) NOT NULL,
  cronExpression     varchar(100)  NOT NULL,
  isEnabled          bit           NOT NULL DEFAULT 1,
  minIntervalMinutes int           NOT NULL DEFAULT 15,
  lockedAt           datetime2     NULL,
  lockedBy           varchar(200)  NULL
);

IF OBJECT_ID('dash.JobRun') IS NULL
CREATE TABLE dash.JobRun (
  id            uniqueidentifier NOT NULL PRIMARY KEY,
  jobKey        varchar(100)     NOT NULL REFERENCES dash.Job([key]),
  status        varchar(20)      NOT NULL, -- RUNNING | SUCCEEDED | FAILED | SKIPPED_OVERLAP
  triggeredBy   varchar(200)     NOT NULL,
  startedAt     datetime2        NOT NULL,
  finishedAt    datetime2        NULL,
  durationMs    int              NULL,
  rowsProcessed int              NULL,
  errorSummary  nvarchar(1000)   NULL      -- safe summary only: never SQL, connection details or secrets
);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_JobRun_jobKey_startedAt')
  CREATE INDEX IX_JobRun_jobKey_startedAt ON dash.JobRun (jobKey, startedAt DESC);

IF OBJECT_ID('dash.Snapshot') IS NULL
CREATE TABLE dash.Snapshot (
  id             uniqueidentifier NOT NULL PRIMARY KEY,
  jobRunId       uniqueidentifier NOT NULL REFERENCES dash.JobRun(id),
  metricFamily   varchar(50)      NOT NULL,
  termKey        varchar(50)      NULL,
  capturedAt     datetime2        NOT NULL,
  sourceProvider varchar(10)      NOT NULL,
  payload        nvarchar(max)    NOT NULL, -- JSON of typed aggregates; no student rows
  [rowCount]     int              NULL
);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Snapshot_family_capturedAt')
  CREATE INDEX IX_Snapshot_family_capturedAt ON dash.Snapshot (metricFamily, capturedAt DESC);

IF OBJECT_ID('dash.Setting') IS NULL
CREATE TABLE dash.Setting (
  [key]     varchar(100)  NOT NULL PRIMARY KEY,
  value     nvarchar(max) NOT NULL, -- JSON
  updatedAt datetime2     NOT NULL DEFAULT SYSUTCDATETIME(),
  updatedBy varchar(200)  NULL
);

IF OBJECT_ID('dash.AuditEvent') IS NULL
CREATE TABLE dash.AuditEvent (
  id            uniqueidentifier NOT NULL PRIMARY KEY,
  createdAt     datetime2        NOT NULL DEFAULT SYSUTCDATETIME(),
  actorUserId   uniqueidentifier NULL,       -- dash.[User].id; NULL for failed sign-ins / system
  actorEmail    varchar(320)     NULL,
  action        varchar(100)     NOT NULL,
  targetType    varchar(100)     NULL,
  targetId      varchar(200)     NULL,
  correlationId varchar(64)      NOT NULL,
  metadata      nvarchar(max)    NULL -- JSON; never secrets, result sets or export contents
);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_AuditEvent_createdAt')
  CREATE INDEX IX_AuditEvent_createdAt ON dash.AuditEvent (createdAt DESC);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_AuditEvent_actor_createdAt')
  CREATE INDEX IX_AuditEvent_actor_createdAt ON dash.AuditEvent (actorUserId, createdAt DESC);

GO

/*========================= 002_identity.sql ==============================*/
-- Identity: users, roles, per-user grants, server-side sessions, one-time credential tokens.
-- USER-MANAGEMENT-PLAN Sec.3 (decided 2026-09-18: local username + password now, SSO seam for later).
-- No column ever holds a password, temporary password or token in clear.

IF OBJECT_ID('dash.[User]') IS NULL
CREATE TABLE dash.[User] (
  id                 uniqueidentifier NOT NULL PRIMARY KEY DEFAULT NEWSEQUENTIALID(),
  username           nvarchar(64)     NOT NULL,             -- case-insensitive unique (database collation)
  email              nvarchar(320)    NOT NULL,
  displayName        nvarchar(200)    NOT NULL,
  status             varchar(20)      NOT NULL DEFAULT 'INVITED', -- ACTIVE | DISABLED | INVITED
  passwordHash       varchar(255)     NULL,                 -- PHC string (scrypt); never plaintext
  passwordSetAt      datetime2        NULL,
  mustChangePassword bit              NOT NULL DEFAULT 1,
  failedSignIns      int              NOT NULL DEFAULT 0,
  lockedUntil        datetime2        NULL,                 -- automatic lockout; distinct from status DISABLED
  externalProvider   varchar(50)      NULL,                 -- SSO seam (Phase 9)
  externalId         nvarchar(200)    NULL,
  createdAt          datetime2        NOT NULL DEFAULT SYSUTCDATETIME(),
  createdById        uniqueidentifier NULL,
  updatedAt          datetime2        NOT NULL DEFAULT SYSUTCDATETIME(),
  updatedById        uniqueidentifier NULL,
  lastSignInAt       datetime2        NULL,
  CONSTRAINT UQ_User_username UNIQUE (username),
  CONSTRAINT UQ_User_email    UNIQUE (email),
  CONSTRAINT UQ_User_external UNIQUE (externalProvider, externalId),
  CONSTRAINT CK_User_status   CHECK (status IN ('ACTIVE','DISABLED','INVITED'))
);

IF OBJECT_ID('dash.Role') IS NULL
CREATE TABLE dash.Role ([key] varchar(50) NOT NULL PRIMARY KEY, name nvarchar(100) NOT NULL, description nvarchar(400) NULL, isSystem bit NOT NULL DEFAULT 1);

IF OBJECT_ID('dash.Permission') IS NULL
CREATE TABLE dash.Permission ([key] varchar(100) NOT NULL PRIMARY KEY, description nvarchar(400) NULL);

IF OBJECT_ID('dash.RolePermission') IS NULL
CREATE TABLE dash.RolePermission (
  roleKey       varchar(50)  NOT NULL REFERENCES dash.Role([key]),
  permissionKey varchar(100) NOT NULL REFERENCES dash.Permission([key]),
  PRIMARY KEY (roleKey, permissionKey)
);

IF OBJECT_ID('dash.UserRole') IS NULL
CREATE TABLE dash.UserRole (
  userId      uniqueidentifier NOT NULL REFERENCES dash.[User](id) ON DELETE CASCADE,
  roleKey     varchar(50)      NOT NULL REFERENCES dash.Role([key]),
  grantedAt   datetime2        NOT NULL DEFAULT SYSUTCDATETIME(),
  grantedById uniqueidentifier NULL,
  PRIMARY KEY (userId, roleKey)
);

IF OBJECT_ID('dash.UserPermission') IS NULL
CREATE TABLE dash.UserPermission (
  userId        uniqueidentifier NOT NULL REFERENCES dash.[User](id) ON DELETE CASCADE,
  permissionKey varchar(100)     NOT NULL REFERENCES dash.Permission([key]),
  grantedAt     datetime2        NOT NULL DEFAULT SYSUTCDATETIME(),
  grantedById   uniqueidentifier NULL,
  expiresAt     datetime2        NULL,
  PRIMARY KEY (userId, permissionKey)
);

IF OBJECT_ID('dash.Session') IS NULL
CREATE TABLE dash.Session (
  id            uniqueidentifier NOT NULL PRIMARY KEY,      -- random; the cookie carries only this id, HMAC-signed
  userId        uniqueidentifier NOT NULL REFERENCES dash.[User](id) ON DELETE CASCADE,
  createdAt     datetime2 NOT NULL DEFAULT SYSUTCDATETIME(),
  lastSeenAt    datetime2 NOT NULL DEFAULT SYSUTCDATETIME(),
  expiresAt     datetime2 NOT NULL,                         -- absolute expiry
  ip            varchar(64) NULL,
  userAgent     nvarchar(400) NULL,
  revokedAt     datetime2 NULL,
  revokedReason varchar(50) NULL                            -- sign_out | admin | password_change | disabled | expired
);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Session_user')
  CREATE INDEX IX_Session_user ON dash.Session(userId, expiresAt);

IF OBJECT_ID('dash.CredentialToken') IS NULL
CREATE TABLE dash.CredentialToken (
  id        uniqueidentifier NOT NULL PRIMARY KEY,
  userId    uniqueidentifier NOT NULL REFERENCES dash.[User](id) ON DELETE CASCADE,
  tokenHash varchar(128) NOT NULL,                          -- SHA-256 of the token shown once to the administrator
  purpose   varchar(20)  NOT NULL,                          -- INVITE | RESET
  expiresAt datetime2    NOT NULL,
  usedAt    datetime2    NULL,
  createdAt datetime2    NOT NULL DEFAULT SYSUTCDATETIME()
);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_CredentialToken_user')
  CREATE INDEX IX_CredentialToken_user ON dash.CredentialToken(userId, expiresAt);

GO

-- Seed roles and permissions from src/server/authz/permissions.ts (the code keeps the type-checked keys).
MERGE dash.Role AS t USING (VALUES
  ('ADMINISTRATOR', N'Administrator', N'Full access, including users, metadata, schedules, connections and the audit log (Spec 3.1)'),
  ('OPERATOR', N'Operator', N'Day-to-day analysis: dashboards, student-level data, worksheets, exports and mail merge (Spec 3.2)'),
  ('VIEWER', N'Viewer', N'Aggregate dashboards only; student-level access requires an explicit grant (Spec 3.3)')
) AS s([key], name, description) ON t.[key] = s.[key]
WHEN NOT MATCHED THEN INSERT ([key], name, description) VALUES (s.[key], s.name, s.description);

MERGE dash.Permission AS t USING (VALUES
  ('dashboard.view'),
  ('history.view'),
  ('student.view'),
  ('student.pid.view'),
  ('student.academic.view'),
  ('worksheet.view'),
  ('export.create'),
  ('mailmerge.create'),
  ('operator.manage'),
  ('user.manage'),
  ('metadata.manage'),
  ('schedule.manage'),
  ('connection.manage'),
  ('ai.view'),
  ('audit.view')
) AS s([key]) ON t.[key] = s.[key]
WHEN NOT MATCHED THEN INSERT ([key]) VALUES (s.[key]);

MERGE dash.RolePermission AS t USING (VALUES
  ('ADMINISTRATOR', 'dashboard.view'),
  ('ADMINISTRATOR', 'history.view'),
  ('ADMINISTRATOR', 'student.view'),
  ('ADMINISTRATOR', 'student.pid.view'),
  ('ADMINISTRATOR', 'student.academic.view'),
  ('ADMINISTRATOR', 'worksheet.view'),
  ('ADMINISTRATOR', 'export.create'),
  ('ADMINISTRATOR', 'mailmerge.create'),
  ('ADMINISTRATOR', 'operator.manage'),
  ('ADMINISTRATOR', 'user.manage'),
  ('ADMINISTRATOR', 'metadata.manage'),
  ('ADMINISTRATOR', 'schedule.manage'),
  ('ADMINISTRATOR', 'connection.manage'),
  ('ADMINISTRATOR', 'ai.view'),
  ('ADMINISTRATOR', 'audit.view'),
  ('OPERATOR', 'dashboard.view'),
  ('OPERATOR', 'history.view'),
  ('OPERATOR', 'student.view'),
  ('OPERATOR', 'worksheet.view'),
  ('OPERATOR', 'export.create'),
  ('OPERATOR', 'mailmerge.create'),
  ('OPERATOR', 'ai.view'),
  ('VIEWER', 'dashboard.view'),
  ('VIEWER', 'history.view')
) AS s(roleKey, permissionKey) ON t.roleKey = s.roleKey AND t.permissionKey = s.permissionKey
WHEN NOT MATCHED THEN INSERT (roleKey, permissionKey) VALUES (s.roleKey, s.permissionKey);

GO

/*========================== 003_sprint.sql ===============================*/
-- Phase 3 — Clearance Sprint (Spec Sec.7).
--   dash.SemesterSprint   admin-entered sprint window per semester (ASSUMPTIONS A-10: no computed default)
--   dash.OperatorProfile  ClearedBy code -> person, with effective dates so a reused code resolves
--                         to whoever held it on the date of the clearance action (Spec Sec.7.2)
-- Applied by scripts/migrate-app-db.ts as login jadi_dash. Nothing here touches dbo.*.

IF OBJECT_ID('dash.SemesterSprint') IS NULL
CREATE TABLE dash.SemesterSprint (
  termKey     varchar(50)  NOT NULL PRIMARY KEY,   -- semester key (JADI_TradName), e.g. FA2026
  sprintStart date         NOT NULL,
  sprintEnd   date         NOT NULL,
  updatedAt   datetime2    NOT NULL DEFAULT SYSUTCDATETIME(),
  updatedBy   varchar(200) NULL,
  CONSTRAINT CK_SemesterSprint_range CHECK (sprintEnd >= sprintStart)
);

IF OBJECT_ID('dash.OperatorProfile') IS NULL
CREATE TABLE dash.OperatorProfile (
  id            uniqueidentifier NOT NULL PRIMARY KEY,
  sourceCode    varchar(50)      NOT NULL,          -- the ClearedBy login code recorded by the source
  displayName   nvarchar(200)    NOT NULL,
  email         varchar(320)     NULL,
  department    nvarchar(200)    NULL,
  isActive      bit              NOT NULL DEFAULT 1,
  isSystem      bit              NOT NULL DEFAULT 0, -- 'sa' = automatic clearance (Spec Sec.10.5)
  effectiveFrom date             NULL,               -- NULL = open-ended in that direction
  effectiveTo   date             NULL,
  updatedAt     datetime2        NOT NULL DEFAULT SYSUTCDATETIME(),
  updatedBy     varchar(200)     NULL,
  CONSTRAINT CK_OperatorProfile_range CHECK (effectiveTo IS NULL OR effectiveFrom IS NULL OR effectiveTo >= effectiveFrom)
);
-- One row per (code, start of validity): the same code may be reassigned to a different person later.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_OperatorProfile_code_from')
  CREATE UNIQUE INDEX UX_OperatorProfile_code_from ON dash.OperatorProfile (sourceCode, effectiveFrom)
  WHERE effectiveFrom IS NOT NULL;
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_OperatorProfile_code_open')
  CREATE UNIQUE INDEX UX_OperatorProfile_code_open ON dash.OperatorProfile (sourceCode)
  WHERE effectiveFrom IS NULL;

GO

/*======================== migration ledger ===============================*/
MERGE dash.SchemaMigration AS t
USING (VALUES ('001_init.sql'), ('002_identity.sql'), ('003_sprint.sql'))
      AS s(name) ON t.name = s.name
WHEN NOT MATCHED THEN INSERT (name) VALUES (s.name);
GO

SELECT name, appliedAt FROM dash.SchemaMigration ORDER BY name;
PRINT '02_schema.sql complete';
GO

SET NOEXEC OFF;
GO
