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
