# Refreshing staging from production (`ousadb` + `jadi`)

Procedure for bringing the staging SQL Server up to date with a production dataset, without
destroying the dashboard's own data.

**Method chosen:** script `dash` out → full restore of both databases → re-apply `dash`.
**Scope:** `ousadb` and `jadi` together (they are cross-referenced — see §0.2).
**PII:** accepted as-is on staging (see §0.4 — this is a standing decision, not a silent one).

Run every step as a sysadmin on the respective instance. Nothing here is run by the application
or by `jadi_dash`.

---

## 0. Read this before the first run

### 0.1 The `dash` schema lives inside `ousadb`

ASSUMPTIONS **A-21** put the dashboard's own tables — users, roles, sessions, jobs, runs,
snapshots, settings, audit, sprint config, operator profiles — in schema `dash` **inside
`ousadb`**. Production has no `dash` schema. A plain `RESTORE ... WITH REPLACE` therefore
deletes:

- the `jwilson` administrator and every other account, with their scrypt password hashes
- all active sessions and outstanding one-time credential tokens
- every captured snapshot and the whole job-run history
- settings, semester sprint rows and operator profiles

§1 preserves them; §6 puts them back. **Do not skip §1.**

### 0.2 Both databases move together

`dbo.VIEW_OURM_TRANS_HIST` in `ousadb` is a local view over `[jadi].dbo.trans_hist`. Refreshing
one database and not the other leaves the payment-profile data inconsistent with everything
else. Restore both from backups taken at the same time.

### 0.3 Linked servers

Linked-server *definitions* are server-scoped (they live in `master`), so the restore does not
create them. The hazard is the other way round: the restored **view definitions** carry
four-part names, and staging already has linked servers registered under those names —
`[172.18.96.11,1433\MSSQL].[TMSEPRD]` for `VIEW_OURM_ACAD`, `[JICSSQL].[tmseprd]` for online
payments (FINDINGS §7, DBA question Q6). After the refresh, anyone querying `VIEW_OURM_ACAD` on
staging reaches **production Jenzabar**. §5 neutralizes this.

### 0.4 Production PII lands on staging

`dbo.tblStudent` carries `SSN`, `dob`, `gender`, `BankAccount` and `PIN` across ~39k rows. The
application never selects those columns (enforced by the allow-list tests in
`src/server/repositories/mssql/sql.ts`), but **the database does not enforce that** — anyone with
a login on the staging instance can read them.

Decision on record: staging is treated as production-equivalent for access control. That is only
true if the staging instance's logins, firewall and backup files are controlled to the same
standard as production. Re-confirm that with the data owner if the staging VM changes hands, and
keep the `.bak` files off general-purpose file shares.

### 0.5 Version check — do this first

A SQL Server backup **cannot be restored onto an older major version.** Staging is SQL Server
2019 Developer Edition (FINDINGS). If production is 2022 or newer, everything below fails at the
restore step and you need a different method (script + `bcp`, or a data-tier application).

Run on **both** servers and compare before doing anything else:

```sql
SELECT
  SERVERPROPERTY('MachineName')        AS server_name,
  SERVERPROPERTY('ProductVersion')     AS version,
  SERVERPROPERTY('ProductMajorVersion')AS major,
  SERVERPROPERTY('Edition')            AS edition,
  SERVERPROPERTY('Collation')          AS collation;

SELECT name, compatibility_level, recovery_model_desc, collation_name
FROM sys.databases WHERE name IN ('ousadb','jadi');
```

Production major must be **≤** staging major. A collation mismatch between the two servers is
tolerable for a straight restore (the database keeps its own collation) but will bite on any
`tempdb` join afterwards — note it if the values differ.

---

## 1. Preserve the staging `dash` schema

On **staging**, copy every `dash` table into a scratch database. `SELECT ... INTO` is used
deliberately: it needs no pre-built schema and none of these tables use IDENTITY columns
(all primary keys are `uniqueidentifier` or `varchar`), so the round trip is lossless.

```sql
USE [master];

/* Do NOT use SET SINGLE_USER to drop a scratch database. If an earlier run
   failed and left it single-user, the one allowed connection is often already
   taken (an SSMS Object Explorer node is the usual culprit) and ALTER DATABASE
   fails with msg 5064 — which then cascades into msg 924 on everything after
   it. Kill the sessions, force MULTI_USER, then drop. */
IF DB_ID('dash_preserve') IS NOT NULL
BEGIN
  DECLARE @kill nvarchar(max) = N'';
  SELECT @kill = @kill + N'KILL ' + CAST(session_id AS nvarchar(10)) + N'; '
  FROM sys.dm_exec_sessions
  WHERE database_id = DB_ID('dash_preserve') AND session_id <> @@SPID;
  IF LEN(@kill) > 0 EXEC sp_executesql @kill;

  IF EXISTS (SELECT 1 FROM sys.databases
             WHERE name = 'dash_preserve' AND user_access_desc <> 'MULTI_USER')
    ALTER DATABASE dash_preserve SET MULTI_USER WITH ROLLBACK IMMEDIATE;

  DROP DATABASE dash_preserve;
END
CREATE DATABASE dash_preserve;
GO

USE [dash_preserve];
GO
SELECT * INTO dbo.Job             FROM ousadb.dash.Job;
SELECT * INTO dbo.JobRun          FROM ousadb.dash.JobRun;
SELECT * INTO dbo.Snapshot        FROM ousadb.dash.Snapshot;
SELECT * INTO dbo.Setting         FROM ousadb.dash.Setting;
SELECT * INTO dbo.AuditEvent      FROM ousadb.dash.AuditEvent;
SELECT * INTO dbo.[User]          FROM ousadb.dash.[User];
SELECT * INTO dbo.Role            FROM ousadb.dash.Role;
SELECT * INTO dbo.Permission      FROM ousadb.dash.Permission;
SELECT * INTO dbo.RolePermission  FROM ousadb.dash.RolePermission;
SELECT * INTO dbo.UserRole        FROM ousadb.dash.UserRole;
SELECT * INTO dbo.UserPermission  FROM ousadb.dash.UserPermission;
SELECT * INTO dbo.[Session]       FROM ousadb.dash.[Session];
SELECT * INTO dbo.CredentialToken FROM ousadb.dash.CredentialToken;
SELECT * INTO dbo.SemesterSprint  FROM ousadb.dash.SemesterSprint;
SELECT * INTO dbo.OperatorProfile FROM ousadb.dash.OperatorProfile;
GO
```

Record the row counts — §6 checks against them:

```sql
SELECT t.name, SUM(p.rows) AS rows
FROM sys.tables t
JOIN sys.partitions p ON p.object_id = t.object_id AND p.index_id IN (0,1)
GROUP BY t.name ORDER BY t.name;
```

Then back the scratch database up, so the preserved copy survives a mistake on the staging box:

```sql
-- Resolve the instance's own backup folder rather than hard-coding a path:
-- a folder that does not exist, or that the SQL Server SERVICE ACCOUNT cannot
-- write to, fails with "Operating system error 3 (The system cannot find the
-- path specified)". Mapped drive letters are invisible to the service.
DECLARE @dir nvarchar(512) = CAST(SERVERPROPERTY('InstanceDefaultBackupPath') AS nvarchar(512));
IF RIGHT(@dir,1) <> '\' SET @dir = @dir + '\';

DECLARE @sql nvarchar(max) =
  N'BACKUP DATABASE dash_preserve TO DISK = ' + QUOTENAME(@dir + N'dash_preserve.bak', '''') +
  N' WITH INIT, CHECKSUM, COMPRESSION, STATS = 10;';
EXEC sp_executesql @sql;
PRINT 'written to ' + @dir + 'dash_preserve.bak';
```

> `dash.SchemaMigration` is deliberately **not** preserved — `npm run db:migrate` rewrites it in §6.

---

## 2. Back up production

On **production**. `COPY_ONLY` is the important word: it takes a full backup without breaking
the production log chain, so your differential backups keep working.

```sql
DECLARE @stamp varchar(20) = CONVERT(varchar(8), GETDATE(), 112) + '_' +
                             REPLACE(CONVERT(varchar(5), GETDATE(), 108), ':', '');

DECLARE @sql nvarchar(max) = N'
BACKUP DATABASE [ousadb] TO DISK = ''\\BACKUPSHARE\refresh\ousadb_' + @stamp + N'.bak''
  WITH COPY_ONLY, INIT, CHECKSUM, COMPRESSION, STATS = 5;
BACKUP DATABASE [jadi]   TO DISK = ''\\BACKUPSHARE\refresh\jadi_'   + @stamp + N'.bak''
  WITH COPY_ONLY, INIT, CHECKSUM, COMPRESSION, STATS = 5;';
EXEC sp_executesql @sql;
```

Verify before you move anything — a bad backup discovered after you have dropped staging is a
long afternoon:

```sql
RESTORE VERIFYONLY FROM DISK = '\\BACKUPSHARE\refresh\ousadb_<stamp>.bak' WITH CHECKSUM;
RESTORE VERIFYONLY FROM DISK = '\\BACKUPSHARE\refresh\jadi_<stamp>.bak'   WITH CHECKSUM;
```

Copy both files to the staging server (or restore straight from the share if staging's service
account can read it).

---

## 3. Inspect the backup's file layout

Physical paths inside the backup are production's. Staging almost certainly differs, so get the
logical names for the `MOVE` clauses:

```sql
RESTORE FILELISTONLY FROM DISK = 'D:\Restore\ousadb_<stamp>.bak';
RESTORE FILELISTONLY FROM DISK = 'D:\Restore\jadi_<stamp>.bak';
```

Note each `LogicalName` and `Type` (`D` = data, `L` = log). Also confirm the backup is what you
think it is:

```sql
RESTORE HEADERONLY FROM DISK = 'D:\Restore\ousadb_<stamp>.bak';
-- check BackupFinishDate, ServerName, DatabaseName, SoftwareVersionMajor
```

---

## 4. Restore onto staging

Stop the application first, or the restore cannot get exclusive access:

```powershell
Stop-Service jadi-dashboard-worker, jadi-dashboard-web
```

Then, on **staging**:

```sql
USE [master];

ALTER DATABASE [ousadb] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
ALTER DATABASE [jadi]   SET SINGLE_USER WITH ROLLBACK IMMEDIATE;

RESTORE DATABASE [ousadb]
  FROM DISK = 'D:\Restore\ousadb_<stamp>.bak'
  WITH REPLACE, RECOVERY, CHECKSUM, STATS = 5,
    MOVE 'ousadb'     TO 'D:\SQLData\ousadb.mdf',
    MOVE 'ousadb_log' TO 'L:\SQLLogs\ousadb_log.ldf';

RESTORE DATABASE [jadi]
  FROM DISK = 'D:\Restore\jadi_<stamp>.bak'
  WITH REPLACE, RECOVERY, CHECKSUM, STATS = 5,
    MOVE 'jadi'     TO 'D:\SQLData\jadi.mdf',
    MOVE 'jadi_log' TO 'L:\SQLLogs\jadi_log.ldf';

ALTER DATABASE [ousadb] SET MULTI_USER;
ALTER DATABASE [jadi]   SET MULTI_USER;
```

Substitute the logical names from §3 — they are frequently *not* the database name.

Staging does not need production's recovery model or its owner:

```sql
ALTER DATABASE [ousadb] SET RECOVERY SIMPLE;
ALTER DATABASE [jadi]   SET RECOVERY SIMPLE;
ALTER AUTHORIZATION ON DATABASE::[ousadb] TO sa;
ALTER AUTHORIZATION ON DATABASE::[jadi]   TO sa;
```

---

## 5. Post-restore repairs

### 5.1 Orphaned users

Database users restored from production carry production's SIDs and no longer match staging's
logins. Find them:

```sql
USE [ousadb];
SELECT dp.name, dp.type_desc, dp.sid
FROM sys.database_principals dp
LEFT JOIN sys.server_principals sp ON sp.sid = dp.sid
WHERE dp.type IN ('S','U','G') AND dp.authentication_type <> 0
  AND sp.sid IS NULL AND dp.name NOT IN ('dbo','guest','INFORMATION_SCHEMA','sys');
```

Re-map the two the application needs (repeat in `[jadi]`):

```sql
USE [ousadb];
IF USER_ID('jadi_readonly') IS NOT NULL ALTER USER jadi_readonly WITH LOGIN = jadi_readonly;
IF USER_ID('jadi_dash')     IS NOT NULL ALTER USER jadi_dash     WITH LOGIN = jadi_dash;
```

If either user did not come across in the backup, re-run `db\grants\jadi_dash.sql` — it is
idempotent and re-creates the user, the schema and the DENYs.

Drop production-only users that have no business on staging.

### 5.2 Neutralize the production linked servers (§0.3)

Confirm what staging's linked servers actually point at, and repoint or remove any that reach
production:

```sql
SELECT s.name, s.data_source, s.product, s.provider
FROM sys.servers s WHERE s.is_linked = 1;
```

Until the DBA confirms a non-production target, the safe move is to deny access rather than
drop the linked server (dropping breaks the view definitions):

```sql
EXEC sp_droplinkedsrvlogin @rmtsrvname = N'JICSSQL', @locallogin = NULL;
```

`VIEW_OURM_ACAD` then fails loudly instead of quietly reading production. The application does
not touch it (`sql.ts` forbids linked servers and that view, and the tests enforce it), so
nothing in the dashboard breaks.

### 5.3 Statistics

Restored statistics reflect production's data. Refresh them, or the first snapshot run will pick
bad plans on views that already take 40–120 s (FINDINGS §6):

```sql
USE [ousadb]; EXEC sp_updatestats;
USE [jadi];   EXEC sp_updatestats;
```

---

## 6. Rebuild and re-populate `dash`

Recreate the schema from the migrations, then put the preserved rows back.

```powershell
cd C:\jadiDashboard
npm run db:migrate
```

This recreates all `dash` tables and repopulates `dash.SchemaMigration`. Then re-import, **in
this order** — foreign keys run Role/Permission → User → everything else:

```sql
USE [ousadb];

INSERT INTO dash.Role            SELECT * FROM dash_preserve.dbo.Role;
INSERT INTO dash.Permission      SELECT * FROM dash_preserve.dbo.Permission;
INSERT INTO dash.RolePermission  SELECT * FROM dash_preserve.dbo.RolePermission;
INSERT INTO dash.[User]          SELECT * FROM dash_preserve.dbo.[User];
INSERT INTO dash.UserRole        SELECT * FROM dash_preserve.dbo.UserRole;
INSERT INTO dash.UserPermission  SELECT * FROM dash_preserve.dbo.UserPermission;
INSERT INTO dash.CredentialToken SELECT * FROM dash_preserve.dbo.CredentialToken;
INSERT INTO dash.Job             SELECT * FROM dash_preserve.dbo.Job;
INSERT INTO dash.JobRun          SELECT * FROM dash_preserve.dbo.JobRun;
INSERT INTO dash.Snapshot        SELECT * FROM dash_preserve.dbo.Snapshot;
INSERT INTO dash.Setting         SELECT * FROM dash_preserve.dbo.Setting;
INSERT INTO dash.AuditEvent      SELECT * FROM dash_preserve.dbo.AuditEvent;
INSERT INTO dash.SemesterSprint  SELECT * FROM dash_preserve.dbo.SemesterSprint;
INSERT INTO dash.OperatorProfile SELECT * FROM dash_preserve.dbo.OperatorProfile;
```

Two deliberate omissions and one cleanup:

- `dash.[Session]` is **not** restored. Sessions are HMAC-signed cookies bound to server-side
  rows; forcing everyone to sign in again after a data refresh is correct, not a defect.
- `dash.SchemaMigration` comes from `db:migrate`, not from the preserved copy.
- Clear stale job locks, or the worker will think a run is still in flight:

```sql
UPDATE dash.Job SET lockedAt = NULL, lockedBy = NULL WHERE lockedAt IS NOT NULL;
UPDATE dash.JobRun SET status = 'FAILED'
WHERE status = 'RUNNING';
```

Verify against the counts from §1:

```sql
SELECT 'User' t, COUNT(*) n FROM dash.[User]
UNION ALL SELECT 'Snapshot', COUNT(*) FROM dash.Snapshot
UNION ALL SELECT 'JobRun',   COUNT(*) FROM dash.JobRun
UNION ALL SELECT 'AuditEvent', COUNT(*) FROM dash.AuditEvent;
```

Confirm the grants survived — this is the check that keeps A-21's promise honest:

```sql
EXECUTE AS USER = 'jadi_dash';
SELECT * FROM fn_my_permissions('dash', 'SCHEMA');           -- expect INSERT/UPDATE/DELETE/ALTER
SELECT * FROM fn_my_permissions('dbo.tblStudent','OBJECT');  -- expect SELECT only
REVERT;
```

If the DENYs are missing, re-run `db\grants\jadi_dash.sql`.

---

## 7. Bring the application back

```powershell
Start-Service jadi-dashboard-web, jadi-dashboard-worker
Get-Content C:\jadiDashboard\logs\worker.log -Tail 30
```

Then check:

| Check | Expected |
|---|---|
| Sign in as `jwilson` | Existing password still works (hashes were preserved) |
| Administration → Jobs | Job list intact, no job stuck in RUNNING |
| Administration → Jobs → Run now | New run SUCCEEDS against the refreshed data |
| Administration → Semester metadata | `tblOUSA` shows production's current/previous term |
| Current Semester Dashboard | Hero card figures match production's `tblOUSA.census` / `FinanciallyCleared` |
| Reconciliation line | Balances per A-2 |
| DNR / DNC card | Counts have moved from the old staging figures (73 / 111) |
| `npm run test:staging` | Aggregate reconciliation passes against the new data |

The last one is the real acceptance test — it reads the aggregates and checks reconciliation.

Finally, drop the scratch database once you are satisfied:

```sql
USE [master];   -- move your session out of it first, or the drop blocks on you
DROP DATABASE dash_preserve;
```

Keep `dash_preserve.bak` until the next refresh.

---

## 8. If it goes wrong

The restore is not reversible in place — there is no staging backup unless you took one. So:

**Take a staging backup before §4**, every time:

```sql
BACKUP DATABASE [ousadb] TO DISK = 'D:\Backup\ousadb_staging_pre_refresh.bak'
  WITH COPY_ONLY, INIT, CHECKSUM, COMPRESSION, STATS = 5;
BACKUP DATABASE [jadi]   TO DISK = 'D:\Backup\jadi_staging_pre_refresh.bak'
  WITH COPY_ONLY, INIT, CHECKSUM, COMPRESSION, STATS = 5;
```

Rolling back is then the same `RESTORE` as §4 pointed at those files. Between that backup and
`dash_preserve.bak`, nothing on staging is unrecoverable.

---

## 9. Notes for the DBA

- Open DBA question **Q3** ("is a non-production copy of `ousadb` available for Phase 6
  validation?") is effectively answered by this procedure — worth closing in `ASSUMPTIONS.md`.
- Question **Q6** (where the staging linked servers point) is still open and directly gates §5.2.
- If production ever moves to a newer SQL Server major version than staging, §0.5 fails and this
  whole procedure needs replacing. Flag a staging upgrade at the same time as any production one.
- Refresh cadence is not yet agreed. Between refreshes, staging drifts from production and the
  snapshot history in `dash` mixes data from both — worth a note in the UI if the gap grows.
