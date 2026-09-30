-- 005_reclaim.sql — dash.ReclaimedStudent (STUDENT-RECLAIM-PLAN §4.3, §6).
--
-- A record reclaimed from Jenzabar is incomplete precisely in the cases the feature is most needed:
-- the student was skipped by the nightly loader BECAUSE a source artifact was missing, so writing
-- them creates a row with known gaps. This table is what stops those gaps being invisible.
--
-- Three things read it: the Bio Card banner (so the next person to open the profile knows), a
-- report of reclaimed-but-incomplete records, and the audit trail. It is written inside the same
-- transaction as the insert by dbo.usp_ReclaimStudentFromJenzabar, so a reclaim cannot exist
-- without its log row.

IF OBJECT_ID('dash.ReclaimedStudent') IS NULL
CREATE TABLE dash.ReclaimedStudent (
  idnumber              varchar(50)   NOT NULL PRIMARY KEY,
  reclaimedAt           datetime2     NOT NULL,
  reclaimedBy           varchar(200)  NOT NULL,   -- dash.[User].email at the time of the write
  hadNameRecord         bit           NOT NULL,
  hadBiograph           bit           NOT NULL,
  hadQualifyingAddress  bit           NOT NULL,
  -- 'procedure' when written by usp_ReclaimStudentFromJenzabar; reserved for future callers.
  source                varchar(30)   NOT NULL DEFAULT 'procedure',
  -- Set when someone confirms the gaps have been filled in Jenzabar and the record refreshed.
  resolvedAt            datetime2     NULL,
  resolvedBy            varchar(200)  NULL
);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ReclaimedStudent_open')
  CREATE INDEX IX_ReclaimedStudent_open ON dash.ReclaimedStudent (resolvedAt, reclaimedAt DESC);
