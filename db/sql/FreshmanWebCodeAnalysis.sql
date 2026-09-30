select cCode, idnumber, lastname,firstname,accountbalance,TEL_WEB_GRP_CDE as WebCode,MOST_RECNT_YR_ENR,
CURRENT_CLASS_CDE,DateCreated = FORMAT(T2.DateCreated,'MM/dd/yyyy'),SemesterStartDate=FORMAT(T0.SemesterBegins,'MM/dd/yyyy'),
case when T2.DateCreated > T0.SemesterBegins then 'FF' else 'FR' end as [cClass]
from tblStudent T1
join jadi.dbo.student_master T2 on T2.ID_NUM = T1.idnumber
join tblOUSA T0 on T0.isCurrent = 1 and T1.LastCleared in (T0.JADI_TradName,T0.JADI_LeapName)
where T1.Ccode in ('FR','FF')
order by DateCreated, lastname,firstname
/* TEL_WEB_GRP_CDE are as follows
 1 - 'First-Time Freshman'
 2 - 'Freshman'
 3 - 'Sophmore'
 4 - 'Junior'
 5 - 'Senior'
 7 - 'Co-op Student'
 8 - 'Special-Employee'
 9 - 'Special-DINT'
10 - 'Leap Student'
20 - 'Graduate'
21 - 'Incoming First-time Freshmen'
22 - 'Incoming Transfer'
40 - 'Continuing Education'
*/
