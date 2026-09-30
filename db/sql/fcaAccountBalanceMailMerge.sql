select idnumber, cCode, lastname, firstname,accountbalance,email from view_ourm_fca where 
AccountBalance  between  ? and ?
and [status] != 'Cleared'
order by lastname
