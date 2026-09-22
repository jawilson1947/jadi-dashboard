# Proof of concept — running the app from the workstation

Purpose: demonstrate the dashboard to management, over HTTPS, against **real production figures**,
before the Windows Server 2019 VM is provisioned (blocked on Carbon Black).

Shape chosen:

| | |
|---|---|
| **Host** | `mini-it13` (this workstation), IIS in front of Node, same topology as the VM |
| **Data** | production `ousadb` on `OUSASERVER03` — real enrolment and clearance figures |
| **Persistence** | both processes registered as Windows services, so the demo survives a logoff |

Everything here is temporary and is dismantled in §9 once the VM exists. The IIS work is **not**
throwaway: it is the same configuration `DEPLOYMENT.md` §2 and §8 call for, so proving it here
removes the largest unknown from the VM build.

---

## 0. Read first — this points a workstation at production

The demo reads real student financial data. That is the point, and it is also the risk.

- The provider is **read-only** and the app never writes to Jenzabar. `jadi_dash` is denied writes
  on `dbo` and `05_verify.sql` §7 proved it on `OUSASERVER03`.
- But `dbo.tblStudent` holds SSN, DOB, gender and bank account. The app never selects those
  columns, and the source SQL is guarded by tests — the *database* still contains them, and this
  workstation will hold a credential that can read them.
- So: the certificate below is self-signed and this host is **not** to be left running after the
  demo. §9 is not optional.
- Tell whoever owns the data that a workstation is briefly reading production. It is a
  conversation, not a confession — but have it before the demo, not after.

If that is not acceptable, the same procedure works unchanged against staging: use
`DB_TARGET=staging` throughout and say plainly in the demo that the figures are test data.

---

## 1. Prepare the application

```powershell
cd C:\jadiDashboard
npm ci
npm run typecheck
npm test
npm run build
```

`npm run build` is what makes this a demo rather than a dev session: the production build is what
the VM will run, and it behaves differently from `next dev` (no hot reload, real caching, real
error pages).

---

## 2. Point it at production, and prove it

`.env.local` already holds both pairs (`docs/TARGET-SWITCHING-PLAN.md`). Confirm the production
pair is filled in, then check what it actually reaches:

```powershell
npm run verify:target:prod
```

Expect `server=OUSASERVER03` on both lines, `dashSchema=yes`. Do not proceed past a `FAILED`.

For the demo itself set these in `.env.local` — they are the production-shaped values:

```ini
APP_ENV=production
DATA_PROVIDER=mssql
APP_STORE=mssql
AUTH_DEV_LOGIN=false
SESSION_SECRET=<a fresh value — see below>
APP_BASE_URL=https://jadi-demo.local
```

Generate a secret rather than reusing the development one:

```powershell
[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Max 256 }))
```

`APP_ENV=production` is what makes the demo honest: dev sign-in is refused and the session cookie
gets the `Secure` flag. That flag is precisely why §3–§5 exist — over plain HTTP the browser
discards the cookie and sign-in fails with no error message.

---

## 3. An administrator on production

`05_verify.sql` §5 reported **no active administrator** on `OUSASERVER03`. Create one:

```powershell
$env:BOOTSTRAP_ADMIN_USERNAME="jwilson"
$env:BOOTSTRAP_ADMIN_EMAIL="jwilson@digitalsupportsystems.com"
$env:BOOTSTRAP_ADMIN_NAME="Jim Wilson"
npm run bootstrap:admin:prod
```

Copy the one-time set-password link it prints — it is shown once. Open it after §6, when the site
is up, because the link is built from `APP_BASE_URL`.

If you would rather import the staging accounts, run `db\production\04_import_from_staging.sql`
instead; `bootstrap:admin` then refuses, which is correct.

---

## 4. IIS on Windows 10/11 Pro

```powershell
# Elevated
Enable-WindowsOptionalFeature -Online -FeatureName IIS-WebServerRole, IIS-WebServer, `
  IIS-HttpRedirect, IIS-ManagementConsole -All
```

Then install, in this order, from the Microsoft download pages:

1. **URL Rewrite 2.1**
2. **Application Request Routing 3.0**

Then the step that is always forgotten: IIS Manager → the **server** node → *Application Request
Routing Cache* → **Server Proxy Settings** → tick **Enable proxy** → Apply.

These are the same components and the same sequence as `DEPLOYMENT.md` §2. If Carbon Black blocks
either installer, that is worth knowing now — it would block them on the VM too.

---

## 5. A certificate and a name

A self-signed certificate is fine for a demo as long as the machines viewing it trust it.

```powershell
# Elevated
$cert = New-SelfSignedCertificate -DnsName "jadi-demo.local" `
  -CertStoreLocation "cert:\LocalMachine\My" `
  -FriendlyName "JADI Dashboard demo" -NotAfter (Get-Date).AddMonths(3)

# Trust it on this machine
$store = New-Object System.Security.Cryptography.X509Certificates.X509Store("Root","LocalMachine")
$store.Open("ReadWrite"); $store.Add($cert); $store.Close()
$cert.Thumbprint
```

Give the name somewhere to resolve. Either add an internal DNS record for `jadi-demo.local`
pointing at this workstation, or add a hosts-file line **on each viewing machine**:

```
192.168.x.x    jadi-demo.local
```

> **Decide this before the demo, not during it.** A viewer whose machine does not trust the
> certificate gets a full-page browser warning, which is a poor first impression of a financial
> dashboard. Two ways to avoid it: ask IT for a short-lived certificate from the internal CA
> (every domain machine trusts it automatically), or export this one as a `.cer` and have it
> installed in Trusted Root on the handful of machines that will watch. The internal CA is better
> if there is time.

---

## 6. The site and the reverse proxy

IIS Manager → Sites → Add Website:

- Site name `jadi-demo`
- Physical path `C:\inetpub\jadi-demo` (create it; IIS serves nothing from it)
- Binding: **https**, port 443, host name `jadi-demo.local`, the certificate from §5
- Add a second binding on **http**, port 80, same host name — for the redirect only

Put this `web.config` in `C:\inetpub\jadi-demo`:

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
  </system.webServer>
</configuration>
```

Then, exactly as on the VM:

- IIS Manager → site → **URL Rewrite** → *View Server Variables* → add `HTTP_X_FORWARDED_PROTO`
  and `HTTP_X_FORWARDED_HOST`. Without this the rule fails at runtime.
- site → **Configuration Editor** → `system.webServer/proxy` → `responseBufferLimit = 0` and
  `timeout = 120`, so streamed responses are not held back and a slow snapshot does not time out.

Firewall — private profile only:

```powershell
New-NetFirewallRule -DisplayName "JADI demo 443" -Direction Inbound -Protocol TCP `
  -LocalPort 443 -Action Allow -Profile Private
New-NetFirewallRule -DisplayName "JADI demo 80" -Direction Inbound -Protocol TCP `
  -LocalPort 80 -Action Allow -Profile Private
```

Port 3000 stays closed. Only IIS reaches Node.

---

## 7. Two services, so the demo survives a logoff

Install **NSSM** to `C:\tools\nssm\nssm.exe`. If Carbon Black blocks it, **WinSW** is a single
signed executable with an XML config and usually passes where NSSM does not; if neither is
allowed, fall back to two PowerShell windows and do not log off.

```powershell
# Web
nssm install jadi-demo-web "C:\Program Files\nodejs\node.exe" `
  "C:\jadiDashboard\node_modules\next\dist\bin\next" start -p 3000 -H 127.0.0.1
nssm set jadi-demo-web AppDirectory C:\jadiDashboard
nssm set jadi-demo-web AppEnvironmentExtra NODE_ENV=production DB_TARGET=production
nssm set jadi-demo-web AppStdout C:\jadiDashboard\logs\web.log
nssm set jadi-demo-web AppStderr  C:\jadiDashboard\logs\web.err.log
nssm set jadi-demo-web AppRotateFiles 1
nssm set jadi-demo-web AppExit Default Restart
nssm set jadi-demo-web Start SERVICE_AUTO_START

# Worker
nssm install jadi-demo-worker "C:\Program Files\nodejs\node.exe" `
  "C:\jadiDashboard\node_modules\tsx\dist\cli.mjs" "C:\jadiDashboard\src\worker.ts"
nssm set jadi-demo-worker AppDirectory C:\jadiDashboard
nssm set jadi-demo-worker AppEnvironmentExtra NODE_ENV=production DB_TARGET=production
nssm set jadi-demo-worker AppStdout C:\jadiDashboard\logs\worker.log
nssm set jadi-demo-worker AppStderr  C:\jadiDashboard\logs\worker.err.log
nssm set jadi-demo-worker AppRotateFiles 1
nssm set jadi-demo-worker AppExit Default Restart
nssm set jadi-demo-worker Start SERVICE_AUTO_START

Start-Service jadi-demo-web, jadi-demo-worker
```

`DB_TARGET=production` is required on both: these invoke Node directly and never see the npm
script's `cross-env`. Omit it and `APP_ENV=production` makes the service refuse to start —
loud, but set it deliberately.

The worker's **startup catch-up** runs every job family that has never succeeded on production,
which is what puts figures on the dashboard for the first time. It reads `VIEW_OURM_FCA` and
`VIEW_OURM_STATS`, which take 40–120 s each on staging — so **allow several minutes** and watch:

```powershell
Get-Content C:\jadiDashboard\logs\worker.log -Wait -Tail 30
```

---

## 8. Rehearse it before the audience arrives

| Check | Expected |
|---|---|
| `Select-String C:\jadiDashboard\logs\*.log -Pattern '"target"'` | `"target":"production"`, `OUSASERVER03` |
| `https://jadi-demo.local` from **another** machine | Loads, no certificate warning |
| Sign-in page | No dev accounts listed |
| Set-password link from §3, then sign in | Works — confirms `Secure` cookies survive the proxy |
| Current Semester Dashboard | Hero card populated; no "Unavailable" tiles |
| Hero figures vs `tblOUSA.census` / `FinanciallyCleared` | Match, or the reconciliation line explains the gap |
| Clearance Sprint → By date | Chart renders; labels legible; zero days omitted |
| Administration → Jobs | All families SUCCEEDED, recent |
| Sign out, sign in again | Session handling works end to end |
| Log off Windows, reconnect | Site still up — this is what the services buy |

Do this a day early. The first worker run against production is the step most likely to surprise
you, and the figures are the whole point of the demo.

**Two sentences worth preparing**, because someone will ask: the data is live production, read
through a login that is provably unable to write to it; and the workstation hosting is temporary,
with the server build waiting on a security review.

---

## 9. Dismantle — do not skip

Once the VM is live, or the demo is over:

```powershell
Stop-Service jadi-demo-web, jadi-demo-worker
nssm remove jadi-demo-web confirm
nssm remove jadi-demo-worker confirm

Remove-NetFirewallRule -DisplayName "JADI demo 443","JADI demo 80"

# IIS Manager -> remove the jadi-demo site, then:
Get-ChildItem Cert:\LocalMachine\My  | Where-Object FriendlyName -eq "JADI Dashboard demo" | Remove-Item
Get-ChildItem Cert:\LocalMachine\Root| Where-Object FriendlyName -eq "JADI Dashboard demo" | Remove-Item
```

Then put `.env.local` back to `APP_ENV=development` and `DB_TARGET` unset, so a stray
`npm run dev` cannot reach production. Remove the hosts-file lines from the viewers' machines.

A workstation quietly holding production credentials and an open 443 is exactly the finding a
security review turns up six months later.
