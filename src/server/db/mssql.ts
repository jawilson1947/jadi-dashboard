import sql from "mssql";
import { getConfig } from "./config";

/**
 * Connection pools. Two distinct databases, two distinct logins:
 *   - source pool  → ousadb (and co-located [jadi]) with the READ-ONLY login   (OUSADB_CONNECTION_STRING)
 *   - dash pool    → ousadb as jadi_dash: writes allowed ONLY in schema [dash]   (DASH_CONNECTION_STRING)
 * Connection strings never leave this module and are never logged.
 */
let sourcePool: Promise<sql.ConnectionPool> | null = null;
let appPool: Promise<sql.ConnectionPool> | null = null;

function connect(connectionString: string, appName: string): Promise<sql.ConnectionPool> {
  const cfg = parseConnectionString(connectionString);
  cfg.options = { ...cfg.options, appName, readOnlyIntent: appName.includes("source"), enableArithAbort: true };
  cfg.pool = { max: 5, min: 0, idleTimeoutMillis: 30_000 };
  cfg.requestTimeout = 300_000; // snapshot jobs run in the background; the slow views need headroom
  cfg.connectionTimeout = 20_000;
  return new sql.ConnectionPool(cfg).connect();
}

export function getSourcePool(): Promise<sql.ConnectionPool> {
  const cs = getConfig().OUSADB_CONNECTION_STRING;
  if (!cs) throw new Error("OUSADB_CONNECTION_STRING is not configured");
  sourcePool ??= connect(cs, "jadi-dashboard-source");
  return sourcePool;
}

export function getDashPool(): Promise<sql.ConnectionPool> {
  const cs = getConfig().DASH_CONNECTION_STRING;
  if (!cs) throw new Error("DASH_CONNECTION_STRING is not configured");
  appPool ??= connect(cs, "jadi-dashboard-dash");
  return appPool;
}
/** @deprecated use getDashPool */
export const getAppPool = getDashPool;

export async function closePools(): Promise<void> {
  await Promise.all([sourcePool?.then((p) => p.close()), appPool?.then((p) => p.close())]);
  sourcePool = null;
  appPool = null;
}

/**
 * Accepts an ADO-style string ("Server=host;Database=db;User Id=u;Password=p;Encrypt=false;TrustServerCertificate=true").
 * Kept explicit so we control which options are honoured.
 */
export function parseConnectionString(cs: string): sql.config {
  const kv: Record<string, string> = {};
  for (const part of cs.split(";")) {
    const i = part.indexOf("=");
    if (i > 0) kv[part.slice(0, i).trim().toLowerCase()] = part.slice(i + 1).trim();
  }
  const server = kv["server"] ?? kv["data source"] ?? "";
  const [host, instanceOrPort] = server.split(/[\\,]/);
  const usesPort = server.includes(",");
  const bool = (v: string | undefined, d: boolean) => (v === undefined ? d : /^(true|yes|1)$/i.test(v));
  return {
    server: host,
    port: usesPort && instanceOrPort ? Number(instanceOrPort) : undefined,
    database: kv["database"] ?? kv["initial catalog"],
    user: kv["user id"] ?? kv["uid"] ?? kv["user"],
    password: kv["password"] ?? kv["pwd"],
    options: {
      instanceName: !usesPort && instanceOrPort ? instanceOrPort : undefined,
      encrypt: bool(kv["encrypt"], true),
      trustServerCertificate: bool(kv["trustservercertificate"], false),
    },
  };
}

export { sql };
