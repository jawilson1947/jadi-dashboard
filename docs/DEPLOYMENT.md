# Deployment — Windows Server 2019 VM

Target topology for staging and production:

```
browser ──HTTPS:443──> IIS (URL Rewrite + ARR)
                         └─ http://127.0.0.1:3000 ──> jadi-dashboard-web   (Windows service: next start)
                                                       jadi-dashboard-worker (Windows service: npm run worker)
                                                          └── ousadb  (SQL Server)
                                                              ├─ dbo  read-only via jadi_readonly / jadi_dash
                                                              └─ dash read/write via jadi_dash
```

Configuration decided for this install: **IIS reverse proxy**, **`DATA_PROVIDER=mssql` + `APP_STORE=mssql`**,
**worker as its own Windows service**. HTTPS terminates at IIS; Node listens on loopback only.

Reminder from the Spec: the application never writes to Jenzabar. Only schema `dash` is writable,
and `db/grants/jadi_dash.sql` DENYs writes on `dbo` so that is provable.

---

## 0. Before you start — collect these

| Item | Who provides | Notes |
|---|---|---|
| VM name / FQDN for the site | You | e.g. `jadi.ousa.edu` — must match the TLS certificate |
| TLS certificate (PFX) | Network/PKI | Internal CA is fine; the cookie is `Secure` outside development |
| SQL Server host + instance for `ousadb` | DBA | |
| `jadi_readonly` password | DBA | read-only source login |
| `jadi_dash` password | DBA | created by `db/grants/jadi_dash.sql` |
| Service account to run the two services | AD | local account is acceptable if SQL auth is used |
| Admin username / email for the first dashboard administrator | You | `jwilson` / your address |

Decide the deployment folder now. This runbook uses `C:\jadiDashboard`.

---

## 1. Prepare the VM

1. **Patch and reboot.** Windows Server 2019 with current cumulative updates.
2. **Install Node.js 22 LTS (x64 MSI)** from nodejs.org. Next 16 requires Node ≥ 20.9; the
   development machine runs 22.x, so match that major version.
   ```powershell
   node -v    # expect v22.x
   npm -v
   ```
3. **Git is not required.** Carbon Black blocks the Git for Windows installer on this VM, so the
   code arrives as a zip (§3). Nothing in the build or runtime needs git.
4. **Install the VC++ runtime** if not present; `mssql`/tedious is pure JS, but the Node MSI
   installs what it needs.
5. **Firewall:** allow inbound 443 (and 80 only for the HTTP→HTTPS redirect). Do **not** open 3000.
6. **Outbound to SQL Server:** confirm TCP 1433 (or your instance port) reaches the database host.
   ```powershell
   Test-NetConnection -ComputerName SQLHOST -Port 1433
   ```
7. **Create the deployment folder** and give the service account Modify rights:
   ```powershell
   New-Item -ItemType Directory C:\jadiDashboard -Force
   New-Item -ItemType Directory C:\jadiDashboard\logs -Force
   ```

---

## 2. Install IIS, URL Rewrite and ARR

1. Add the Web Server role:
   ```powershell
   Install-WindowsFeature -Name Web-Server,Web-Http-Redirect,Web-Windows-Auth,Web-Mgmt-Console `
     -IncludeManagementTools
   ```
2. Install, in this order, from the Microsoft download pages (or Web Platform Installer if you
   still have it):
   - **URL Rewrite 2.1**
   - **Application Request Routing 3.0**
3. **Enable the proxy** — this step is the one people forget: IIS Manager → select the *server*
   node → **Application Request Routing Cache** → *Server Proxy Settings* (right pane) →
   tick **Enable proxy** → Apply.
4. Leave *Reverse rewrite host in response headers* **unticked**.

---

## 3. Get the code onto the VM

Carbon Black blocks the Git for Windows installer on this VM, so the deployment path is
**zip on the workstation → copy → expand on the VM**. Git on the server is a convenience, not a
requirement: nothing in the build or runtime uses it.

### 3a. Build the archive on the workstation

From the development machine (`C:\jadiDashboard`), in PowerShell:

```powershell
$stamp = Get-Date -Format yyyy-MM-dd
$exclude = @('node_modules','.next','.git','.data','.env.local','tsconfig.tsbuildinfo','logs')
$staging = "$env:TEMP\jadi-stage"
Remove-Item $staging -Recurse -Force -ErrorAction SilentlyContinue
robocopy C:\jadiDashboard $staging /E /XD node_modules .next .git .data logs /XF .env.local tsconfig.tsbuildinfo | Out-Null
Compress-Archive -Path "$staging\*" -DestinationPath "C:\jadi-dashboard-src-$stamp.zip" -Force
```

The archive is **~550 KB / ~315 files** — source, `package.json`, `package-lock.json`,
`db\`, `scripts\`, `docs\`, `tests\`, `public\`. It deliberately leaves out:

| Excluded | Why |
|---|---|
| `node_modules\` | 549 MB; rebuilt on the VM by `npm ci` from the lockfile |
| `.next\` | 781 MB of build output; rebuilt by `npm run build` |
| `.env.local` | holds SQL passwords and the session secret — §5 creates a *different* one on the VM |
| `.data\` | development JSON stores, meaningless in production |
| `.git\` | not needed at runtime |
| `scripts\sql_server_Login.txt` | credentials scratch file — see the warning below |

> ⚠️ **`scripts\sql_server_Login.txt` is tracked in git and contains password lines.** It is
> excluded from the deployment archive, but it should also be removed from the repository
> (`git rm --cached`, add to `.gitignore`, and rotate anything it names), since it has already
> been pushed to GitHub.

### 3b. Transfer

Copy the zip to the VM by whatever channel your security policy allows — RDP clipboard/drive
redirection, an approved file share, or `Copy-Item` over a PowerShell session:

```powershell
$s = New-PSSession -ComputerName JADIVM
Copy-Item "C:\jadi-dashboard-src-$stamp.zip" -Destination "C:\" -ToSession $s
```

Carbon Black may still inspect the archive on arrival. If it quarantines it, have the security
team allow-list the destination path rather than disabling the agent — and note that a
source-only zip with no `.exe`/`.dll` and no `node_modules` gives it far less to object to
than a fat archive would.

### 3c. Expand and build on the VM

```powershell
Expand-Archive -Path C:\jadi-dashboard-src-2026-09-21.zip -DestinationPath C:\jadiDashboard -Force
cd C:\jadiDashboard
npm ci                 # uses package-lock.json; do not use `npm install` on the server
npm run typecheck
npm test
npm run build          # produces .next\ — must be re-run after every code update
```

`npm ci` needs outbound HTTPS to `registry.npmjs.org`. Confirm before you start:

```powershell
Test-NetConnection registry.npmjs.org -Port 443
npm ping
```

If a proxy is required: `npm config set proxy http://proxy:8080` and `https-proxy` likewise.

> **If npm is ever blocked too**, the fallback is a fat archive that also includes
> `node_modules\` (~550 MB). That works here because every native binary in the tree is already
> `win32-x64` — `@next/swc`, `sharp`, `lightningcss`, `@tailwindcss/oxide`, `rolldown`,
> `unrs-resolver` — matching the VM's architecture. Skip `npm ci` in that case and go straight
> to `npm run build`.

> `npm ci` deletes and recreates `node_modules`. Budget a few minutes on a fresh VM.

---

## 4. Database setup (DBA)

> **Production instances:** do not use the steps below or `npm run db:migrate`. Production's
> `dash` schema is managed entirely with T-SQL — see `db\production\README.md`, which covers
> the login, the schema, the seeds, the content import and every future change. The steps in
> this section apply to development and staging.


1. Edit `db\grants\jadi_dash.sql`, replace `<strong password>`, and run it as sysadmin on the
   `ousadb` instance. It creates login `jadi_dash`, schema `dash`, grants read on `dbo` and
   `jadi`, full rights inside `dash`, and **DENYs** INSERT/UPDATE/DELETE/ALTER on `dbo`.
2. Confirm `jadi_readonly` exists for the source reads (`DATA_PROVIDER=mssql`).
3. Verify the grants by connecting as `jadi_dash`:
   ```sql
   SELECT * FROM fn_my_permissions('dash', 'SCHEMA');           -- INSERT/UPDATE/DELETE/ALTER present
   SELECT * FROM fn_my_permissions('dbo.tblStudent','OBJECT');  -- SELECT only
   ```
4. Leave the nightly 9 pm SQL Agent job that populates `tblOUSA` alone — the dashboard reads it
   and must never write it.

---

## 5. Create `.env.local` on the server

Generate a session secret first (never reuse the development one):

```powershell
[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Max 256 }))
```

Create `C:\jadiDashboard\.env.local`:

```ini
APP_ENV=production
DATA_PROVIDER=mssql
AUTH_DEV_LOGIN=false
SESSION_SECRET=<the base64 value you just generated>
APP_TIMEZONE=America/Chicago
APP_BASE_URL=https://jadi.ousa.edu
STALE_AFTER_MINUTES=180
DELTA_WARNING_RATIO=0.10

APP_STORE=mssql
WORKER_ID=worker-1

# Both targets live here; DB_TARGET picks one at launch (docs/TARGET-SWITCHING-PLAN.md).
# On this VM the services set DB_TARGET=production, so only the _PRODUCTION pair is used --
# but keeping both lets `npm run verify:target` reach staging from here when diagnosing.
DASH_CONNECTION_STRING_PRODUCTION="Server=OUSASERVER03;Database=ousadb;User Id=jadi_dash;Password=<pw>;Encrypt=true;TrustServerCertificate=true"
OUSADB_CONNECTION_STRING_PRODUCTION="Server=OUSASERVER03;Database=ousadb;User Id=jadi_readonly;Password=<pw>;Encrypt=true;TrustServerCertificate=true"
DASH_CONNECTION_STRING_STAGING="Server=STAGINGHOST;Database=ousadb;User Id=jadi_dash;Password=<pw>;Encrypt=true;TrustServerCertificate=true"
OUSADB_CONNECTION_STRING_STAGING="Server=STAGINGHOST;Database=ousadb;User Id=jadi_readonly;Password=<pw>;Encrypt=true;TrustServerCertificate=true"

PASSWORD_MIN_LENGTH=12
LOCKOUT_THRESHOLD=5
LOCKOUT_MINUTES=15
SESSION_IDLE_HOURS=8
SESSION_ABSOLUTE_HOURS=12
CREDENTIAL_TOKEN_HOURS=72
```

Then lock the file down — it holds two SQL passwords and the session key:

```powershell
icacls C:\jadiDashboard\.env.local /inheritance:r `
  /grant "Administrators:(R,W)" /grant "<service account>:(R)"
```

Checks worth making before you go further:

- `APP_ENV=production` turns on the `Secure` cookie flag and makes the app **refuse** dev sign-in.
  HTTPS at IIS is therefore mandatory, not optional.
- `AUTH_DEV_LOGIN=false` — confirm there is no synthetic sign-in on the sign-in page after cutover.
- `TrustServerCertificate=true` is only appropriate while the SQL Server certificate is self-signed.
  Ask the DBA to install a trusted cert and set it to `false`.

---

## 6. Apply migrations and create the first administrator

The schema itself is applied by the T-SQL scripts in `db\production\` (see that folder's
README), not by `npm run db:migrate` — which targets **staging** and must not be pointed here.

Once `db\production\02_schema.sql` and `03_seed_jobs.sql` have run, confirm the app agrees
about which server it is talking to before creating anyone:

```powershell
cd C:\jadiDashboard
npm run verify:target:prod
```

Then the first administrator. Note the `:prod` suffix — without it this creates the account on
**staging**, and the failure is silent because it succeeds there:

```powershell
$env:BOOTSTRAP_ADMIN_USERNAME="jwilson"
$env:BOOTSTRAP_ADMIN_EMAIL="jwilson@digitalsupportsystems.com"
$env:BOOTSTRAP_ADMIN_NAME="Jim Wilson"
npm run bootstrap:admin:prod
```

(If the accounts are being imported from staging by `db\production\04_import_from_staging.sql`
instead, skip this step — an administrator already exists and `bootstrap:admin` refuses to run.)

It prints a **one-time set-password link**, valid 72 hours, single use, built from `APP_BASE_URL`.
Copy it now — it is never shown again — and open it after the site is live (§8). The script
refuses to run once any administrator exists; everyone else is created in Administration → Users.

---

## 7. Register the two Windows services

Install **NSSM** (`C:\tools\nssm\nssm.exe`) or use WinSW if NSSM is not approved in your environment.

> **`DB_TARGET=production` is required on both services.** These commands invoke Node against
> `next` / `tsx` directly, so they bypass npm and never see the `cross-env DB_TARGET=...` that the
> `npm run *:prod` scripts supply. Without it the resolver would fall back to its default of
> `staging` (`docs/TARGET-SWITCHING-PLAN.md`). The `APP_ENV=production` guard in
> `src/server/db/config.ts` catches the omission and refuses to start rather than running a
> production deployment against staging — a loud failure, but set it deliberately instead.

**Web service**

```powershell
nssm install jadi-dashboard-web "C:\Program Files\nodejs\node.exe" `
  "C:\jadiDashboard\node_modules\next\dist\bin\next" start -p 3000 -H 127.0.0.1
nssm set jadi-dashboard-web AppDirectory C:\jadiDashboard
nssm set jadi-dashboard-web AppEnvironmentExtra NODE_ENV=production DB_TARGET=production
nssm set jadi-dashboard-web AppStdout C:\jadiDashboard\logs\web.log
nssm set jadi-dashboard-web AppStderr  C:\jadiDashboard\logs\web.err.log
nssm set jadi-dashboard-web AppRotateFiles 1
nssm set jadi-dashboard-web Start SERVICE_AUTO_START
nssm set jadi-dashboard-web ObjectName ".\<service account>" "<password>"
```

Binding to `127.0.0.1` is deliberate: only IIS can reach the app.

**Worker service**

```powershell
nssm install jadi-dashboard-worker "C:\Program Files\nodejs\node.exe" `
  "C:\jadiDashboard\node_modules\tsx\dist\cli.mjs" "C:\jadiDashboard\src\worker.ts"
nssm set jadi-dashboard-worker AppDirectory C:\jadiDashboard
nssm set jadi-dashboard-worker AppEnvironmentExtra NODE_ENV=production DB_TARGET=production
nssm set jadi-dashboard-worker AppStdout C:\jadiDashboard\logs\worker.log
nssm set jadi-dashboard-worker AppStderr  C:\jadiDashboard\logs\worker.err.log
nssm set jadi-dashboard-worker AppRotateFiles 1
nssm set jadi-dashboard-worker Start SERVICE_AUTO_START
nssm set jadi-dashboard-worker ObjectName ".\<service account>" "<password>"
```

Start them and confirm:

```powershell
Start-Service jadi-dashboard-web, jadi-dashboard-worker
Invoke-WebRequest http://127.0.0.1:3000 -UseBasicParsing | Select-Object StatusCode
Get-Content C:\jadiDashboard\logs\worker.log -Tail 20
```

The worker logs `worker started` and then a **startup catch-up run** for every job family that has
never succeeded — that is what puts data on the dashboard on a fresh install. Only one worker may
run against the store; keep `WORKER_ID` unique if that ever changes.

**Confirm the target before you trust either service.** Both log a `config resolved` line at
startup carrying `target`, `ousaHost` and `dashHost` (hosts only — never the connection strings),
and the worker's `worker started` line repeats them:

```powershell
Select-String -Path C:\jadiDashboard\logs\web.log,C:\jadiDashboard\logs\worker.log `
  -Pattern '"target"' | Select-Object -Last 4
```

Both must read `"target":"production"` with the production host. For an independent check that
connects and asks the server its own name:

```powershell
cd C:\jadiDashboard
npm run verify:target:prod
```

---

## 8. IIS site, certificate and reverse-proxy rule

1. Import the PFX: IIS Manager → server node → **Server Certificates** → Import.
2. Create a site `jadi-dashboard` with physical path `C:\inetpub\jadi-dashboard` (an empty folder —
   IIS serves nothing itself), HTTPS binding on 443 with the certificate and the correct hostname.
3. Add an HTTP:80 binding **only** to carry a redirect to HTTPS.
4. Put this `web.config` in `C:\inetpub\jadi-dashboard`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <system.webServer>
    <rewrite>
      <rules>
        <rule name="HTTPS redirect" stopProcessing="true">
          <match url="(.*)" />
          <conditions><add input="{HTTPS}" pattern="off" /></conditions>
          <action type="Redirect" url="https://{HTTP_HOST}/{R:1}" redirectType="Permanent" />
        </rule>
        <rule name="Proxy to Next.js" stopProcessing="true">
          <match url="(.*)" />
          <action type="Rewrite" url="http://127.0.0.1:3000/{R:1}" />
          <serverVariables>
            <set name="HTTP_X_FORWARDED_PROTO" value="https" />
            <set name="HTTP_X_FORWARDED_HOST"  value="{HTTP_HOST}" />
          </serverVariables>
        </rule>
      </rules>
    </rewrite>
    <httpProtocol>
      <customHeaders>
        <add name="Strict-Transport-Security" value="max-age=31536000; includeSubDomains" />
        <remove name="X-Powered-By" />
      </customHeaders>
    </httpProtocol>
    <security>
      <requestFiltering><requestLimits maxAllowedContentLength="20971520" /></requestFiltering>
    </security>
  </system.webServer>
</configuration>
```

5. Allow the two server variables: IIS Manager → site → **URL Rewrite** → *View Server Variables* →
   add `HTTP_X_FORWARDED_PROTO` and `HTTP_X_FORWARDED_HOST`. Without this the rule fails at runtime.
6. **Turn off response buffering** so streamed React responses are not held back:
   site → Configuration Editor → `system.webServer/proxy` → `responseBufferLimit = 0`,
   and raise `timeout` from 30 s to 120 s for long snapshot requests.
7. `iisreset` (or recycle the site), then browse to `https://jadi.ousa.edu`.

ARR forwards the client address in `X-Forwarded-For`, which is what the sign-in rate limiter
(`src/server/identity/rate-limit.ts`) uses — verify a wrong-password attempt from two different
machines locks them independently, not the whole site.

---

## 9. Post-install verification

| Check | Expected |
|---|---|
| `https://<fqdn>` loads the sign-in page | Certificate valid, no mixed content |
| Sign-in page shows **no** dev accounts | `AUTH_DEV_LOGIN=false`, `APP_ENV=production` |
| Open the one-time link from §6, set a password, sign in | Administrator session established |
| Session cookie in DevTools | `HttpOnly`, `Secure`, `SameSite` set |
| Administration → Jobs | Job families listed, last run SUCCEEDED |
| Administration → Jobs → Run now | New run appears, snapshot timestamp advances |
| Current Semester Dashboard | Hero card populated; reconciliation line balances; no "Unavailable" tiles |
| Administration → Semester metadata | `tblOUSA` read-through returns current/previous term |
| Sign in as a Viewer | Student drill-down blocked (no `student.view`) |
| `SELECT * FROM dash.JobRun ORDER BY startedAt DESC` | Rows from the service, not your laptop |
| `Select-String ... '"target"'` in both logs | `"target":"production"` and the production host in each |
| `npm run verify:target:prod` | Reaches `OUSASERVER03` on both connections |
| Reboot the VM | Both services auto-start; dashboard reachable without intervention |
| Attempt a write as `jadi_dash` on `dbo` | Permission denied |

---

## 10. Routine operations

**Deploying an update**

```powershell
Stop-Service jadi-dashboard-worker, jadi-dashboard-web
Expand-Archive -Path C:\jadi-dashboard-src-<date>.zip -DestinationPath C:\jadiDashboard -Force
cd C:\jadiDashboard
npm ci
npm run build
Start-Service jadi-dashboard-web, jadi-dashboard-worker
```

Stop the worker **first** and start it **last**, so no job is mid-run while `.next` is replaced.

`npm run db:migrate` is deliberately **not** in that sequence: production's `dash` schema is
managed with T-SQL (`db\production\README.md`), and the plain `db:migrate` script targets
staging. If a release carries a schema change, apply its numbered script from `db\production\`
while the services are stopped.

**Rollback:** keep the previous `jadi-dashboard-src-<date>.zip` on the VM and expand it over
`C:\jadiDashboard`, then `npm ci && npm run build`. Keep at least the last two archives — with no
git on the server, those zips *are* your version history. Migrations are forward-only — a schema change that must be undone needs a new migration file, so review
`db\migrations\` before every upgrade.

**Logs:** `C:\jadiDashboard\logs\*.log` (NSSM rotation), IIS logs under
`C:\inetpub\logs\LogFiles`, and Windows Event Log → Application for service crashes.

**Secrets rotation:** `npm run reset:credentials` handles dashboard credentials; changing
`SESSION_SECRET` invalidates every session and requires a web-service restart.

**Backups:** the `dash` schema is inside `ousadb`, so it is covered by the existing database
backup — confirm with the DBA that the ousadb backup plan is in force. Also back up
`.env.local` (to your password vault, not to a file share).

---

## 11. Open items before production sign-off

- `ASSUMPTIONS.md` **A-3** and **A-18** are still 🔴 — confirm with the business owner.
- `ASSUMPTIONS.md` **A-21** (schema `dash` co-located in `ousadb`) must be accepted by the DBA in
  writing; if it is refused, a separate application database changes §4 and `DASH_CONNECTION_STRING`.
- Audit events currently use the in-memory sink; the `dash.AuditEvent` table exists but the
  Phase 3 sink is not wired, so **audit history does not survive a restart yet**. Do not claim
  audit retention to the owner until that lands.
- Set `TrustServerCertificate=false` once the SQL Server has a trusted certificate.
- Agree a monitoring check (a scheduled `Invoke-WebRequest` against the site plus a query on the
  newest `dash.JobRun` row) so a stalled worker is noticed before the users notice it.
