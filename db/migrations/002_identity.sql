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
