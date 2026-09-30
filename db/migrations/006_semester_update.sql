-- 006_semester_update.sql — dash.SemesterUpdate.
--
-- The second source-data write the application can make (A-33). Recorded for the same reason as
-- dash.ReclaimedStudent: a change to a student's semester moves them into current-term populations
-- — DNC candidates, receivables, the clearance breakdown — so it needs to be attributable
-- afterwards, not only visible in the moment.
--
-- Written by dbo.usp_UpdateStudentSemester inside the same transaction as the UPDATE, so a changed
-- record cannot exist without its log row. Unlike ReclaimedStudent this is not keyed on idnumber:
-- a student's semester can legitimately be set more than once, and each occasion is its own row.

IF OBJECT_ID('dash.SemesterUpdate') IS NULL
CREATE TABLE dash.SemesterUpdate (
  id           int IDENTITY(1,1) NOT NULL PRIMARY KEY,
  idnumber     varchar(50)   NOT NULL,
  updatedAt    datetime2     NOT NULL,
  updatedBy    varchar(200)  NOT NULL,
  -- What was written, so the log answers "what did it set?" without re-deriving it.
  lastCleared  varchar(50)   NOT NULL,
  exPeriod     varchar(50)   NULL
);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_SemesterUpdate_student')
  CREATE INDEX IX_SemesterUpdate_student ON dash.SemesterUpdate (idnumber, updatedAt DESC);
