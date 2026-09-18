$e=[Environment]::GetEnvironmentVariable
$b = New-Object System.Data.SqlClient.SqlConnectionStringBuilder
$b["Data Source"]=$e.Invoke('JADI_STAGING_SERVER','User'); $b["Initial Catalog"]=$e.Invoke('JADI_STAGING_DATABASE','User')
$b["User ID"]=$e.Invoke('JADI_STAGING_USER','User'); $b["Password"]=$e.Invoke('JADI_STAGING_PASSWORD','User')
$b["Encrypt"]=$false; $b["TrustServerCertificate"]=$true
$c = New-Object System.Data.SqlClient.SqlConnection($b.ConnectionString); $c.Open()
function T([string]$label,[string]$sql){ $sw=[Diagnostics.Stopwatch]::StartNew(); try { $cmd=$c.CreateCommand(); $cmd.CommandText=$sql; $cmd.CommandTimeout=300; $r=$cmd.ExecuteReader(); $vals=@(); while($r.Read()){ for($i=0;$i -lt $r.FieldCount;$i++){ $vals += "$($r.GetName($i))=$($r[$i])" } }; $r.Close(); "| $label | $($sw.Elapsed.TotalSeconds.ToString('0.0')) s | $($vals -join ', ') |" } catch { "| $label | $($sw.Elapsed.TotalSeconds.ToString('0.0')) s | ERROR $($_.Exception.Message.Substring(0,[Math]::Min(120,$_.Exception.Message.Length))) |" } }
"| query | time | result |"; "|---|---|---|"
T "VIEW_OURM count" "SELECT COUNT(*) AS n FROM dbo.VIEW_OURM"
T "VIEW_OURM_CLEARED distinct" "SELECT COUNT(*) AS rows_, COUNT(DISTINCT ID_NUMBER) AS distinct_ FROM dbo.VIEW_OURM_CLEARED"
T "CLEARED not in VIEW_OURM" "SELECT COUNT(DISTINCT c.ID_NUMBER) AS n FROM dbo.VIEW_OURM_CLEARED c WHERE NOT EXISTS (SELECT 1 FROM dbo.VIEW_OURM v WHERE v.idnumber = CAST(c.ID_NUMBER AS varchar(50)))"
T "STATS single scan" "SELECT COUNT(*) AS n, SUM(CASE WHEN NOT EXISTS (SELECT 1 FROM dbo.VIEW_OURM v WHERE v.idnumber = CAST(s.idnumber AS varchar(50))) THEN 1 ELSE 0 END) AS notEnrolled FROM dbo.VIEW_OURM_STATS s WHERE s.[rows] = 1"
T "items direct (jadi)" "SELECT COUNT(DISTINCT i.ID_NUMBER) AS n FROM [jadi].[dbo].[items] i JOIN dbo.tblOUSA o ON o.isCurrent = 1 AND i.ACTION_CODE IN (o.Trad_ActionCode, o.Leap_ActionCode)"
T "STATS vs CLEARED diff" "SELECT (SELECT COUNT(DISTINCT ID_NUMBER) FROM dbo.VIEW_OURM_CLEARED) - (SELECT COUNT(*) FROM dbo.VIEW_OURM_STATS WHERE [rows]=1) AS diff"
T "charges+credits sums" "SELECT (SELECT SUM(Charges) FROM dbo.VIEW_OURM_CHARGES) AS charges, (SELECT SUM(credits) FROM dbo.VIEW_OURM_CREDITS) AS credits"
T "student page (dnr, no stats join)" "WITH prev AS (SELECT JADI_TradName t, JADI_LeapName l FROM dbo.tblOUSA WHERE wasCurrent=1) SELECT COUNT(*) AS n FROM dbo.tblStudent S WHERE EXISTS (SELECT 1 FROM prev WHERE S.LastCleared IN (prev.t,prev.l)) AND S.ClearedCurrentSession=1 AND S.AccountBalance>0 AND NOT EXISTS (SELECT 1 FROM dbo.VIEW_OURM v WHERE v.idnumber=S.idnumber)"
T "student_master join (jadi) 5 rows" "SELECT TOP 5 S.idnumber, CASE WHEN SM.TEL_WEB_GRP_CDE='22' THEN 1 ELSE 0 END AS t FROM dbo.tblStudent S LEFT JOIN [jadi].[dbo].[student_master] SM ON CAST(SM.ID_NUM AS varchar(50)) = S.idnumber WHERE S.AccountBalance > 0"
$c.Close()
