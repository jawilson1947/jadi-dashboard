-- Student subsystem source statements, as supplied in "Jadi Dashboard Student Bio Specs.docx"
-- (2026-09-23). Preserved here VERBATIM as the reference; the application's parameterized versions
-- live in src/server/repositories/mssql/student-sql.ts and are compared against these in Phase 6.
--
-- Differences in the application's versions, and why:
--   * the sample id 176941 is a bound @id parameter
--   * the SOURCE_CDE -> label CASE is removed; labels are an admin-editable setting (A-28)
--   * the global statement names the linked server from configuration and is refused unless
--     TRANS_HIST_GLOBAL_ENABLED is set, because A-24 has not confirmed that host is non-production

-- 1.1 Search by last and first name
--     like <%lastname%> and like <%firstname%>

-- 1.2 Search by idnumber

-- 2. Current Semester Transactions (shown when tblStudent.LastCleared is the isCurrent term)
select TRANS_DTE, TRANS_DESC, TRANS_AMT
from jadi.dbo.trans_hist
where id_num = 176941
order by trans_dte desc;

-- 2. Global History Transactions
select [DatePosted] = CONVERT(varchar(10), TRANS_DTE, 101), TRANS_DESC, TRANS_AMT,
       [TransactionType] = case source_cde
         when 'FA' then 'Financial Aid'
         when 'RC' then 'Cash or Credit Card'
         when 'CG' then 'Tuition Related Charge'
         when 'BN' then 'Incidentals'
         when 'LB' then 'Payroll Deduction'
         when 'IV' then 'Refund'
         when 'MS' then 'Miscellaneous'
         else SOURCE_CDE end
from [172.18.96.11,1433\MSSQL].[TMSEPRD].dbo.trans_hist
where ID_NUM = <idnumber> and SUBSID_CDE = 'AR'
order by TRANS_DTE DESC;

-- 1.5.1 Financial clearance worksheet items
EXEC dbo.Sp_GetFCWorksheetItems
  @ID_NUM = <idnumber>,
  @DropClassesDate = 'YYYY-MM-DD';

-- 1.5.2 Net the TRANS_AMT of that recordset
-- 1.5.3 Total monies due = tblStudent.AccountBalance + net amount
-- 1.5.4 80% required to clear financially
-- 1.5.5 if netamount < 0 then exit
--       else 'Amount needed to clear' = tblStudent.AccountBalance + (netamount * .80)
--
-- NOTE (D-2, 2026-09-23): the application shows dbo.fn_CostAnalysis's `needed` instead of computing
-- 1.5.5 itself. The formula above is implemented as a TEST ORACLE only
-- (docFormulaNeeded in src/server/services/clearance-analysis.ts); a divergence on real data is a
-- validation defect to be signed off, not something to reconcile silently on screen.
