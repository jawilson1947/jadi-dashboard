<#
  Creates the writable application login jadi_dash and schema dash on the STAGING server
  (USER-MANAGEMENT-PLAN Sec.1, ASSUMPTIONS A-21) by running db/grants/jadi_dash.sql as the
  sysadmin login stored in the JADI_STAGING_* user environment variables.

  - Generates a random 32-character password; it is never printed.
  - Stores the resulting connection string as user environment variable JADI_DASH_CONNECTION_STRING
    (same place as the JADI_STAGING_* entries) for npm run db:migrate / bootstrap:admin / the app.
  - Verifies as jadi_dash that dbo is read-only and dash is writable (fn_my_permissions).
  Re-running is safe: the login/user are created only if missing; the password is reset to the new value.
  Never run this against production; the DBA creates the production login from the same .sql file.
#>
$ErrorActionPreference = "Stop"
function Env-Or([string]$n) { $v=[Environment]::GetEnvironmentVariable($n,"User"); if(-not $v){throw "$n not set"}; $v }
$server = Env-Or "JADI_STAGING_SERVER"; $db = Env-Or "JADI_STAGING_DATABASE"
$adminUser = Env-Or "JADI_STAGING_USER"; $adminPw = Env-Or "JADI_STAGING_PASSWORD"

# Password: 32 chars from a URL-safe alphabet plus punctuation so CHECK_POLICY is satisfied.
$alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!#%^*-_=+"
$bytes = New-Object byte[] 48; [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$pw = -join ($bytes | ForEach-Object { $alphabet[$_ % $alphabet.Length] }) ; $pw = $pw.Substring(0,32)
if ($pw -notmatch '[A-Z]' -or $pw -notmatch '[a-z]' -or $pw -notmatch '[0-9]' -or $pw -notmatch '[!#%^*\-_=+]') { $pw = "Ab3!" + $pw.Substring(4) }

$sqlText = Get-Content -Raw (Join-Path $PSScriptRoot "..\db\grants\jadi_dash.sql")
$sqlText = $sqlText.Replace("'<strong password>'", "'" + $pw.Replace("'", "''") + "'")
# Re-runs: also reset the password when the login already exists.
$sqlText = $sqlText.Replace("USE [ousadb];", "ALTER LOGIN jadi_dash WITH PASSWORD = '" + $pw.Replace("'", "''") + "';`r`nUSE [ousadb];")
if ($db -ne "ousadb") { $sqlText = $sqlText.Replace("USE [ousadb];", "USE [$db];") }

$b = New-Object System.Data.SqlClient.SqlConnectionStringBuilder
$b["Data Source"]=$server; $b["Initial Catalog"]="master"; $b["User ID"]=$adminUser; $b["Password"]=$adminPw
$b["Encrypt"]=$false; $b["TrustServerCertificate"]=$true; $b["Connect Timeout"]=20
$c = New-Object System.Data.SqlClient.SqlConnection($b.ConnectionString); $c.Open()
try {
  foreach ($batch in ($sqlText -split "(?m)^\s*GO\s*$")) {
    if ($batch.Trim()) { $cmd = $c.CreateCommand(); $cmd.CommandText = $batch; $cmd.CommandTimeout = 60; [void]$cmd.ExecuteNonQuery() }
  }
} finally { $c.Close() }
"grants applied as $adminUser on $server"

# Connection string for the app (stored, never printed).
$cs = "Server=$server;Database=$db;User Id=jadi_dash;Password=$pw;Encrypt=true;TrustServerCertificate=true"
[Environment]::SetEnvironmentVariable("JADI_DASH_CONNECTION_STRING", $cs, "User")
"JADI_DASH_CONNECTION_STRING stored in the user environment"

# Verify as jadi_dash.
$b2 = New-Object System.Data.SqlClient.SqlConnectionStringBuilder
$b2["Data Source"]=$server; $b2["Initial Catalog"]=$db; $b2["User ID"]="jadi_dash"; $b2["Password"]=$pw
$b2["Encrypt"]=$false; $b2["TrustServerCertificate"]=$true; $b2["Connect Timeout"]=20
$c2 = New-Object System.Data.SqlClient.SqlConnection($b2.ConnectionString); $c2.Open()
try {
  $q = @"
SELECT 'dash' AS scope, permission_name FROM fn_my_permissions('dash','SCHEMA') WHERE permission_name IN ('INSERT','UPDATE','DELETE','ALTER','SELECT')
UNION ALL SELECT 'dbo.tblOUSA', permission_name FROM fn_my_permissions('dbo.tblOUSA','OBJECT') WHERE permission_name IN ('INSERT','UPDATE','DELETE','ALTER','SELECT')
UNION ALL SELECT 'dbo.tblStudent', permission_name FROM fn_my_permissions('dbo.tblStudent','OBJECT') WHERE permission_name IN ('INSERT','UPDATE','DELETE','ALTER','SELECT')
ORDER BY 1,2;
"@
  $cmd = $c2.CreateCommand(); $cmd.CommandText = $q; $r = $cmd.ExecuteReader()
  "| scope | permission |"; "|---|---|"
  while ($r.Read()) { "| $($r[0]) | $($r[1]) |" }
  $r.Close()
  $cmd = $c2.CreateCommand(); $cmd.CommandText = "UPDATE dbo.tblOUSA SET isCurrent = isCurrent WHERE 1 = 0;"
  try { [void]$cmd.ExecuteNonQuery(); "WARNING: dbo write was NOT denied" } catch { "dbo write correctly denied: " + $_.Exception.InnerException.Message.Split("`n")[0] }
} finally { $c2.Close() }
