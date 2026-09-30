 SET QUERY_GOVERNOR_COST_LIMIT 0;
use [ousadb];
with sm as (
select id_num from [jadi].[dbo].[student_master]
except
select idnumber from [ousadb].[dbo].[tblstudent]),
nm as (
 select cast(T1.ID_NUM as varchar) as idnumber,
 rtrim(LAST_NAME) as lastname,
 rtrim(isnull(FIRST_NAME,'nfm')) as firstname,
 rtrim(isnull(MIDDLE_NAME,'')) as midname,
 isnull(EMAIL_ADDRESS,'') as email
 FROM [jadi].[dbo].[name_master] T1
 join sm on sm.ID_NUM = T1.ID_NUM),
 am as (
  select T1.ID_NUM,
   ADDR_CDE, 
   CASE isnull(ADDR_LINE_2,'') when '' then rtrim(ADDR_LINE_1) ELSE rtrim(ADDR_LINE_1) + ', ' + rtrim(ADDR_LINE_2) END
 as [address],
   isnull(CITY,'') as city,
   ISNULL([STATE],'') as statecode,
   ISNULL(ZIP,'') as zipcode,
   isnull(dbo.format_phone(PHONE),'') as phone,
   ISNULL(COUNTRY,'') as country,
      row_number() over (partition by T1.ID_NuM order by T1.ID_NUM) as [rows]
   from [jadi].[dbo].[address_master] T1
   join sm on sm.id_num = T1.ID_NUM
   where ADDR_CDE like '%LHP%' OR ADDR_CDE like '%CUR%' or ADDR_CDE Like '%EML%'
   ),
 bm as (
     select T1.ID_NUM,  
     dbo.format_ssn(SSN) as ssn,
     BIRTH_DTE,
     GENDER
     from [jadi].[dbo].[biograph_master] T1
     join nm on nm.idnumber = T1.ID_NUM)/*,
 sub as (
     select id_num,SUM(AR_BAL_TO_DTE) over (PARTITion by ID_NUM) as accountbalance
     from [jadi].[dbo].[subsid_master] T1
     join nm on nm.idnumber = T1.id_num
      where SUBSID_CDE = 'AR' --('AR','CL') 
 )*/       

insert into [ousadb].[dbo].tblstudent
     (idnumber,lastname,firstname,midname,AccountBalance,ccode,LastCleared,
       EX_Period,[Address],City,StateCode,zipcode,SSN,phone,ClearedCurrentSession,Country,BankAccount,datecreated,datechanged,email,dob,gender)
(select idnumber,
	    lastname,
	    firstname,
	    midname,
	    CAST(0 AS DECIMAL(18,2)) AS AccountBalance,
	    'NA',
	    'XX0000',
	    'XX0000',
	   isnull( [address],''),
	    city,
	   statecode,
	   zipcode,
	  ssn,
	  phone,
      0,
	  country,
	  '',
                   getdate(),
                   getdate(),
                 'none@oakwood.edu',
                 BIRTH_DTE,
                 GENDER
from sm
 join nm on nm.idnumber = sm.ID_NUM
 join bm on bm.ID_NUM = sm.ID_NUM
 join am on (am.ID_NUM = sm.ID_NUM) and (am.[rows] = 1)
-- join sub on sub.ID_NUM = sm.ID_NUM
 )