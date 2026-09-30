/*
  11_usp_update_student_semester.sql — set a student's semester from their Jenzabar registration.
  Run by a sysadmin / db_owner on the ousadb instance. Idempotent.

  WHY A PROCEDURE: the same reason as 10_usp_reclaim_student.sql. The DENY in
  01_login_and_grants.sql stays; this is the second — and only other — reviewed operation the
  application may perform on dbo. Revoke with:
      REVOKE EXECUTE ON dbo.usp_UpdateStudentSemester FROM jadi_dash;

  COMPATIBILITY: ousadb runs at database compatibility level 100 on a 2019 server, so TRY_CONVERT,
  TRY_CAST, THROW and OFFSET/FETCH are all unavailable. Nothing here uses them. CREATE OR ALTER is
  replaced by DROP + CREATE for the same reason — proven to work on this database.

  WHAT IT DOES: finds the student's current-term registration in jadi.dbo.stud_term_sum_div and
  writes the matching semester onto dbo.tblStudent.

  DIFFERENCE FROM THE SUPPLIED SCRIPT (J. Wilson, 2026-09-30): lastcleared is taken from
  tblOUSA.JADI_TradName / JADI_LeapName rather than built as TRM_CDE + JADI_YR_CDE.

  The application resolves every semester by matching lastcleared against those two columns
  (A-16, A-22): 'FA2026', 'LF2026' and so on. EX_Trad_TRM_CDE / EX_Leap_TRM_CDE are the Jenzabar-side
  term codes — a different vocabulary, which is why tblOUSA carries both pairs. Concatenating the
  Jenzabar code with the year would produce a value that matches nothing for the LEAP case, and the
  student would still read as an unknown term after a "successful" update. Taking the value from
  the column the application matches against cannot drift.

  EX_Period keeps the supplied formula (EX_YR_CDE + TRM_CDE). The application never reads it.

  RETURNS one row: outcome, plus what was found and written, so the caller never infers a result
  from a row count.
      updated          — one row changed
      no_registration  — no current-term registration in stud_term_sum_div
      no_student       — the id is not in tblStudent
      invalid_id       — not a usable student number
*/

USE [ousadb];
GO

IF OBJECT_ID('dbo.usp_UpdateStudentSemester', 'P') IS NOT NULL
  DROP PROCEDURE dbo.usp_UpdateStudentSemester;
GO

CREATE PROCEDURE dbo.usp_UpdateStudentSemester
    @Idnumber varchar(50),
    @actor    varchar(200) = NULL     -- dash.[User].email, for the source-side record
AS
BEGIN
  SET NOCOUNT ON;
  SET XACT_ABORT ON;

  DECLARE @clean varchar(50) = LTRIM(RTRIM(ISNULL(@Idnumber, '')));
  IF @clean = '' OR @clean LIKE '%[^0-9]%' OR LEN(@clean) > 18
  BEGIN
    SELECT outcome = 'invalid_id', lastCleared = NULL, exPeriod = NULL, rowsUpdated = 0;
    RETURN;
  END
  DECLARE @id numeric(18,0) = CAST(@clean AS numeric(18,0));

  IF NOT EXISTS (SELECT 1 FROM dbo.tblStudent
                  WHERE CASE WHEN LTRIM(RTRIM(ISNULL(idnumber, ''))) NOT LIKE '%[^0-9]%'
                              AND LEN(LTRIM(RTRIM(ISNULL(idnumber, '')))) BETWEEN 1 AND 18
                             THEN CAST(LTRIM(RTRIM(idnumber)) AS numeric(18,0)) END = @id)
  BEGIN
    SELECT outcome = 'no_student', lastCleared = NULL, exPeriod = NULL, rowsUpdated = 0;
    RETURN;
  END

  DECLARE @lastCleared varchar(50), @exPeriod varchar(50);

  /*
    One registration row for the current term.

    TOP (1) with a deterministic ORDER BY. A single instance is all that is required
    (J. Wilson), but ordering makes it the SAME instance on every run — without it a student
    registered for both the Traditional and the LEAP term could flip between the two, and the two
    write different semesters. The ordering expresses no preference; it only removes the coin toss.
  */
  SELECT TOP (1)
      @lastCleared = CASE WHEN T1.TRM_CDE = T0.EX_Leap_TRM_CDE THEN T0.JADI_LeapName
                          ELSE T0.JADI_TradName END,
      @exPeriod    = CAST(T0.EX_YR_CDE AS varchar(20)) + CAST(T1.TRM_CDE AS varchar(20))
  FROM [jadi].[dbo].[stud_term_sum_div] AS T1
  INNER JOIN dbo.tblOUSA AS T0
          ON T0.isCurrent = 1
         AND T0.EX_YR_CDE = T1.YR_CDE
         AND T1.TRM_CDE IN (T0.EX_Trad_TRM_CDE, T0.EX_Leap_TRM_CDE)
  WHERE T1.ID_NUM = @id
  ORDER BY T1.TRM_CDE, T1.YR_CDE;

  IF @lastCleared IS NULL
  BEGIN
    -- No current-term registration. This is the ordinary "nothing to update" case, not an error:
    -- the caller shows "No Semester Info found".
    SELECT outcome = 'no_registration', lastCleared = NULL, exPeriod = NULL, rowsUpdated = 0;
    RETURN;
  END

  DECLARE @rows int = 0;

  BEGIN TRY
    BEGIN TRANSACTION;

      UPDATE S
         SET S.lastcleared = @lastCleared,
             S.EX_Period   = @exPeriod,
             S.datechanged = GETDATE()
        FROM dbo.tblStudent AS S
       WHERE CASE WHEN LTRIM(RTRIM(ISNULL(S.idnumber, ''))) NOT LIKE '%[^0-9]%'
                   AND LEN(LTRIM(RTRIM(ISNULL(S.idnumber, '')))) BETWEEN 1 AND 18
                  THEN CAST(LTRIM(RTRIM(S.idnumber)) AS numeric(18,0)) END = @id;

      SET @rows = @@ROWCOUNT;

      -- Same record-keeping as the reclaim: written inside the transaction, in dash, so the
      -- procedure's only privilege on dbo remains the writes above.
      IF OBJECT_ID('dash.SemesterUpdate', 'U') IS NOT NULL
        INSERT INTO dash.SemesterUpdate (idnumber, updatedAt, updatedBy, lastCleared, exPeriod)
        VALUES (@clean, SYSUTCDATETIME(), ISNULL(@actor, 'unknown'), @lastCleared, @exPeriod);

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

  SELECT outcome = CASE WHEN @rows > 0 THEN 'updated' ELSE 'no_student' END,
         lastCleared = @lastCleared, exPeriod = @exPeriod, rowsUpdated = @rows;
END
GO

GRANT EXECUTE ON dbo.usp_UpdateStudentSemester TO jadi_dash;
GO

/*
  Verify (run as jadi_dash):
    SELECT * FROM fn_my_permissions('dbo.tblStudent', 'OBJECT');                -- expect SELECT only
    SELECT * FROM fn_my_permissions('dbo.usp_UpdateStudentSemester', 'OBJECT'); -- expect EXECUTE
    UPDATE dbo.tblStudent SET lastcleared = 'X' WHERE 1 = 0;                    -- expect: still denied
*/
