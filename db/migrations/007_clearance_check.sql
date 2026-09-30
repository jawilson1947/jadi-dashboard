-- 007_clearance_check.sql — dash.ClearanceCheck.
--
-- The third source-data write the application can make (A-34). Recorded for the same reason as
-- dash.ReclaimedStudent and dash.SemesterUpdate: setting ClearedCurrentSession moves a student out
-- of the not-cleared populations — the dashboard hero figures, DNC candidates, the collection mail
-- merge — so it needs to be attributable afterwards, not only visible in the moment.
--
-- Written by dbo.usp_CheckStudentClearance inside the same transaction as the UPDATE, so a changed
-- record cannot exist without its log row. Not keyed on idnumber: a clearance can legitimately be
-- confirmed more than once, and each occasion is its own row.
--
-- clearedBy is the operator named on the SOURCE clearance action (VIEW_OURM_CLEARED.USER_NAME,
-- where 'sa' means it was automatic). checkedBy is the dashboard user who pressed the button. They
-- answer different questions and both are kept.

IF OBJECT_ID('dash.ClearanceCheck') IS NULL
CREATE TABLE dash.ClearanceCheck (
  id           int IDENTITY(1,1) NOT NULL PRIMARY KEY,
  idnumber     varchar(50)   NOT NULL,
  checkedAt    datetime2     NOT NULL,
  checkedBy    varchar(200)  NOT NULL,
  -- What was written, so the log answers "what did it set?" without re-deriving it.
  lastCleared  varchar(50)   NULL,
  clearedOn    varchar(8)    NULL,
  clearedBy    varchar(200)  NULL
);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ClearanceCheck_student')
  CREATE INDEX IX_ClearanceCheck_student ON dash.ClearanceCheck (idnumber, checkedAt DESC);
