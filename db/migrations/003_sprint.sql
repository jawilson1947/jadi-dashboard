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
