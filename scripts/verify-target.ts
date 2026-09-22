/**
 * Answers "which database am I actually pointed at?" in one command.
 *
 *   npm run verify:target          # staging
 *   npm run verify:target:prod     # production
 *
 * Connects with each configured connection string and reports @@SERVERNAME, the database, the
 * login it connected as, and whether schema [dash] is present. Read-only; changes nothing.
 * Hosts and server names are printed — connection strings and passwords never are.
 */
import "./load-env";
import sql from "mssql";
import { connectionHost, resolveTarget } from "../src/server/db/target";

interface Probe {
  label: string;
  connectionString: string | undefined;
}

async function probe({ label, connectionString }: Probe): Promise<void> {
  if (!connectionString) {
    console.log(`${label.padEnd(8)} not configured`);
    return;
  }
  const host = connectionHost(connectionString);
  let pool: sql.ConnectionPool | undefined;
  try {
    pool = await sql.connect(connectionString);
    const r = await pool.request().query<{
      serverName: string;
      dbName: string;
      loginName: string;
      edition: string;
      dashPresent: number;
    }>(`
      SELECT
        CAST(SERVERPROPERTY('ServerName') AS nvarchar(200)) AS serverName,
        DB_NAME()                                           AS dbName,
        SUSER_SNAME()                                       AS loginName,
        CAST(SERVERPROPERTY('Edition') AS nvarchar(100))    AS edition,
        CASE WHEN SCHEMA_ID('dash') IS NULL THEN 0 ELSE 1 END AS dashPresent;
    `);
    const row = r.recordset[0];
    console.log(
      `${label.padEnd(8)} host=${host} server=${row.serverName} db=${row.dbName} ` +
        `login=${row.loginName} edition=${row.edition} dashSchema=${row.dashPresent ? "yes" : "no"}`,
    );
  } catch (e) {
    // Driver errors can echo the connection string; report only the host and the error name.
    const name = e instanceof Error ? e.name : "Error";
    console.log(`${label.padEnd(8)} host=${host} FAILED (${name}) — check the credentials for this target`);
    process.exitCode = 1;
  } finally {
    await pool?.close().catch(() => undefined);
  }
}

async function main(): Promise<void> {
  const { target } = resolveTarget(process.env);
  console.log(`DB_TARGET=${target}`);
  await probe({ label: "ousadb", connectionString: process.env.OUSADB_CONNECTION_STRING });
  await probe({ label: "dash", connectionString: process.env.DASH_CONNECTION_STRING });
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
