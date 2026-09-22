/**
 * Applies db/migrations/*.sql to ousadb schema [dash] in filename order, once each (A-21).
 * Usage: npm run db:migrate
 * The connection string comes from the environment or from .env.local / .env (scripts/load-env.ts):
 * DASH_CONNECTION_STRING, or the legacy DATABASE_URL / JADI_DASH_CONNECTION_STRING names. It is never
 * printed. The login needs the grants in db/grants/jadi_dash.sql.
 */
import "./load-env";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import sql from "mssql";
import { connectionHost, resolveTarget } from "../src/server/db/target";

async function main() {
  // Promote DASH_CONNECTION_STRING_<TARGET> into the generic name, exactly as the app does (docs/TARGET-SWITCHING-PLAN.md).
  const { target } = resolveTarget(process.env);
  const cs = process.env.DASH_CONNECTION_STRING ?? process.env.DATABASE_URL ?? process.env.JADI_DASH_CONNECTION_STRING;
  if (cs) console.log(`target=${target} dashHost=${connectionHost(cs)}`);
  if (!cs) {
    throw new Error(
      "DASH_CONNECTION_STRING is not set. Add it to .env.local (or set DATABASE_URL / JADI_DASH_CONNECTION_STRING, " +
        "or pass it for one run), e.g. DASH_CONNECTION_STRING=\"Server=...;Database=ousadb;User Id=jadi_dash;Password=...;Encrypt=true;TrustServerCertificate=true\"",
    );
  }
  const pool = await sql.connect(cs);
  try {
    await pool.request().query(`IF SCHEMA_ID('dash') IS NULL EXEC('CREATE SCHEMA dash AUTHORIZATION dbo');`);
    await pool.request().query(`IF OBJECT_ID('dash.SchemaMigration') IS NULL CREATE TABLE dash.SchemaMigration (name nvarchar(200) NOT NULL PRIMARY KEY, appliedAt datetime2 NOT NULL DEFAULT SYSUTCDATETIME());`);
    const applied = new Set((await pool.request().query<{ name: string }>("SELECT name FROM dash.SchemaMigration")).recordset.map((r) => r.name));
    const dir = join(process.cwd(), "db", "migrations");
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
      if (applied.has(file)) continue;
      const body = readFileSync(join(dir, file), "utf8");
      const tx = new sql.Transaction(pool);
      await tx.begin();
      try {
        for (const batch of body.split(/^\s*GO\s*$/im)) if (batch.trim()) await new sql.Request(tx).batch(batch);
        await new sql.Request(tx).input("name", sql.NVarChar(200), file).query("INSERT INTO dash.SchemaMigration(name) VALUES (@name)");
        await tx.commit();
        console.log(`applied ${file}`);
      } catch (e) {
        await tx.rollback();
        throw e;
      }
    }
    console.log("migrations up to date");
  } finally {
    await pool.close();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
