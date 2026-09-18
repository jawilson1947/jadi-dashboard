-- Login and grants for the dashboard's WRITABLE application login (USER-MANAGEMENT-PLAN Sec.1).
-- Run as a sysadmin/db_owner on the ousadb instance. Replace the password before running.
-- The login may read source data (like jadi_readonly) and may write ONLY inside schema dash.

USE [master];
IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = 'jadi_dash')
  CREATE LOGIN jadi_dash WITH PASSWORD = '<strong password>', CHECK_POLICY = ON;

USE [ousadb];
IF SCHEMA_ID('dash') IS NULL EXEC('CREATE SCHEMA dash AUTHORIZATION dbo');
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = 'jadi_dash')
  CREATE USER jadi_dash FOR LOGIN jadi_dash;

ALTER ROLE db_datareader ADD MEMBER jadi_dash;                       -- read source data
GRANT ALTER, SELECT, INSERT, UPDATE, DELETE, EXECUTE, REFERENCES ON SCHEMA::dash TO jadi_dash; -- own tables only
GRANT CREATE TABLE TO jadi_dash;                                     -- needed for migrations inside dash
DENY INSERT, UPDATE, DELETE, ALTER ON SCHEMA::dbo TO jadi_dash;      -- provably cannot modify OUSA/Jenzabar data

-- The provider also reads the co-located Jenzabar subset:
USE [jadi];
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = 'jadi_dash')
  CREATE USER jadi_dash FOR LOGIN jadi_dash;
ALTER ROLE db_datareader ADD MEMBER jadi_dash;

-- Verify (run as jadi_dash):
--   SELECT * FROM fn_my_permissions('dash', 'SCHEMA');      -- expect INSERT/UPDATE/DELETE/ALTER...
--   SELECT * FROM fn_my_permissions('dbo.tblStudent','OBJECT'); -- expect SELECT only
