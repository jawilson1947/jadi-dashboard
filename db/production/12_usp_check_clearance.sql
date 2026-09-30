/*
  12_usp_check_clearance.sql — confirm a student's clearance from the source view and record it.
  Run by a sysadmin / db_owner on the ousadb instance. Idempotent.

  WHY A PROCEDURE: the same reason as 10_usp_reclaim_student.sql and
  11_usp_update_student_semester.sql. The DENY in 01_login_and_grants.sql stays; this is the third
  and last reviewed operation the application may perform on dbo. Revoke with:
      REVOKE EXECUTE ON dbo.usp_CheckStudentClearance FROM jadi_dash;

  COMPATIBILITY: ousadb runs at database compatibility level 100 on a 2019 server, so TRY_CONVERT,
  TRY_CAST, THROW and OFFSET/FETCH are all unavailable. Nothing here uses them. CREATE OR ALTER is
  replaced by DROP + CREATE for the same reason.

  WHAT IT DOES: looks for a current-term clearance action for the student. If one exists, the
  student IS cleared and tblStudent simply does not say so, and this writes that fact back.

  DIFFERENCE FROM THE SUPPLIED INSTRUCTION (J. Wilson, 2026-09-30):

  1. READS VIEW_OURM_CLEARED, NOT VIEW_OURM_STATS. VIEW_OURM_STATS takes 40-120 s (FINDINGS section
     6) and the application is barred from it by two guardrail tests. VIEW_OURM_CLEARED holds the
     same clearance actions and answers in 0.0 s; the equivalence is proven on staging
     (VIEW_OURM_CLEARED distinct = VIEW_OURM_STATS [rows]=1 count, difference 0). Both views are
     scoped to the tblOUSA.isCurrent = 1 row, so presence means cleared FOR THE CURRENT TERM, which
     is exactly what ClearedCurrentSession asserts.

  2. WRITES THREE COLUMNS, NOT ONE. ClearedCurrentSession is the Yes/No on the Bio card, but the
     title above it reads "Cleared for <LastCleared>" and the field below it reads "Cleared on".
     Setting the flag alone on a student whose LastCleared still points at an older term produces a
     card that says "Cleared for Spring 2026 - Yes" about a current-term clearance, with no date.
     So LastCleared is set the same way usp_UpdateStudentSemester sets it, and ClearedOn is taken
     from the clearance action itself. The three columns then agree.

  NEVER UN-CLEARS. A student with no clearance action is reported, not corrected: the procedure
  writes nothing at all in that case. Setting ClearedCurrentSession back to 0 on a billing record
  because a view came back empty is a surprise nobody asked for, and would be unrecoverable from
  here.

  RETURNS one row: outcome, plus what was found and written, so the caller never infers a result
  from a row count.
      cleared              - a clearance action exists; the three columns were written
      no_clearance_record  - no current-term clearance action; nothing was written
      no_student           - the id is not in tblStudent
      invalid_id           - not a usable student number
*/

USE [ousadb];
GO

IF OBJECT_ID('dbo.usp_CheckStudentClearance', 'P') IS NOT NULL
  DROP PROCEDURE dbo.usp_CheckStudentClearance;
GO

CREATE PROCEDURE dbo.usp_CheckStudentClearance
    @Idnumber varchar(50),
    @actor    varchar(200) = NULL     -- dash.[User].email, for the source-side record
AS
BEGIN
  SET NOCOUNT ON;
  SET XACT_ABORT ON;

  DECLARE @clean varchar(50) = LTRIM(RTRIM(ISNULL(@Idnumber, '')));
  IF @clean = '' OR @clean LIKE '%[^0-9]%' OR LEN(@clean) > 18
  BEGIN
    SELECT outcome = 'invalid_id', lastCleared = NULL, clearedOn = NULL, clearedBy = NULL, rowsUpdated = 0;
    RETURN;
  END
  DECLARE @id numeric(18,0) = CAST(@clean AS numeric(18,0));

  IF NOT EXISTS (SELECT 1 FROM dbo.tblStudent
                  WHERE CASE WHEN LTRIM(RTRIM(ISNULL(idnumber, ''))) NOT LIKE '%[^0-9]%'
                              AND LEN(LTRIM(RTRIM(ISNULL(idnumber, '')))) BETWEEN 1 AND 18
                             THEN CAST(LTRIM(RTRIM(idnumber)) AS numeric(18,0)) END = @id)
  BEGIN
    SELECT outcome = 'no_student', lastCleared = NULL, clearedOn = NULL, clearedBy = NULL, rowsUpdated = 0;
    RETURN;
  END

  DECLARE @dateCleared datetime, @clearedBy varchar(200);

  /*
    The student's clearance action for the current term.

    TOP (1) ordered by DateCleared takes the EARLIEST action, which is the date the student became
    cleared - the same instance db/sql/CurrentlyCleared.sql settles on for a twice-cleared student.
    USER_NAME breaks a same-instant tie so the choice is the same on every run rather than a coin
    toss between two rows.

    The comparison is a guarded cast rather than ID_NUMBER = @id because the view's column may be
    numeric or varchar depending on the underlying object, and an implicit conversion of a stray
    non-numeric value would fail the whole batch instead of missing one row.
  */
  SELECT TOP (1)
      @dateCleared = c.DateCleared,
      @clearedBy   = CAST(c.USER_NAME AS varchar(200))
  FROM dbo.VIEW_OURM_CLEARED AS c
  WHERE CASE WHEN LTRIM(RTRIM(CAST(c.ID_NUMBER AS varchar(50)))) NOT LIKE '%[^0-9]%'
              AND LEN(LTRIM(RTRIM(CAST(c.ID_NUMBER AS varchar(50))))) BETWEEN 1 AND 18
             THEN CAST(LTRIM(RTRIM(CAST(c.ID_NUMBER AS varchar(50)))) AS numeric(18,0)) END = @id
  ORDER BY c.DateCleared, c.USER_NAME;

  IF @dateCleared IS NULL
  BEGIN
    -- The ordinary "not cleared" answer, not an error. Nothing is written.
    SELECT outcome = 'no_clearance_record', lastCleared = NULL, clearedOn = NULL, clearedBy = NULL, rowsUpdated = 0;
    RETURN;
  END

  /*
    Which semester to name, derived exactly as dbo.usp_UpdateStudentSemester derives it, so the two
    buttons on the same card can never write different semesters for the same student.

    The fallback is the current row's JADI_TradName: the clearance action proves the student is
    cleared for the current term even when stud_term_sum_div has no registration row to say which
    half of it they sit in. Naming the Traditional term is better than leaving LastCleared pointing
    at a term the clearance does not belong to.
  */
  DECLARE @lastCleared varchar(50);

  SELECT TOP (1)
      @lastCleared = CASE WHEN T1.TRM_CDE = T0.EX_Leap_TRM_CDE THEN T0.JADI_LeapName
                          ELSE T0.JADI_TradName END
  FROM [jadi].[dbo].[stud_term_sum_div] AS T1
  INNER JOIN dbo.tblOUSA AS T0
          ON T0.isCurrent = 1
         AND T0.EX_YR_CDE = T1.YR_CDE
         AND T1.TRM_CDE IN (T0.EX_Trad_TRM_CDE, T0.EX_Leap_TRM_CDE)
  WHERE T1.ID_NUM = @id
  ORDER BY T1.TRM_CDE, T1.YR_CDE;

  IF @lastCleared IS NULL
    SELECT TOP (1) @lastCleared = JADI_TradName FROM dbo.tblOUSA WHERE isCurrent = 1;

  -- ClearedOn is varchar YYYYMMDD on tblStudent (A-16 sibling); style 112 is that format exactly.
  DECLARE @clearedOn varchar(8) = CONVERT(varchar(8), @dateCleared, 112);
  DECLARE @rows int = 0;

  BEGIN TRY
    BEGIN TRANSACTION;

      UPDATE S
         SET S.ClearedCurrentSession = 1,
             S.lastcleared           = ISNULL(@lastCleared, S.lastcleared),
             S.ClearedOn             = @clearedOn,
             S.datechanged           = GETDATE()
        FROM dbo.tblStudent AS S
       WHERE CASE WHEN LTRIM(RTRIM(ISNULL(S.idnumber, ''))) NOT LIKE '%[^0-9]%'
                   AND LEN(LTRIM(RTRIM(ISNULL(S.idnumber, '')))) BETWEEN 1 AND 18
                  THEN CAST(LTRIM(RTRIM(S.idnumber)) AS numeric(18,0)) END = @id;

      SET @rows = @@ROWCOUNT;

      -- Same record-keeping as the other two writes: inside the transaction, in dash, so the
      -- procedure's only privilege on dbo remains the UPDATE above.
      IF OBJECT_ID('dash.ClearanceCheck', 'U') IS NOT NULL
        INSERT INTO dash.ClearanceCheck (idnumber, checkedAt, checkedBy, lastCleared, clearedOn, clearedBy)
        VALUES (@clean, SYSUTCDATETIME(), ISNULL(@actor, 'unknown'), @lastCleared, @clearedOn, @clearedBy);

    COMMIT TRANSACTION;
  END TRY
  BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    -- RAISERROR, not THROW: THROW needs SQL Server 2012 / compatibility level 110.
    DECLARE @msg nvarchar(2048), @sev int, @st int;
    SELECT @msg = ERROR_MESSAGE(), @sev = ERROR_SEVERITY(), @st = ERROR_STATE();
    IF @sev > 18 SET @sev = 18;
    RAISERROR(@msg, @sev, @st);
  END CATCH

  SELECT outcome = CASE WHEN @rows > 0 THEN 'cleared' ELSE 'no_student' END,
         lastCleared = @lastCleared, clearedOn = @clearedOn, clearedBy = @clearedBy, rowsUpdated = @rows;
END
GO

GRANT EXECUTE ON dbo.usp_CheckStudentClearance TO jadi_dash;
GO

/*
  Verify (run as jadi_dash):
    SELECT * FROM fn_my_permissions('dbo.tblStudent', 'OBJECT');                -- expect SELECT only
    SELECT * FROM fn_my_permissions('dbo.usp_CheckStudentClearance', 'OBJECT'); -- expect EXECUTE
    UPDATE dbo.tblStudent SET ClearedCurrentSession = 1 WHERE 1 = 0;            -- expect: still denied
*/
