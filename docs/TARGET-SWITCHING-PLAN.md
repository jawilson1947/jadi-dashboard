# Plan — selecting the database target at launch

> **Status: implemented 2026-09-22.** `src/server/db/target.ts`, the `getConfig()` hook, the npm
> scripts, `scripts/verify-target.ts` and `tests/unit/target.test.ts` are in the tree. Sections
> below are kept as the rationale. Outstanding from §2.4: the header badge and the Administration
> → Jobs line (UI work); the §3 guards on `reset:credentials` (`CONFIRM_TARGET`) and the
> `bootstrap:admin` confirmation prompt.

Goal: run the app against **staging** or **production** without editing `.env.local`.

Decisions taken:

- **Switch set via npm scripts** on the development machine (`npm run dev:staging`, `npm run dev:prod`).
- **Server names only.** The target chooses two connection strings and nothing else. `APP_ENV`,
  `SESSION_SECRET`, credential policy and the rest stay shared in `.env.local`.
- **Default is staging.** Forgetting the flag sends you somewhere harmless; production must be
  asked for by name.

---

## 1. Why this works without new machinery

`scripts/load-env.ts` already applies the rule that makes this cheap:

> *real environment variables always win* — a key already present in `process.env` is never
> overwritten by `.env.local`.

So a variable set on the command line beats the file, and Next.js applies the same precedence for
`next dev` / `next start`. The switch therefore needs no change to how configuration is loaded —
only a small resolver that decides *which* connection string ends up in the two names
`src/server/db/config.ts` already reads: `OUSADB_CONNECTION_STRING` and `DASH_CONNECTION_STRING`.

`cross-env` is already a devDependency (used by `test:staging`), so setting a variable works
identically in PowerShell, cmd and bash.

---

## 2. Shape of the change

### 2.1 `.env.local` gains per-target names

The two generic names stop being set directly. Instead:

```ini
# ── Target-specific: the ONLY thing that differs between environments ──
OUSADB_CONNECTION_STRING_STAGING="Server=STAGINGSQL;Database=ousadb;User Id=jadi_readonly;Password=...;Encrypt=true;TrustServerCertificate=true"
DASH_CONNECTION_STRING_STAGING="Server=STAGINGSQL;Database=ousadb;User Id=jadi_dash;Password=...;Encrypt=true;TrustServerCertificate=true"

OUSADB_CONNECTION_STRING_PRODUCTION="Server=OUSASERVER03;Database=ousadb;User Id=jadi_readonly;Password=...;Encrypt=true;TrustServerCertificate=true"
DASH_CONNECTION_STRING_PRODUCTION="Server=OUSASERVER03;Database=ousadb;User Id=jadi_dash;Password=...;Encrypt=true;TrustServerCertificate=true"

# ── Everything else stays exactly as it is, shared by both targets ──
APP_ENV=...
SESSION_SECRET=...
```

One file, one set of secrets, no new files on disk to protect.

### 2.2 A resolver runs before config is read

New file `src/server/db/target.ts`:

```ts
export type Target = "staging" | "production";

/** Reads DB_TARGET (default "staging") and promotes the matching pair into the
 *  generic names that config.ts reads. A value already set explicitly wins, so
 *  an operator can still pin a one-off connection string. */
export function resolveTarget(env = process.env): Target { … }
```

Behaviour:

1. Read `DB_TARGET`. Absent → `staging`. Unrecognised → **throw**, listing the valid values.
   A typo must not silently fall back to a default.
2. For each of `OUSADB_CONNECTION_STRING` and `DASH_CONNECTION_STRING`: if it is **already set**,
   leave it (explicit beats derived — keeps the current `.env.local` and CI working unchanged).
   Otherwise copy from `<NAME>_<TARGET>`.
3. If the suffixed variable for the chosen target is missing and the feature that needs it is on
   (`DATA_PROVIDER=mssql`, `APP_STORE=mssql`), throw naming the variable that is missing and the
   target that was requested — not the generic name, which would send you looking in the wrong place.
4. Return the resolved target so it can be logged and surfaced.

Call it at the top of `getConfig()` in `src/server/db/config.ts`, before `envSchema.safeParse`.
That single call point covers the web app, the worker and every script, because they all read
configuration through `getConfig()`. `DB_TARGET` is added to the schema as
`z.enum(["staging","production"]).default("staging")` so the resolved value is part of `AppConfig`.

### 2.3 npm scripts

```jsonc
"dev":            "cross-env DB_TARGET=staging next dev",
"dev:staging":    "cross-env DB_TARGET=staging next dev",
"dev:prod":       "cross-env DB_TARGET=production next dev",

"start":          "cross-env DB_TARGET=staging next start",
"start:staging":  "cross-env DB_TARGET=staging next start",
"start:prod":     "cross-env DB_TARGET=production next start",

"worker":         "cross-env DB_TARGET=staging tsx src/worker.ts",
"worker:staging": "cross-env DB_TARGET=staging tsx src/worker.ts",
"worker:prod":    "cross-env DB_TARGET=production tsx src/worker.ts",

"db:migrate":         "cross-env DB_TARGET=staging tsx scripts/migrate-app-db.ts",
"db:migrate:prod":    "cross-env DB_TARGET=production tsx scripts/migrate-app-db.ts",
"bootstrap:admin":      "cross-env DB_TARGET=staging tsx scripts/bootstrap-admin.ts",
"bootstrap:admin:prod": "cross-env DB_TARGET=production tsx scripts/bootstrap-admin.ts"
```

The plain `dev` / `start` / `worker` names keep working and now mean "staging" explicitly rather
than by accident. `DB_TARGET=production npm run dev` also works for a one-off, since the shell
variable is already in `process.env` before cross-env runs.

### 2.4 Make the target visible

A wrong target that runs silently is the failure mode worth engineering against.

- **Worker startup log** already prints provider, store and timezone — add `target` and the
  server name parsed out of the connection string (host only; never the password).
- **Application header** shows a target badge when `DB_TARGET !== 'production'`, so a staging
  session is obvious at a glance and production looks normal.
- **`getConfig()`** logs one line at startup: `config resolved { target, provider, store, dashHost,
  ousaHost }`. Hosts only.
- **Administration → Jobs** gains a read-only line naming the target and the two hosts, so an
  administrator can confirm what they are looking at without shell access.

---

## 3. Guards worth adding at the same time

These cost a few lines and remove the class of mistake this whole session has been about.

1. **`APP_ENV=production` + `DB_TARGET=staging` → throw.** That combination has no legitimate use
   and means someone edited one and not the other.
2. **Destructive scripts refuse production without a second flag.** `reset:credentials` and any
   future data-modifying script require `CONFIRM_TARGET=production` as well as
   `DB_TARGET=production`. Two independent statements of intent.
3. **`bootstrap:admin` prints the resolved host before it writes** and asks for confirmation when
   the target is production and stdin is a TTY.
4. **A `verify:target` script** that connects, runs `SELECT @@SERVERNAME`, and prints what it
   actually reached — the quickest possible answer to "which database am I pointed at right now".

---

## 4. On the VMs

Out of scope for the npm-script decision, but worth stating so the two do not drift:

each Windows service sets its own target once, in its service definition, and never thinks about
it again:

```powershell
nssm set jadi-dashboard-web    AppEnvironmentExtra NODE_ENV=production DB_TARGET=production
nssm set jadi-dashboard-worker AppEnvironmentExtra NODE_ENV=production DB_TARGET=production
```

The production VM then runs against production whatever anyone types, because nobody types
anything. The staging VM, if one exists, sets `DB_TARGET=staging` the same way. Because the
default is staging, a service definition that forgets the variable fails safe.

---

## 5. Work involved

| Step | File | Size |
|---|---|---|
| 1 | `.env.example` — document the four suffixed names and `DB_TARGET` | small |
| 2 | `src/server/db/target.ts` — the resolver | ~40 lines |
| 3 | `src/server/db/config.ts` — call it, add `DB_TARGET` to the schema, add guard 1 | ~10 lines |
| 4 | `package.json` — the scripts above | small |
| 5 | `tests/` — resolver unit tests (see below) | ~60 lines |
| 6 | `src/worker.ts`, header component, Jobs page — surface the target | small |
| 7 | `.env.local` on each machine — rename the two keys to the suffixed form | manual, once |
| 8 | `README.md`, `docs/DEPLOYMENT.md` — document it | small |

### Tests the resolver needs

- default with no `DB_TARGET` → staging, staging strings promoted
- `DB_TARGET=production` → production strings promoted
- unrecognised `DB_TARGET` → throws, message names the valid values
- explicitly set `OUSADB_CONNECTION_STRING` → preserved, not overwritten
- missing suffixed variable + `DATA_PROVIDER=mssql` → throws naming the variable AND the target
- `APP_ENV=production` + `DB_TARGET=staging` → throws
- no connection string ever appears in a thrown message or a log line

That last one matters: the whole point of a resolver is that it touches secrets, so the tests
should prove it never prints them.

---

## 6. Alternative considered and rejected

**Separate `.env.staging` / `.env.production` files** layered over `.env.local`. More flexible —
any variable could differ per target — but it creates two more files containing SQL passwords to
protect, back up and keep in step, and it invites the environments to drift in ways nobody
intended. Since only the server name actually differs, suffixed keys in the single existing file
express exactly that and nothing more. Revisit only if a genuine second difference appears.
