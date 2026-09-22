-- 004: dash.[User] — allow many users without an external (SSO) identity.
-- UQ_User_external was a UNIQUE constraint over (externalProvider, externalId). SQL Server treats NULLs as
-- equal in a unique constraint, so the SECOND local-password user (both columns NULL) failed with
-- "Violation of UNIQUE KEY constraint 'UQ_User_external' ... (<NULL>, <NULL>)". A filtered unique index keeps
-- the intended rule (one dashboard user per external identity) while ignoring rows that have none.
-- Applied by scripts/migrate-app-db.ts (dev/staging); production mirror: db/production/004_user_external_index.sql.

IF EXISTS (SELECT 1 FROM sys.key_constraints WHERE name = 'UQ_User_external' AND parent_object_id = OBJECT_ID('dash.[User]'))
  ALTER TABLE dash.[User] DROP CONSTRAINT UQ_User_external;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_User_external' AND object_id = OBJECT_ID('dash.[User]'))
  CREATE UNIQUE INDEX UX_User_external ON dash.[User] (externalProvider, externalId)
    WHERE externalProvider IS NOT NULL AND externalId IS NOT NULL;
