-- Source DNC/DNR query supplied by J. Wilson, 2026-09-17. Preserved VERBATIM as the
-- acceptance reference (Spec Sec.8, Sec.21.5). Not executed by the application.
use [ousadb];
select 'DNC' as [category], ccode,idnumber,lastname,firstname,accountbalance,email,lastcleared from tblStudent T1
join tblOUSA T0 on isCurrent = 1 and T1.lastcleared in (T0.JADI_TradName, JADI_Leapname)
where T1.ClearedCurrentSession = 0 and T1.accountbalance > 0
UNION ALL
select 'DNR' as [category], ccode,idnumber,lastname,firstname,accountbalance,email,lastcleared from tblStudent T1
join tblOUSA T0 on T0.wasCurrent = 1 and T1.lastcleared in (T0.Jadi_TradName, JADI_Leapname)
where ClearedCurrentSession = 1 and AccountBalance > 0
order by Category,ccode,lastname,firstname
