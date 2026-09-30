/*
  10_usp_reclaim_student.sql — the ONLY path by which the application may write dbo.tblStudent.
  Run by a sysadmin / db_owner on the ousadb instance. Idempotent.

  WHY A PROCEDURE RATHER THAN A GRANT
  -----------------------------------
  01_login_and_grants.sql contains:

      DENY INSERT, UPDATE, DELETE, ALTER ON SCHEMA::dbo TO jadi_dash;

  That line is why "the application cannot modify source data" is a fact about the grants rather
  than a promise about the code, and it STAYS. This procedure is owned by dbo and reads/writes
  dbo.tblStudent; because the ownership chain is unbroken, SQL Server does not evaluate jadi_dash's
  permissions on the table at all, so the DENY is not consulted for calls through here — and is
  still enforced for any ad-hoc statement. The application gains one reviewed operation, not the
  ability to write the table.

  DELIBERATELY NOT "WITH EXECUTE AS OWNER". An earlier version carried that clause and failed with
  "Cannot execute as the database principal because the principal 'dbo' does not exist...", which
  is what a database whose owner SID does not map to a login (commonly after a restore) reports.
  It was never needed: ownership chaining is a different and narrower mechanism than impersonation,
  and it is what does the work here. Impersonating dbo would also have run the cross-database reads
  below as dbo rather than as the caller — strictly more privilege than this procedure requires.

  The cross-database reads ([jadi].[dbo].*) are NOT covered by ownership chaining, which does not
  cross databases by default. They are permission-checked against the caller, and jadi_dash is
  db_datareader in jadi, so they succeed on their own merits. That is the intended arrangement:
  the only thing this procedure adds is the one insert.

  To revoke the capability entirely:  REVOKE EXECUTE ON dbo.usp_ReclaimStudentFromJenzabar FROM jadi_dash;

  WHAT IT DOES
  ------------
  Reclaims ONE student that jadi.dbo.student_master knows about but dbo.tblStudent does not —
  the population CreateNewStudentFromJenzabar.sql skips because it inner-joins four source objects.

  Field mapping follows that script, with one deliberate difference (STUDENT-RECLAIM-PLAN S-D3):
  the real EMAIL_ADDRESS from name_master is written, not the 'none@oakwood.edu' placeholder the
  batch script hard-codes while computing the real value and discarding it. The mail-merge reports
  export email, so a placeholder is a letter that never arrives.

  Returns exactly one row: outcome, plus which source artifacts were found. The caller never has to
  infer what happened.

  COMPATIBILITY: this script avoids TRY_CONVERT, TRY_CAST and THROW, all of which need SQL Server
  2012 / database compatibility level 110 or higher. Check with:
      SELECT name, compatibility_level FROM sys.databases WHERE name IN ('ousadb', 'jadi');
  Below 110 the parser treats TRY_CONVERT as a user function and reports
  "'numeric' is not a recognized built-in function name". Everything here works at any level.

  NOTE ON pid: the column list mirrors the batch script exactly, which omits pid. That script runs
  in production today, so pid must be IDENTITY or carry a DEFAULT. If this procedure fails with
  "Cannot insert the value NULL into column 'pid'", that assumption is wrong and the column needs
  handling here — see STUDENT-RECLAIM-PLAN S-Q6.
*/

USE [ousadb];
GO

IF OBJECT_ID('dbo.usp_ReclaimStudentFromJenzabar', 'P') IS NOT NULL
  DROP PROCEDURE dbo.usp_ReclaimStudentFromJenzabar;
GO

CREATE PROCEDURE dbo.usp_ReclaimStudentFromJenzabar
    @id_num        varchar(50),
    @actor         varchar(200),        -- dash.[User].email; recorded on both sides
    @allow_partial bit = 0              -- caller must opt in to inserting with gaps (S-D2)
AS
BEGIN
  SET NOCOUNT ON;
  SET XACT_ABORT ON;

  DECLARE @outcome        varchar(30),
          @has_sm         bit = 0,
          @has_name       bit = 0,
          @has_biograph   bit = 0,
          @has_address    bit = 0,
          @address_rows   int = 0,
          @inserted       int = 0;

  -- student_master.ID_NUM is numeric and tblStudent.idnumber is varchar. Compare numerically so a
  -- padded id ('0123456') and its bare form are the same student — the same implicit conversion
  -- the batch script's EXCEPT relies on.
  --
  -- NOT written with TRY_CONVERT: that requires database compatibility level 110 (SQL Server 2012)
  -- and this database is below it. Under a lower level the parser does not recognise TRY_CONVERT as
  -- built in, reads it as a user function, and then reports 'numeric' is not a recognized built-in
  -- function name — which is what this procedure did on first install. Validating the string first
  -- and casting afterwards works at any compatibility level.
  DECLARE @id numeric(18,0);
  DECLARE @clean varchar(50) = LTRIM(RTRIM(ISNULL(@id_num, '')));

  IF @clean = '' OR @clean LIKE '%[^0-9]%' OR LEN(@clean) > 18
  BEGIN
    SELECT outcome = 'invalid_id', hasStudentMaster = 0, hasNameRecord = 0,
           hasBiograph = 0, hasQualifyingAddress = 0, addressRows = 0, rowsInserted = 0;
    RETURN;
  END
  SET @id = CAST(@clean AS numeric(18,0));

  SELECT @has_sm = CASE WHEN EXISTS (SELECT 1 FROM [jadi].[dbo].[student_master] WHERE ID_NUM = @id) THEN 1 ELSE 0 END;

  SELECT @has_name = CASE WHEN EXISTS (SELECT 1 FROM [jadi].[dbo].[name_master] WHERE ID_NUM = @id) THEN 1 ELSE 0 END;

  SELECT @has_biograph = CASE WHEN EXISTS (SELECT 1 FROM [jadi].[dbo].[biograph_master] WHERE ID_NUM = @id) THEN 1 ELSE 0 END;

  SELECT @address_rows = COUNT(*) FROM [jadi].[dbo].[address_master]
   WHERE ID_NUM = @id AND (ADDR_CDE LIKE '%LHP%' OR ADDR_CDE LIKE '%CUR%' OR ADDR_CDE LIKE '%EML%');
  SET @has_address = CASE WHEN @address_rows > 0 THEN 1 ELSE 0 END;

  -- Refusals, in the order that makes the message most useful.
  IF @has_sm = 0
    SET @outcome = 'not_in_jenzabar';
  -- The CASE is doing real work: SQL Server does not promise to evaluate a WHERE's conjuncts in
  -- written order, so `idnumber NOT LIKE '%[^0-9]%' AND CAST(idnumber AS numeric) = @id` can still
  -- attempt the cast on a junk row and fail the batch. A CASE expression is evaluated in order.
  ELSE IF EXISTS (SELECT 1 FROM dbo.tblStudent
                   WHERE CASE WHEN LTRIM(RTRIM(ISNULL(idnumber, ''))) NOT LIKE '%[^0-9]%'
                               AND LEN(LTRIM(RTRIM(ISNULL(idnumber, '')))) BETWEEN 1 AND 18
                              THEN CAST(LTRIM(RTRIM(idnumber)) AS numeric(18,0)) END = @id)
    SET @outcome = 'already_exists';
  ELSE IF @has_name = 0
    -- A student record with no defensible name is worse than no record at all.
    SET @outcome = 'no_name_record';
  ELSE IF (@has_biograph = 0 OR @has_address = 0) AND @allow_partial = 0
    SET @outcome = 'partial_not_allowed';

  IF @outcome IS NOT NULL
  BEGIN
    SELECT outcome = @outcome, hasStudentMaster = @has_sm, hasNameRecord = @has_name,
           hasBiograph = @has_biograph, hasQualifyingAddress = @has_address,
           addressRows = @address_rows, rowsInserted = 0;
    RETURN;
  END

  BEGIN TRY
    BEGIN TRANSACTION;

      -- Re-check inside the transaction: two operators clicking at once must not produce a
      -- duplicate or a confusing primary-key error.
      IF EXISTS (SELECT 1 FROM dbo.tblStudent WITH (UPDLOCK, HOLDLOCK)
                  WHERE CASE WHEN LTRIM(RTRIM(ISNULL(idnumber, ''))) NOT LIKE '%[^0-9]%'
                              AND LEN(LTRIM(RTRIM(ISNULL(idnumber, '')))) BETWEEN 1 AND 18
                             THEN CAST(LTRIM(RTRIM(idnumber)) AS numeric(18,0)) END = @id)
      BEGIN
        COMMIT TRANSACTION;
        SELECT outcome = 'already_exists', hasStudentMaster = @has_sm, hasNameRecord = @has_name,
               hasBiograph = @has_biograph, hasQualifyingAddress = @has_address,
               addressRows = @address_rows, rowsInserted = 0;
        RETURN;
      END

      ;WITH nm AS (
        SELECT TOP (1)
               CAST(ID_NUM AS varchar(50))              AS idnumber,
               RTRIM(LAST_NAME)                         AS lastname,
               RTRIM(ISNULL(FIRST_NAME, 'nfm'))         AS firstname,
               RTRIM(ISNULL(MIDDLE_NAME, ''))           AS midname,
               -- S-D3: the real address, not the batch script's placeholder.
               NULLIF(RTRIM(ISNULL(EMAIL_ADDRESS, '')), '') AS email
          FROM [jadi].[dbo].[name_master]
         WHERE ID_NUM = @id
         ORDER BY ID_NUM
      ),
      am AS (
        SELECT TOP (1)
               CASE ISNULL(ADDR_LINE_2, '') WHEN '' THEN RTRIM(ADDR_LINE_1)
                                            ELSE RTRIM(ADDR_LINE_1) + ', ' + RTRIM(ADDR_LINE_2) END AS [address],
               ISNULL(CITY, '')    AS city,
               ISNULL([STATE], '') AS statecode,
               ISNULL(ZIP, '')     AS zipcode,
               ISNULL(dbo.format_phone(PHONE), '') AS phone,
               ISNULL(COUNTRY, '') AS country
          FROM [jadi].[dbo].[address_master]
         WHERE ID_NUM = @id
           AND (ADDR_CDE LIKE '%LHP%' OR ADDR_CDE LIKE '%CUR%' OR ADDR_CDE LIKE '%EML%')
         ORDER BY ID_NUM   -- S-D3: the batch script's arbitrary pick, kept deliberately
      ),
      bm AS (
        SELECT TOP (1) dbo.format_ssn(SSN) AS ssn, BIRTH_DTE, GENDER
          FROM [jadi].[dbo].[biograph_master]
         WHERE ID_NUM = @id
         ORDER BY ID_NUM
      )
      INSERT INTO dbo.tblStudent
        (idnumber, lastname, firstname, midname, AccountBalance, cCode, LastCleared, EX_Period,
         [Address], City, StateCode, zipcode, SSN, phone, ClearedCurrentSession, Country,
         BankAccount, datecreated, datechanged, email, dob, gender)
      SELECT nm.idnumber,
             nm.lastname,
             nm.firstname,
             nm.midname,
             CAST(0 AS DECIMAL(18,2)),
             'NA',                                  -- surfaces on R1 Unclassified until the nightly run classifies
             'XX0000',                              -- never-cleared sentinel (A-16)
             'XX0000',
             ISNULL((SELECT [address]  FROM am), ''),
             ISNULL((SELECT city       FROM am), ''),
             ISNULL((SELECT statecode  FROM am), ''),
             ISNULL((SELECT zipcode    FROM am), ''),
             (SELECT ssn FROM bm),                  -- NULL when there is no biograph record
             ISNULL((SELECT phone      FROM am), ''),
             0,
             ISNULL((SELECT country    FROM am), ''),
             '',
             GETDATE(),
             GETDATE(),
             nm.email,                              -- NULL rather than a placeholder when absent
             (SELECT BIRTH_DTE FROM bm),
             (SELECT GENDER    FROM bm)
        FROM nm;

      SET @inserted = @@ROWCOUNT;

      -- The source-side record of the write (S-Q1): kept in dash, so this procedure's only
      -- privilege on dbo is the one insert above. Written inside the transaction, so a reclaim
      -- cannot exist without its log entry or the reverse.
      IF OBJECT_ID('dash.ReclaimedStudent', 'U') IS NOT NULL
        INSERT INTO dash.ReclaimedStudent
          (idnumber, reclaimedAt, reclaimedBy, hadNameRecord, hadBiograph, hadQualifyingAddress, source)
        VALUES
          (@id_num, SYSUTCDATETIME(), @actor, @has_name, @has_biograph, @has_address, 'procedure');

    COMMIT TRANSACTION;
    SET @outcome = 'inserted';
  END TRY
  BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    -- Re-raise: the application maps unexpected failures to a correlation id and shows no partial
    -- state. Swallowing the error here would let a failed write look like a successful one.
    --
    -- RAISERROR rather than THROW, for the same reason TRY_CONVERT is avoided above: THROW arrived
    -- in SQL Server 2012 and this database is older than that. RAISERROR works everywhere.
    DECLARE @msg nvarchar(2048), @sev int, @st int;
    SELECT @msg = ERROR_MESSAGE(), @sev = ERROR_SEVERITY(), @st = ERROR_STATE();
    IF @sev > 18 SET @sev = 18;   -- RAISERROR cannot raise 19+ without sysadmin and WITH LOG
    RAISERROR(@msg, @sev, @st);
  END CATCH

  SELECT outcome = @outcome, hasStudentMaster = @has_sm, hasNameRecord = @has_name,
         hasBiograph = @has_biograph, hasQualifyingAddress = @has_address,
         addressRows = @address_rows, rowsInserted = @inserted;
END
GO

-- The application's only privilege on dbo beyond SELECT.
GRANT EXECUTE ON dbo.usp_ReclaimStudentFromJenzabar TO jadi_dash;
GO

/*
  Verify (run as jadi_dash):
    SELECT * FROM fn_my_permissions('dbo.tblStudent', 'OBJECT');                     -- expect SELECT only
    SELECT * FROM fn_my_permissions('dbo.usp_ReclaimStudentFromJenzabar', 'OBJECT'); -- expect EXECUTE
    INSERT INTO dbo.tblStudent (idnumber) VALUES ('test');                           -- expect: DENY still blocks this
*/
