/**
 * Parameterized T-SQL for the Student subsystem (Spec §10, docs/STUDENT-PLAN.md, the Bio Spec).
 *
 * These statements are kept apart from ./sql.ts on purpose. Everything in sql.ts is an aggregate or
 * a list, and is held to "never name dob, never EXEC, never touch a linked server". The Student
 * subsystem legitimately needs all three — but only ever for ONE student, identified by a bound
 * parameter. Separating the files makes that exception explicit and testable
 * (tests/unit/student-sql.test.ts) instead of quietly widening the rules that protect the rest.
 *
 * Rules that still hold here:
 *   - read-only; the only EXEC is the institution's own read-only worksheet procedure
 *   - every value is bound; nothing is interpolated, including LIKE patterns
 *   - only the columns in SAFE_BIO_COLUMNS are read from tblStudent — never SSN, gender, BankAccount
 *   - the linked-server statement is used only when A-24 has been confirmed and the path enabled
 */

/**
 * Columns the bio card may read. `dob` is here because the Bio Spec's data form requires it; it is
 * masked in the service unless the caller holds student.pii.view (A-29). SSN, gender and BankAccount
 * exist on the table and are absent from this list deliberately.
 */
export const SAFE_BIO_COLUMNS = [
  "idnumber", "lastname", "firstname", "midname", "pid", "email", "phone", "dob", "CNP",
  "Address", "City", "StateCode", "zipcode", "Country", "cCode", "ClearedCurrentSession",
  "ClearedOn", "AccountBalance", "LastCleared",
] as const;

/** The search result set (Bio Spec 1.3), minus the bio-only fields. */
const SEARCH_COLUMNS = `S.idnumber, S.lastname, S.firstname, S.email, S.phone, S.LastCleared,
       S.AccountBalance, S.cCode, S.ClearedCurrentSession,
       CASE WHEN e.idnumber IS NULL THEN 0 ELSE 1 END AS enrolled`;

/** VIEW_OURM is the current-term enrollment set and costs ~0.2 s, so it joins directly here. */
const ENROLLED_JOIN = `LEFT JOIN dbo.VIEW_OURM e ON CAST(e.idnumber AS varchar(50)) = S.idnumber`;

export const QS = {
  /**
   * Bio Spec 1.1 — `like <%lastname%> and like <%firstname%>`. The pattern is built in the service
   * (escaped, wrapped in %) and bound; ESCAPE '\' makes a literal % or _ in a name behave as a
   * character rather than as a wildcard, so a search for "O'%" cannot become "match everything".
   */
  searchByName: `
SELECT TOP (@limit) ${SEARCH_COLUMNS}
FROM dbo.tblStudent S
${ENROLLED_JOIN}
WHERE S.lastname LIKE @last ESCAPE '\\'
  AND (@first IS NULL OR S.firstname LIKE @first ESCAPE '\\')
ORDER BY S.lastname, S.firstname, S.idnumber;`,

  /** Bio Spec 1.2 — by idnumber; exact first, then prefix, so a full ID never returns a crowd. */
  searchById: `
SELECT TOP (@limit) ${SEARCH_COLUMNS}
FROM dbo.tblStudent S
${ENROLLED_JOIN}
WHERE S.idnumber = @id OR S.idnumber LIKE @idPrefix ESCAPE '\\'
ORDER BY CASE WHEN S.idnumber = @id THEN 0 ELSE 1 END, S.idnumber;`,

  /** Bio Spec 1.3 — the data form, one student, by bound key. */
  bio: `
SELECT TOP (1) S.idnumber, S.lastname, S.firstname, S.midname, S.pid, S.email, S.phone, S.dob, S.CNP,
       S.Address, S.City, S.StateCode, S.zipcode, S.Country, S.cCode, S.ClearedCurrentSession,
       S.ClearedOn, S.AccountBalance, S.LastCleared,
       CASE WHEN e.idnumber IS NULL THEN 0 ELSE 1 END AS enrolled
FROM dbo.tblStudent S
${ENROLLED_JOIN}
WHERE S.idnumber = @id;`,

  /**
   * Bio Spec 2, current semester — the co-located jadi database. Newest first, as supplied.
   * The Bio Spec's sample literal (176941) is a sample: the id is bound.
   */
  currentTermTransactions: `
SELECT TRANS_DTE, TRANS_DESC, TRANS_AMT, SOURCE_CDE
FROM [jadi].[dbo].[trans_hist]
WHERE id_num = @id
ORDER BY TRANS_DTE DESC;`,

  /**
   * Bio Spec 2, global history — the Jenzabar Cloud copy behind a linked server. A-24 is UNSIGNED:
   * the provider refuses to send this unless TRANS_HIST_GLOBAL_ENABLED is set deliberately, because
   * the host in the Bio Spec may be production. The SOURCE_CDE → label CASE from the Bio Spec is
   * deliberately NOT here — labels are admin-editable settings (A-28), so the query returns raw codes.
   * The server name is a build-time constant from configuration, never user input.
   */
  globalTransactions: (linkedServer: string) => `
SELECT TRANS_DTE, TRANS_DESC, TRANS_AMT, SOURCE_CDE
FROM ${linkedServer}.dbo.trans_hist
WHERE ID_NUM = @id AND SUBSID_CDE = 'AR'
ORDER BY TRANS_DTE DESC;`,

  /**
   * Reclaim diagnostic (STUDENT-RECLAIM-PLAN §4) — why is this one id missing from tblStudent?
   *
   * Four existence checks and the address-code list for a single bound id. Sub-second, so it runs
   * inline on the not-found card; the set-wide equivalent is db/sql/DiagnoseMissingStudents.sql and
   * answers a different question (how many, and why) that does not belong on a lookup page.
   *
   * student_master.ID_NUM is numeric and tblStudent.idnumber is varchar, so the id is compared
   * numerically — the same implicit conversion the nightly loader's EXCEPT relies on. Without it a
   * padded id reads as "not in Jenzabar either" for a student who is plainly there.
   *
   * addressCodes is the most useful line on the panel: the common cause is not "no address" but
   * "an address under a code the loader does not look for", and naming that code points at the
   * loader's WHERE clause rather than at this student.
   */
  reclaimDiagnostic: `
SET NOCOUNT ON;
-- No TRY_CONVERT: it needs database compatibility level 110+, and below that the parser reads it as
-- a user function and fails with "'numeric' is not a recognized built-in function name". Validate
-- the string, then cast — that works at any compatibility level.
DECLARE @clean varchar(50) = LTRIM(RTRIM(ISNULL(@id, '')));
DECLARE @n numeric(18,0) = CASE WHEN @clean <> '' AND @clean NOT LIKE '%[^0-9]%' AND LEN(@clean) <= 18
                                THEN CAST(@clean AS numeric(18,0)) END;
SELECT
  -- The CASE guards the cast: SQL Server does not promise to evaluate a WHERE's conjuncts in
  -- written order, so a junk idnumber could otherwise reach CAST and fail the whole query.
  inTblStudent      = CASE WHEN EXISTS (SELECT 1 FROM dbo.tblStudent
                                         WHERE CASE WHEN LTRIM(RTRIM(ISNULL(idnumber, ''))) NOT LIKE '%[^0-9]%'
                                                     AND LEN(LTRIM(RTRIM(ISNULL(idnumber, '')))) BETWEEN 1 AND 18
                                                    THEN CAST(LTRIM(RTRIM(idnumber)) AS numeric(18,0)) END = @n)
                           THEN 1 ELSE 0 END,
  hasStudentMaster  = CASE WHEN EXISTS (SELECT 1 FROM [jadi].[dbo].[student_master]  WHERE ID_NUM = @n) THEN 1 ELSE 0 END,
  hasNameRecord     = CASE WHEN EXISTS (SELECT 1 FROM [jadi].[dbo].[name_master]     WHERE ID_NUM = @n) THEN 1 ELSE 0 END,
  hasBiograph       = CASE WHEN EXISTS (SELECT 1 FROM [jadi].[dbo].[biograph_master] WHERE ID_NUM = @n) THEN 1 ELSE 0 END,
  addressRows       = (SELECT COUNT(*) FROM [jadi].[dbo].[address_master] WHERE ID_NUM = @n),
  qualifyingAddressRows = (SELECT COUNT(*) FROM [jadi].[dbo].[address_master] WHERE ID_NUM = @n
                             AND (ADDR_CDE LIKE '%LHP%' OR ADDR_CDE LIKE '%CUR%' OR ADDR_CDE LIKE '%EML%')),
  addressCodes      = (SELECT STUFF((SELECT DISTINCT ', ' + RTRIM(ADDR_CDE)
                                       FROM [jadi].[dbo].[address_master]
                                      WHERE ID_NUM = @n AND ISNULL(ADDR_CDE,'') <> ''
                                      FOR XML PATH('')), 1, 2, '')),
  -- The values a reclaim would write, so the confirm panel shows the real thing rather than a
  -- generic "are you sure". Email is the REAL address (S-D3), not the batch script's placeholder.
  lastName          = (SELECT TOP (1) RTRIM(LAST_NAME)                FROM [jadi].[dbo].[name_master] WHERE ID_NUM = @n ORDER BY ID_NUM),
  firstName         = (SELECT TOP (1) RTRIM(ISNULL(FIRST_NAME,'nfm')) FROM [jadi].[dbo].[name_master] WHERE ID_NUM = @n ORDER BY ID_NUM),
  middleName        = (SELECT TOP (1) RTRIM(ISNULL(MIDDLE_NAME,''))   FROM [jadi].[dbo].[name_master] WHERE ID_NUM = @n ORDER BY ID_NUM),
  email             = (SELECT TOP (1) NULLIF(RTRIM(ISNULL(EMAIL_ADDRESS,'')),'') FROM [jadi].[dbo].[name_master] WHERE ID_NUM = @n ORDER BY ID_NUM),
  city              = (SELECT TOP (1) ISNULL(CITY,'')    FROM [jadi].[dbo].[address_master] WHERE ID_NUM = @n
                         AND (ADDR_CDE LIKE '%LHP%' OR ADDR_CDE LIKE '%CUR%' OR ADDR_CDE LIKE '%EML%') ORDER BY ID_NUM),
  stateCode         = (SELECT TOP (1) ISNULL([STATE],'') FROM [jadi].[dbo].[address_master] WHERE ID_NUM = @n
                         AND (ADDR_CDE LIKE '%LHP%' OR ADDR_CDE LIKE '%CUR%' OR ADDR_CDE LIKE '%EML%') ORDER BY ID_NUM);`,

  /**
   * The write. EXEC only — the application has no INSERT privilege on dbo and must not acquire one
   * (S-D1). Everything the caller needs to report is in the procedure's single result row, so the
   * application never infers an outcome from a row count.
   */
  reclaimExecute: `EXEC dbo.usp_ReclaimStudentFromJenzabar @id_num = @id, @actor = @actor, @allow_partial = @allowPartial;`,

  /**
   * Bio Spec 1.5.1 — the institution's own worksheet procedure. Read-only, and the drop date comes
   * from tblOUSA (the isCurrent row), never from the client.
   */
  worksheetItems: `EXEC dbo.Sp_GetFCWorksheetItems @ID_NUM = @id, @DropClassesDate = @dropDate;`,

  /**
   * A-8 / D-2 — the institution's cost analysis is authoritative for the 80% rule.
   *
   * `fn_CostAnalysis` is a SCALAR function taking (@what, @balance, @charges, @credits) and
   * returning one figure per call — not a table-valued function keyed on a student. This mirrors
   * exactly how VIEW_OURM_FCA itself calls it (discovery 2026-09-17, FINDINGS §8.5), for ONE
   * student, so the figures on the profile are the same ones the FCA drill-down shows:
   *   'S' = 80% of charges · 'T' = amount due · 'D' = amount needed to clear · 'L' = loan · 'P' = payment
   *
   * Charges and credits come from the per-student views the function expects. FCA joins those same
   * views; querying them for a single id is fast, where scanning FCA itself takes 40–120 s.
   * A student with no charges and no credits still returns a row (ISNULL → 0), which is the
   * function's own convention: it answers zero rather than declining to answer.
   */
  costAnalysis: `
SELECT TOP (1)
  eighty  = dbo.fn_CostAnalysis('S', S.AccountBalance, ISNULL(CH.Charges, 0), ISNULL(CR.credits, 0)),
  amtdue  = dbo.fn_CostAnalysis('T', S.AccountBalance, ISNULL(CH.Charges, 0), ISNULL(CR.credits, 0)),
  needed  = dbo.fn_CostAnalysis('D', S.AccountBalance, ISNULL(CH.Charges, 0), ISNULL(CR.credits, 0)),
  loan    = dbo.fn_CostAnalysis('L', S.AccountBalance, ISNULL(CH.Charges, 0), ISNULL(CR.credits, 0)),
  payment = dbo.fn_CostAnalysis('P', S.AccountBalance, ISNULL(CH.Charges, 0), ISNULL(CR.credits, 0)),
  charges = ISNULL(CH.Charges, 0),
  credits = ISNULL(CR.credits, 0)
FROM dbo.tblStudent S
LEFT JOIN dbo.VIEW_OURM_CHARGES CH ON CH.idnumber = S.idnumber
LEFT JOIN dbo.VIEW_OURM_CREDITS CR ON CR.idnumber = S.idnumber
WHERE S.idnumber = @id;`,
} as const;
