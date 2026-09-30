with d as 
(SELECT idnumber
FROM view_ourm_stats
where [rows] > 1
)
select [class], V1.idnumber, lastname, firstname, DateCleared, Clearedby
from view_ourm_stats V1 join d on d.idnumber = V1.idnumber
order by idnumber