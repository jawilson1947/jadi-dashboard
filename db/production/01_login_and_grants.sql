/*===========================================================================
  01_login_and_grants.sql — production principal, schema and grants
  ---------------------------------------------------------------------------
  Creates login [jadi_dash], schema [dash] in [ousadb], the database users,
  and the grant/DENY set that makes "the dashboard never writes source data"
  provable rather than promised (ASSUMPTIONS A-21).

  RUN AS:  sysadmin, on the PRODUCTION instance
  RUN VIA: sqlcmd -S PRODSQL -E -b -I -i 01_login_and_grants.sql -v DashPassword="..."
  RERUN:   safe — every statement is guarded

  BEFORE RUNNING: set a real password. Never commit it.
===========================================================================*/
SET NOCOUNT ON;
SET XACT_ABORT ON;
GO

/*--- 1. Server login ------------------------------------------------------*/
USE [master];
GO

/*--- DATABASE GUARD: must be in master ---------------------------------
  Works whether or not SSMS is in SQLCMD Mode. If the USE above did not take
  effect, NOEXEC stops every later batch instead of writing into the wrong
  database.
-------------------------------------------------------------------------*/
IF DB_NAME() <> N'master'
BEGIN
    RAISERROR('ABORTED: not connected to [master]. Nothing was changed.', 16, 1);
    SET NOEXEC ON;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = 'jadi_dash')
BEGIN
    DECLARE @pwd sysname = N'$(DashPassword)';

    /* If this file is run WITHOUT sqlcmd variable substitution (plain SSMS,
       SQLCMD Mode off), @pwd is the literal text '$(DashPassword)' and the
       login would be created with that as its password. Refuse instead. */
    IF @pwd IN (N'', N'CHANGE_ME') OR @pwd LIKE N'%$(%)%' OR @pwd LIKE N'%DashPassword%'
        THROW 50001,
          'No password supplied. Run with: sqlcmd -v DashPassword="<strong password>" (or replace @pwd literally in a private copy).',
          1;

    DECLARE @sql nvarchar(max) =
        N'CREATE LOGIN [jadi_dash] WITH PASSWORD = ' + QUOTENAME(@pwd, '''') +
        N', CHECK_POLICY = ON, CHECK_EXPIRATION = OFF;';
    EXEC sp_executesql @sql;
    PRINT 'created login jadi_dash';
END
ELSE
    PRINT 'login jadi_dash already exists — not modified';
GO

/*--- 2. ousadb: schema, user, grants -------------------------------------*/
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

IF SCHEMA_ID('dash') IS NULL
BEGIN
    EXEC('CREATE SCHEMA dash AUTHORIZATION dbo');
    PRINT 'created schema dash';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = 'jadi_dash')
BEGIN
    CREATE USER [jadi_dash] FOR LOGIN [jadi_dash];
    PRINT 'created user jadi_dash in ousadb';
END
ELSE
BEGIN
    -- Restored or pre-existing user: re-map the SID to this server's login.
    IF NOT EXISTS (SELECT 1 FROM sys.database_principals dp
                   JOIN sys.server_principals sp ON sp.sid = dp.sid
                   WHERE dp.name = 'jadi_dash')
    BEGIN
        ALTER USER [jadi_dash] WITH LOGIN = [jadi_dash];
        PRINT 'repaired orphaned user jadi_dash in ousadb';
    END
END
GO

ALTER ROLE db_datareader ADD MEMBER [jadi_dash];
GRANT ALTER, SELECT, INSERT, UPDATE, DELETE, EXECUTE, REFERENCES
    ON SCHEMA::dash TO [jadi_dash];
GRANT CREATE TABLE TO [jadi_dash];
DENY  INSERT, UPDATE, DELETE, ALTER ON SCHEMA::dbo TO [jadi_dash];
GO
PRINT 'ousadb grants applied';
GO

/*--- 3. jadi: read-only ---------------------------------------------------
  dbo.VIEW_OURM_TRANS_HIST reads [jadi].dbo.trans_hist (FINDINGS Sec.1).
--------------------------------------------------------------------------*/
USE [jadi];
GO

/*--- DATABASE GUARD: must be in jadi ---------------------------------
  Works whether or not SSMS is in SQLCMD Mode. If the USE above did not take
  effect, NOEXEC stops every later batch instead of writing into the wrong
  database.
-------------------------------------------------------------------------*/
IF DB_NAME() <> N'jadi'
BEGIN
    RAISERROR('ABORTED: not connected to [jadi]. Nothing was changed.', 16, 1);
    SET NOEXEC ON;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = 'jadi_dash')
BEGIN
    CREATE USER [jadi_dash] FOR LOGIN [jadi_dash];
    PRINT 'created user jadi_dash in jadi';
END
ELSE IF NOT EXISTS (SELECT 1 FROM sys.database_principals dp
                    JOIN sys.server_principals sp ON sp.sid = dp.sid
                    WHERE dp.name = 'jadi_dash')
BEGIN
    ALTER USER [jadi_dash] WITH LOGIN = [jadi_dash];
    PRINT 'repaired orphaned user jadi_dash in jadi';
END
GO

ALTER ROLE db_datareader ADD MEMBER [jadi_dash];
DENY INSERT, UPDATE, DELETE, ALTER ON SCHEMA::dbo TO [jadi_dash];
GO
PRINT 'jadi grants applied';
GO

SET NOEXEC OFF;
GO
