# Interim hosting on `mini-it13` (Windows workstation)

**Decided shape:** long-lived interim host — production `ousadb` on `OUSASERVER03`, reachable by
LAN users over HTTPS at an internal DNS name with a certificate from the internal CA, running
until the Windows Server 2019 VM clears security review.

This supersedes `POC-ON-WORKSTATION.md` for anything longer than a demo. That document assumed a
short-lived, self-signed, dismantle-afterwards setup; the sections below replace its assumptions
about certificates (§5), the reverse proxy (§4, §6) and the dismantle step (§9), and add the
durability, monitoring and exit work a months-long host needs. The service registration (§7) and
the rehearsal checklist (§8) carry over almost unchanged.

The target topology is deliberately identical to `DEPLOYMENT.md`, so nothing proven here has to be
re-proven on the VM:

```
LAN browser ──HTTPS:443──> reverse proxy on mini-it13
                             └─ http://127.0.0.1:3000 ──> jadi-dashboard-web    (Windows service)
                                                          jadi-dashboard-worker (Windows service)
                                                             └── OUSASERVER03 / ousadb
                                                                 ├─ dbo  read-only  (jadi_readonly)
                                                                 └─ dash read/write (jadi_dash)
```

---

## 0. Decide these three things first

Everything downstream depends on them, and two of them need someone other than you.

### 0.1 The reverse proxy — IIS is a real risk on a client OS

**IIS on Windows 10/11 Pro is capped at 10 simultaneous connections.** It is not a licensing
warning you can ignore; requests beyond the cap are queued or refused (HTTP 403.9). A single
browser opens up to six connections per host, so the practical ceiling is roughly *two* concurrent
users on a dashboard that streams React responses and fires several requests per page. For a
20-minute demo that never surfaced. For an interim host serving a department, it will.

| Option | Verdict |
|---|---|
| **Caddy** (single signed `caddy.exe`, no installer) | **Recommended.** No connection cap, HTTP/2, trivial config, runs as a third NSSM service. Loads the internal-CA PFX directly. Its no-installer footprint is also the least likely thing to trip Carbon Black. |
| **nginx for Windows** | Works, no cap, but no service wrapper of its own and a fiddlier TLS config. Acceptable if Caddy is not approved. |
| **IIS + URL Rewrite + ARR** | Only if policy requires IIS. Accept the 10-connection ceiling, or the host is not fit for more than a couple of users. |

The VM will use IIS either way, and `DEPLOYMENT.md` §8 is unchanged — a reverse proxy is a swap of
one component, not a re-architecture, and the app is agnostic as long as it receives
`X-Forwarded-Proto` and `X-Forwarded-For`.

**Action:** confirm Caddy (or nginx) is acceptable to security. If it is not, and IIS is mandated,
raise the connection ceiling as a limitation of interim hosting in writing before users are told
the dashboard is available.

### 0.2 The name and the certificate

- Ask IT/PKI for an internal DNS **A record** — e.g. `jadi.ousa.edu` or `jadi-interim.ousa.edu` —
  pointing at `mini-it13`'s address, and for that address to be **reserved by DHCP or made static**.
  A workstation that picks up a new lease silently takes the dashboard down.
- Ask for a certificate from the **internal CA** for that exact name, exported as PFX with its
  private key. Every domain-joined machine then trusts it with no per-machine hosts file or `.cer`
  import — which is the whole reason for choosing the internal CA over the self-signed certificate
  in `POC-ON-WORKSTATION.md` §5.
- Note the **expiry date** and put a calendar reminder 30 days ahead. Internal CA certs are often
  one year; an interim host frequently outlives its own certificate.

### 0.3 The data-owner conversation, in writing this time

The POC framed this as a conversation to have before a demo. Months of a workstation holding a
credential that can read `dbo.tblStudent` — which contains SSN, DOB, gender and bank account,
none of which the app selects — needs the data owner's acknowledgement on record, along with:

- the interim nature and the expected end date,
- that reads are provably read-only (`05_verify.sql` §7 on `OUSASERVER03`),
- who has physical and administrative access to `mini-it13`.

---

## 1. Prepare the workstation as a host, not a desktop

This is the part the POC skipped, and it is most of the difference between a demo and a host.

1. **Dedicate the machine.** If someone uses `mini-it13` as their daily desktop, hosting from it is
   a bad trade — reboots, sleep, VPN clients and user-installed software all become outages. Agree
   it is a host.
2. **Never sleep, never hibernate:**
   ```powershell
   powercfg /change standby-timeout-ac 0
   powercfg /change hibernate-timeout-ac 0
   powercfg /change monitor-timeout-ac 15
   powercfg /hibernate off
   ```
3. **Survive a power cut.** BIOS/UEFI → *Restore on AC power loss* → **Power On**. Both services are
   already `SERVICE_AUTO_START`, so the host comes back on its own. A UPS is worth it if one exists.
4. **Control Windows Update reboots.** Set active hours, or pause feature updates and schedule
   patching monthly in a known window. An unannounced 2 a.m. reboot is fine (services auto-start);
   an unannounced 10 a.m. one is not.
5. **Disk.** `node_modules` (~550 MB) + `.next` (~780 MB) + logs. Keep ≥ 20 GB free; NSSM log
   rotation is on, but add a monthly prune of `C:\jadiDashboard\logs`.
6. **Carbon Black.** Get `node.exe`, `nssm.exe` (or `winsw.exe`) and `caddy.exe` allow-listed *by
   path* now, rather than discovering a blocked binary during a restart weeks from now.
7. **Firewall — private profile only**, ports 443 and 80 (redirect only). **Port 3000 stays closed;**
   Node binds `127.0.0.1`.
8. **Local accounts.** Create a dedicated low-privilege local account to run the two services. Do not
   run them as your logged-in user — services must survive your logoff and must not inherit your rights.

---

## 2. Application build

Currently `.next` holds only a `dev` build — there is no production build on this machine yet.

```powershell
cd C:\jadiDashboard
npm ci
npm run typecheck
npm test
npm run build
```

`npm ci` (not `npm install`) so the lockfile governs. Budget a few minutes.

---

## 3. Configuration

`.env.local` on this machine is currently a *development* file: it carries both target pairs, the
staging-shaped defaults and extra settings the deployment runbook does not list
(`STUDENT_PHOTO_SHARE`, `STUDENT_WORKSHEET_SHARE`, `JENZABAR_CLOUD_SERVER`,
`TRANS_HIST_GLOBAL_ENABLED`). Do **not** hand-edit it into a production file and hope — take a
backup copy first, then set:

```ini
APP_ENV=production
DATA_PROVIDER=mssql
APP_STORE=mssql
AUTH_DEV_LOGIN=false
SESSION_SECRET=<fresh 32 bytes, NOT the development value>
APP_BASE_URL=https://<the DNS name from 0.2>
APP_TIMEZONE=America/Chicago
WORKER_ID=worker-1
```

Generate the secret:

```powershell
[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Max 256 }))
```

Keep both `_STAGING` and `_PRODUCTION` connection pairs — `DB_TARGET` picks one at launch
(`TARGET-SWITCHING-PLAN.md`), and keeping staging reachable is what makes `npm run verify:target`
useful for diagnosis. Note that `DASH_CONNECTION_STRING` also resolves from the user environment
variable `JADI_DASH_CONNECTION_STRING` (`src/server/db/config.ts`); that variable belongs to *your*
user profile, not the service account, so set the production pair explicitly in `.env.local` rather
than relying on it.

Lock the file down — it holds two SQL passwords and the session key:

```powershell
icacls C:\jadiDashboard\.env.local /inheritance:r `
  /grant "Administrators:(R,W)" /grant "<service account>:(R)"
```

Then prove where it points, before anything else touches production:

```powershell
npm run verify:target:prod     # expect server=OUSASERVER03 on both lines, dashSchema=yes
```

**Housekeeping owed from `DEPLOYMENT.md` §3a:** `scripts\sql_server_Login.txt` is still in the repo
and still contains password lines. `git rm --cached` it, add it to `.gitignore`, and rotate anything
it names. It has already been pushed to GitHub.

---

## 4. Database

The `dash` schema on `OUSASERVER03` is managed by T-SQL only (`db/production/README.md`).
`npm run db:migrate` targets staging and must never be pointed here.

1. Confirm `01_login_and_grants.sql`, `02_schema.sql`, `03_seed_jobs.sql` and
   `004_user_external_index.sql` have all been applied.
2. Re-run `05_verify.sql` and clear every `FAIL`.
3. Confirm the nightly 9 pm SQL Agent job populating `tblOUSA` is untouched.
4. Confirm with the DBA that the `ousadb` backup plan is current — `dash` rides inside it (A-21).
5. First administrator, if `05_verify.sql` §5 still reports none:
   ```powershell
   $env:BOOTSTRAP_ADMIN_USERNAME="jwilson"
   $env:BOOTSTRAP_ADMIN_EMAIL="jwilson@digitalsupportsystems.com"
   $env:BOOTSTRAP_ADMIN_NAME="Jim Wilson"
   npm run bootstrap:admin:prod
   ```
   Copy the one-time set-password link; it is shown once and is built from `APP_BASE_URL`, so set
   that first and open the link after §6.

---

## 5. The two application services

As `DEPLOYMENT.md` §7, with production names rather than `jadi-demo-*` — these are going to live a
while, and a service called "demo" invites someone to delete it.

```powershell
nssm install jadi-dashboard-web "C:\Program Files\nodejs\node.exe" `
  "C:\jadiDashboard\node_modules\next\dist\bin\next" start -p 3000 -H 127.0.0.1
nssm set jadi-dashboard-web AppDirectory C:\jadiDashboard
nssm set jadi-dashboard-web AppEnvironmentExtra NODE_ENV=production DB_TARGET=production
nssm set jadi-dashboard-web AppStdout C:\jadiDashboard\logs\web.log
nssm set jadi-dashboard-web AppStderr  C:\jadiDashboard\logs\web.err.log
nssm set jadi-dashboard-web AppRotateFiles 1
nssm set jadi-dashboard-web AppExit Default Restart
nssm set jadi-dashboard-web Start SERVICE_AUTO_START
nssm set jadi-dashboard-web ObjectName ".\<service account>" "<password>"

nssm install jadi-dashboard-worker "C:\Program Files\nodejs\node.exe" `
  "C:\jadiDashboard\node_modules\tsx\dist\cli.mjs" "C:\jadiDashboard\src\worker.ts"
nssm set jadi-dashboard-worker AppDirectory C:\jadiDashboard
nssm set jadi-dashboard-worker AppEnvironmentExtra NODE_ENV=production DB_TARGET=production
nssm set jadi-dashboard-worker AppStdout C:\jadiDashboard\logs\worker.log
nssm set jadi-dashboard-worker AppStderr  C:\jadiDashboard\logs\worker.err.log
nssm set jadi-dashboard-worker AppRotateFiles 1
nssm set jadi-dashboard-worker AppExit Default Restart
nssm set jadi-dashboard-worker Start SERVICE_AUTO_START
nssm set jadi-dashboard-worker ObjectName ".\<service account>" "<password>"
```

`DB_TARGET=production` on both is mandatory — these invoke Node directly and never see the npm
script's `cross-env`. Omit it and the `APP_ENV=production` guard refuses to start, which is the
correct failure but a needless one.

Start them, then confirm the target from the logs rather than from intent:

```powershell
Start-Service jadi-dashboard-web, jadi-dashboard-worker
Select-String C:\jadiDashboard\logs\*.log -Pattern '"target"' | Select-Object -Last 4
Get-Content C:\jadiDashboard\logs\worker.log -Wait -Tail 30
```

Both must read `"target":"production"` with `OUSASERVER03`. The worker's startup catch-up run reads
`VIEW_OURM_FCA` and `VIEW_OURM_STATS` (40–120 s each) for every job family that has never
succeeded — allow several minutes on first start.

---

## 6. The reverse proxy

### 6a. Caddy (recommended)

Drop `caddy.exe` in `C:\tools\caddy\`. Import the PFX into `LocalMachine\My`, or point Caddy at the
PFX directly. `C:\tools\caddy\Caddyfile`:

```
<dns-name> {
    tls C:\tools\caddy\jadi.pem C:\tools\caddy\jadi-key.pem
    encode gzip
    reverse_proxy 127.0.0.1:3000 {
        header_up X-Forwarded-Proto https
        header_up X-Forwarded-Host  {host}
    }
}

http://<dns-name> {
    redir https://{host}{uri} permanent
}
```

(Convert the PFX to PEM pair with `openssl pkcs12`, or use Caddy's `tls <pfx>` support — either
way the private key file gets the same `icacls` lockdown as `.env.local`.)

Register it as the third service so the whole stack survives a reboot:

```powershell
nssm install jadi-dashboard-proxy "C:\tools\caddy\caddy.exe" run --config C:\tools\caddy\Caddyfile
nssm set jadi-dashboard-proxy AppDirectory C:\tools\caddy
nssm set jadi-dashboard-proxy AppStdout C:\jadiDashboard\logs\proxy.log
nssm set jadi-dashboard-proxy AppStderr C:\jadiDashboard\logs\proxy.err.log
nssm set jadi-dashboard-proxy AppRotateFiles 1
nssm set jadi-dashboard-proxy AppExit Default Restart
nssm set jadi-dashboard-proxy Start SERVICE_AUTO_START
Start-Service jadi-dashboard-proxy
```

Caddy forwards the client address in `X-Forwarded-For`, which the sign-in rate limiter
(`src/server/identity/rate-limit.ts`) needs.

### 6b. IIS fallback

If IIS is mandated, follow `POC-ON-WORKSTATION.md` §4 and §6 verbatim — the `web.config`, the
*View Server Variables* entries for `HTTP_X_FORWARDED_PROTO` / `HTTP_X_FORWARDED_HOST`, and
`responseBufferLimit = 0` with `timeout = 120` — but use the internal-CA certificate instead of the
self-signed one, and record the 10-connection ceiling from §0.1 as a known limitation.

---

## 7. Verification

| Check | Expected |
|---|---|
| `https://<dns-name>` from **another** LAN machine | Loads, **no** certificate warning |
| Same from a third machine simultaneously | Both responsive — this is the §0.1 cap test |
| Sign-in page | No dev accounts (`AUTH_DEV_LOGIN=false`, `APP_ENV=production`) |
| Session cookie in DevTools | `HttpOnly`, `Secure`, `SameSite` |
| `Select-String logs -Pattern '"target"'` | `"target":"production"`, `OUSASERVER03` in both |
| `npm run verify:target:prod` | Reaches `OUSASERVER03` on both connections |
| Administration → Jobs | All families SUCCEEDED and recent |
| Administration → Jobs → Run now | New run appears; snapshot timestamp advances |
| Current Semester Dashboard | Hero card populated; reconciliation balances; no "Unavailable" tiles |
| Hero figures vs `tblOUSA.census` / `FinanciallyCleared` | Match, or reconciliation explains the gap |
| Sign in as a Viewer | Student drill-down blocked (no `student.view`) |
| Wrong-password attempts from two machines | Lock independently — proves `X-Forwarded-For` |
| Write attempt as `jadi_dash` on `dbo` | Permission denied |
| **Full reboot** | All three services auto-start; site reachable with nobody logged in |
| Log off Windows entirely | Site still up |

Do the reboot test and the two-machine test before announcing the URL.

---

## 8. Running it for months

This is the section `POC-ON-WORKSTATION.md` has no equivalent for.

**Monitoring.** Interim hosts fail quietly. A scheduled task every 15 minutes that does an
`Invoke-WebRequest` against the site and a query for the newest `dash.JobRun` row, mailing you on
failure or staleness, is an hour's work and the difference between you noticing and a user noticing.
Alert on: site unreachable, newest `JobRun` older than `STALE_AFTER_MINUTES`, any `JobRun` FAILED,
free disk under 10 GB.

**Backups.** `dash` is inside `ousadb` and covered by the DBA's plan — verify, don't assume. Back up
`.env.local` and the certificate PFX to your password vault, not to a file share. Keep the last two
deployment zips on the machine; with no git on a host, those zips *are* the version history.

**Updates.** `DEPLOYMENT.md` §10 unchanged, plus the proxy:

```powershell
Stop-Service jadi-dashboard-worker, jadi-dashboard-web
cd C:\jadiDashboard
npm ci
npm run build
Start-Service jadi-dashboard-web, jadi-dashboard-worker
```

Worker stops first, starts last. Schema changes go through `db/production/0NN_*.sql` while the
services are stopped — never `npm run db:migrate`.

**Calendar items.** Certificate expiry minus 30 days. Monthly: patch window, log prune, disk check,
confirm `ousadb` backups are still running.

**Known limitations to state plainly to whoever signs this off:**

- Single machine, no redundancy — a hardware fault is an outage until the VM exists.
- Audit events still use the in-memory sink (`DEPLOYMENT.md` §11): `dash.AuditEvent` exists but the
  Phase 3 sink is not wired, so **audit history does not survive a restart**. Do not claim audit
  retention. On a months-long host this matters more than it did for a demo.
- `TrustServerCertificate=true` until the DBA installs a trusted cert on SQL Server.
- `ASSUMPTIONS.md` A-3 and A-18 still 🔴; A-21 still needs written DBA acceptance.
- If IIS was chosen: ~2 concurrent users.

---

## 9. Exit to the VM

Not a dismantle-and-forget, because the VM inherits real data and real accounts.

1. Build the VM per `DEPLOYMENT.md` §1–§8. The `dash` schema, the users and the job history are
   already on `OUSASERVER03` — the VM connects to the same database, so **there is no data
   migration**: skip `bootstrap:admin` (it will refuse anyway) and the `db/production` first-run
   scripts.
2. Stop the worker on `mini-it13` **before** starting the worker on the VM. Only one worker may run
   against the store (`WORKER_ID`). Overlapping workers are the single most likely mistake in this
   cutover.
3. Repoint the DNS record to the VM; issue the certificate for the same name so no user-facing URL
   changes.
4. Run §7's verification against the VM.
5. Then dismantle here — `POC-ON-WORKSTATION.md` §9, extended: remove the three services, the
   firewall rules, the certificate and private key, and revert `.env.local` to
   `APP_ENV=development` with `DB_TARGET` unset so a stray `npm run dev` cannot reach production.
6. Confirm to the data owner that the workstation no longer holds a production credential.
