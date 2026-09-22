/*===========================================================================
  004_user_external_index.sql - dash.[User]: allow many users without an SSO identity
  ---------------------------------------------------------------------------
  UQ_User_external was a UNIQUE constraint over (externalProvider, externalId).
  SQL Server treats NULLs as equal inside a unique constraint, so the SECOND
  local-password user (both columns NULL) failed on INSERT with
  "Violation of UNIQUE KEY constraint 'UQ_User_external' ... (<NULL>, <NULL>)".
  This replaces it with a filtered unique index that enforces "one dashboard
  user per external identity" only for rows that actually carry one.

  Mirror of db/migrations/004_user_external_index.sql (same filename, same ledger key).

  RUN AS:  jadi_dash (or sysadmin), on the PRODUCTION instance, in ousadb
  RUN VIA: sqlcmd -S PRODSQL -d ousadb -E -b -I -i 004_user_external_index.sql
  RERUN:   safe - the ledger guard makes the body run at most once
===========================================================================*/
SET NOCOUNT ON;
SET XACT_ABORT ON;
GO

USE [ousadb];
GO

/*--- DATABASE GUARD (works with or without SQLCMD Mode) -------------------*/
IF DB_NAME() <> N'ousadb'
BEGIN
    RAISERROR('ABORTED: connected to [%s], not [ousadb]. Nothing was changed. Reconnect to ousadb and re-run.', 16, 1, @@SERVERNAME);
    SET NOEXEC ON;
END
GO

DECLARE @name nvarchar(200) = N'004_user_external_index.sql';

IF EXISTS (SELECT 1 FROM dash.SchemaMigration WHERE name = @name)
BEGIN
    PRINT 'already applied: ' + @name;
    RETURN;
END

BEGIN TRANSACTION;
BEGIN TRY

    IF EXISTS (SELECT 1 FROM sys.key_constraints WHERE name = 'UQ_User_external' AND parent_object_id = OBJECT_ID('dash.[User]'))
        ALTER TABLE dash.[User] DROP CONSTRAINT UQ_User_external;

    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_User_external' AND object_id = OBJECT_ID('dash.[User]'))
        CREATE UNIQUE INDEX UX_User_external ON dash.[User] (externalProvider, externalId)
            WHERE externalProvider IS NOT NULL AND externalId IS NOT NULL;

    INSERT INTO dash.SchemaMigration (name) VALUES (@name);
    COMMIT TRANSACTION;
    PRINT 'applied: ' + @name;

END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    PRINT 'FAILED: ' + @name;
    THROW;
END CATCH
GO

SET NOEXEC OFF;
GO
