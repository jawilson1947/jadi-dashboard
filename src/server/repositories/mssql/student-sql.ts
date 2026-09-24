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
   * Bio Spec 1.5.1 — the institution's own worksheet procedure. Read-only, and the drop date comes
   * from tblOUSA (the isCurrent row), never from the client.
   */
  worksheetItems: `EXEC dbo.Sp_GetFCWorksheetItems @ID_NUM = @id, @DropClassesDate = @dropDate;`,

  /**
   * A-8 / D-2 — the institution's cost analysis is authoritative for the 80% rule. Column names are
   * the function's own. A student with no row yields no row, which the service renders as "not
   * available" rather than as zero.
   */
  costAnalysis: `
SELECT TOP (1) eighty, amtdue, needed, Loan AS loan, payment
FROM dbo.fn_CostAnalysis(@id);`,
} as const;
