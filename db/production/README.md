# `db/production/` — T-SQL deployment for schema `dash`

Production's `dash` schema is managed **entirely with T-SQL**, run by a DBA with `sqlcmd`.
`npm run db:migrate` is for development and staging only and is not run against production.

Everything here is idempotent: rerunning a script adds what is missing and changes nothing else.

## Files

| File | Where | What it does |
|---|---|---|
| `00_export_from_staging.sql` | **staging** | Copies `dash.*` into a scratch DB and backs it up to `dash_export.bak` |
| `01_login_and_grants.sql` | production | Login `jadi_dash`, schema `dash`, users in `ousadb` + `jadi`, grants and the `dbo` DENYs |
| `02_schema.sql` | production | All tables, indexes, constraints and role/permission seeds; writes the baseline ledger rows |
| `03_seed_jobs.sql` | production | The 10 job definitions (seeded by the worker in dev; by T-SQL here) |
| `04_import_from_staging.sql` | production | Restores `dash_export.bak` and copies the rows into `dash.*` in FK order |
| `05_verify.sql` | production | Read-only PASS/FAIL audit — objects, seeds, integrity, grants |
| `99_undo_dash_in_master.sql` | either | Recovery: removes a `dash` schema accidentally built in `master` |
| `_template_migration.sql` | — | Copy this for every future change |

`02_schema.sql` is **generated** by concatenating `db/migrations/001_init.sql`,
`002_identity.sql` and `003_sprint.sql`. Regenerate it after changing those; do not hand-edit.

## First deployment

```powershell
# staging
sqlcmd -S STAGINGSQL -E -b -I -i 00_export_from_staging.sql
#   -> copy D:\Backup\dash_export.bak to the production server

# production — stop the app services first
sqlcmd -S PRODSQL -E -b -I -i 01_login_and_grants.sql -v DashPassword="<strong password>"
sqlcmd -S PRODSQL -d ousadb -E -b -I -i 02_schema.sql
sqlcmd -S PRODSQL -d ousadb -E -b -I -i 03_seed_jobs.sql
sqlcmd -S PRODSQL -d ousadb -E -b -I -i 04_import_from_staging.sql
sqlcmd -S PRODSQL -d ousadb -E -b -I -i 05_verify.sql
```

`-b` makes sqlcmd exit non-zero on error and `-I` enables quoted identifiers — both are
required. Review every `FAIL` from `05_verify.sql` before starting the services.

### Running these in SSMS instead of sqlcmd

Every script asserts its own database and sets `NOEXEC ON` if it is wrong, so running one
against the wrong connection stops it instead of building objects in the wrong place. Each
script also prints `ABORTED:` when that happens — if you see that line, reconnect and re-run;
nothing was changed.

The first version of these scripts used a `:on error exit` directive placed directly above
`USE [ousadb];`. In SSMS **without** SQLCMD Mode that line is a syntax error, and the error
kills the batch it belongs to — which contained the `USE`. Every later batch then ran against
whatever database the window happened to be on, and `02_schema.sql` built the entire `dash`
schema in `master` while reporting success. The directive has been removed and replaced with
the in-database guard. `99_undo_dash_in_master.sql` cleans up if you hit it.

`01_login_and_grants.sql` still needs sqlcmd for `-v DashPassword`. Run in SSMS without SQLCMD
Mode, the substitution does not happen, and the script now refuses rather than creating the
login with the literal text `$(DashPassword)` as its password. If you must run it from SSMS,
replace `@pwd` with the real password in a private copy you do not commit.

## Every change after that

1. Write the change in `db/migrations/0NN_<name>.sql` (dev and staging apply it with
   `npm run db:migrate`).
2. Copy `_template_migration.sql` to `db/production/0NN_<name>.sql`, **same filename**, and put
   the same change inside the guard.
3. Test on staging.
4. On production:

```powershell
Stop-Service jadi-dashboard-worker, jadi-dashboard-web
sqlcmd -S PRODSQL -d ousadb -E -b -I -i 0NN_<name>.sql
sqlcmd -S PRODSQL -d ousadb -E -b -I -i 05_verify.sql
Start-Service jadi-dashboard-web, jadi-dashboard-worker
```

Matching filenames keep one ledger meaningful across all three environments: `SELECT name FROM
dash.SchemaMigration ORDER BY name` answers "what is deployed here" the same way everywhere.

## Rules

- **Forward-only.** Never edit a migration that has run. Fix it with the next number.
- **Never touch `dbo`.** Migrations run as `jadi_dash`, which is denied writes there. A migration
  that needs elevation is a design problem, not a permissions problem.
- **Take a backup of `ousadb` before any production migration.** The `dash` schema lives inside
  `ousadb` (A-21), so it is covered by the existing backup plan — confirm the last backup is
  recent rather than assuming.
