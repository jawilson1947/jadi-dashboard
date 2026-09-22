/*===========================================================================
  0NN_short_description.sql — <what this change does and why>
  ---------------------------------------------------------------------------
  Copy this file to db/production/0NN_<name>.sql for every production schema
  change. NN increments; the filename is the ledger key and never changes
  after it has run anywhere.

  RUN AS:  jadi_dash (or sysadmin), on the PRODUCTION instance, in ousadb
  RUN VIA: sqlcmd -S PRODSQL -d ousadb -E -b -I -i 0NN_short_description.sql
  RERUN:   safe — the ledger guard below makes the body run at most once

  RULES
  1. Forward-only. Never edit a migration that has run. Fix it with a new one.
  2. Mirror the change in db/migrations/ so dev and staging (which still use
     `npm run db:migrate`) stay in step, using the SAME filename.
  3. Touch nothing outside schema dash — jadi_dash is DENIED writes on dbo
     and the deployment must not need elevation to apply a migration.
  4. Wrap DML in the transaction. DDL that cannot run inside one goes in its
     own migration with the guard, but no BEGIN TRANSACTION.
===========================================================================*/
SET NOCOUNT ON;
SET XACT_ABORT ON;
GO

:on error exit

USE [ousadb];
GO

DECLARE @name nvarchar(200) = N'0NN_short_description.sql';

IF EXISTS (SELECT 1 FROM dash.SchemaMigration WHERE name = @name)
BEGIN
    PRINT 'already applied: ' + @name;
    RETURN;
END

BEGIN TRANSACTION;
BEGIN TRY

    /*=================== change goes here ===============================*/

    -- Example: add a nullable column
    -- IF COL_LENGTH('dash.Setting', 'category') IS NULL
    --     ALTER TABLE dash.Setting ADD category varchar(50) NULL;

    -- Example: seed a row without clobbering an administrator's edit
    -- MERGE dash.Setting AS t
    -- USING (VALUES ('staleAfterMinutes', N'180')) AS s([key], value)
    --   ON t.[key] = s.[key]
    -- WHEN NOT MATCHED THEN INSERT ([key], value) VALUES (s.[key], s.value);

    /*====================================================================*/

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
