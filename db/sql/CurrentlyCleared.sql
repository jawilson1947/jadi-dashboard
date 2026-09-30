-- Currently cleared students for the current semester (Report R6).
-- [rows] = 1 returns a single instance per student; VIEW_OURM_STATS defines it as
-- row_number() over (partition by ID_NUM order by ID_NUM), so which of a student's
-- clearance actions wins is arbitrary. That is accepted: one instance is all that is
-- required (J. Wilson, 2026-09-29).
Select V1.[class], V1.idnumber, V1.lastname, V1.firstname, V1.DateCleared, T1.email
from view_ourm_stats V1
join tblStudent T1 on T1.idnumber = V1.idnumber
where V1.[rows] = 1
order by V1.[class], V1.lastname, V1.firstname
