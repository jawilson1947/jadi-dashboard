<#
  Counts-only validation of the supplied DNC/DNR query (docs/validation-sql/dnr_dnc_source.sql)
  against the enrollment universe (VIEW_OURM). Reads the same JADI_STAGING_* environment
  variables as discover-schema.ps1. Emits aggregate counts only - no student rows.
#>
$ErrorActionPreference = "Stop"
function Env-Or([string]$n) { $v=[Environment]::GetEnvironmentVariable($n,"User"); if(-not $v){throw "$n not set"}; $v }
$b = New-Object System.Data.SqlClient.SqlConnectionStringBuilder
$b["Data Source"]=Env-Or "JADI_STAGING_SERVER"; $b["Initial Catalog"]=Env-Or "JADI_STAGING_DATABASE"
$b["User ID"]=Env-Or "JADI_STAGING_USER"; $b["Password"]=Env-Or "JADI_STAGING_PASSWORD"
$b["Encrypt"]=$false; $b["TrustServerCertificate"]=$true; $b["ApplicationIntent"]="ReadOnly"; $b["Connect Timeout"]=20
$c = New-Object System.Data.SqlClient.SqlConnection($b.ConnectionString); $c.Open()
$sql = @"
WITH cur AS (SELECT JADI_TradName AS t, JADI_LeapName AS l FROM dbo.tblOUSA WHERE isCurrent = 1),
     prev AS (SELECT JADI_TradName AS t, JADI_LeapName AS l FROM dbo.tblOUSA WHERE wasCurrent = 1),
     enrolled AS (SELECT idnumber FROM dbo.VIEW_OURM),
     dnc_q AS (SELECT T1.idnumber, T1.AccountBalance FROM dbo.tblStudent T1 JOIN cur ON T1.LastCleared IN (cur.t, cur.l) WHERE T1.ClearedCurrentSession = 0),
     dnr_q AS (SELECT T1.idnumber, T1.AccountBalance FROM dbo.tblStudent T1 JOIN prev ON T1.LastCleared IN (prev.t, prev.l) WHERE T1.ClearedCurrentSession = 1)
SELECT 'DNC: LastCleared=current AND flag=0 (any balance)' AS measure, COUNT(*) AS n FROM dnc_q
UNION ALL SELECT 'DNC: ... AND balance > 0  (= supplied query)', COUNT(*) FROM dnc_q WHERE AccountBalance > 0
UNION ALL SELECT 'DNC: of those, present in VIEW_OURM (enrolled)', COUNT(*) FROM dnc_q d WHERE EXISTS (SELECT 1 FROM enrolled e WHERE e.idnumber = d.idnumber)
UNION ALL SELECT 'DNC: of those, NOT in VIEW_OURM', COUNT(*) FROM dnc_q d WHERE NOT EXISTS (SELECT 1 FROM enrolled e WHERE e.idnumber = d.idnumber)
UNION ALL SELECT 'FCA-style not cleared: in VIEW_OURM AND flag=0', COUNT(*) FROM dbo.VIEW_OURM WHERE ClearedCurrentSession = 0
UNION ALL SELECT 'FCA-style not cleared NOT captured by DNC query (LastCleared <> current)', COUNT(*) FROM dbo.VIEW_OURM v WHERE v.ClearedCurrentSession = 0 AND NOT EXISTS (SELECT 1 FROM dnc_q d WHERE d.idnumber = v.idnumber)
UNION ALL SELECT 'LastCleared values among enrolled-not-cleared (distinct count)', COUNT(DISTINCT LastCleared) FROM dbo.VIEW_OURM WHERE ClearedCurrentSession = 0
UNION ALL SELECT 'DNR: LastCleared=previous AND flag=1 (any balance)', COUNT(*) FROM dnr_q
UNION ALL SELECT 'DNR: ... AND balance > 0  (= supplied query)', COUNT(*) FROM dnr_q WHERE AccountBalance > 0
UNION ALL SELECT 'DNR: of those (any balance), PRESENT in VIEW_OURM  <-- false DNR risk', COUNT(*) FROM dnr_q d WHERE EXISTS (SELECT 1 FROM enrolled e WHERE e.idnumber = d.idnumber)
UNION ALL SELECT 'DNR: ... balance > 0 AND present in VIEW_OURM', COUNT(*) FROM dnr_q d WHERE d.AccountBalance > 0 AND EXISTS (SELECT 1 FROM enrolled e WHERE e.idnumber = d.idnumber)
UNION ALL SELECT 'Enrolled (VIEW_OURM) with LastCleared = previous term (not rolled?)', COUNT(*) FROM dbo.VIEW_OURM v JOIN prev ON v.LastCleared IN (prev.t, prev.l)
UNION ALL SELECT 'Enrolled (VIEW_OURM) with LastCleared = current term', COUNT(*) FROM dbo.VIEW_OURM v JOIN cur ON v.LastCleared IN (cur.t, cur.l)
UNION ALL SELECT 'Enrolled (VIEW_OURM) with LastCleared = other/XX0000', COUNT(*) FROM dbo.VIEW_OURM v WHERE NOT EXISTS (SELECT 1 FROM cur WHERE v.LastCleared IN (cur.t,cur.l)) AND NOT EXISTS (SELECT 1 FROM prev WHERE v.LastCleared IN (prev.t,prev.l));
"@
$cmd = $c.CreateCommand(); $cmd.CommandText = $sql; $cmd.CommandTimeout = 60
$r = $cmd.ExecuteReader()
"| measure | n |"; "|---|---|"
while ($r.Read()) { "| $($r['measure']) | $($r['n']) |" }
$c.Close()
