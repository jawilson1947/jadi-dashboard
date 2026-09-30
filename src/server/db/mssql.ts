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
  // Time allowed to ESTABLISH the connection (DB_CONNECT_TIMEOUT_MS, default 60 s). Separate from
  // requestTimeout above: this one covers TCP connect, the TLS handshake and login, which is what
  // is slow when the SQL host has been idle. A failure here reads "Failed to connect to HOST:PORT
  // in Nms" and is a reachability problem, not a query problem.
  cfg.connectionTimeout = getConfig().DB_CONNECT_TIMEOUT_MS;
  return new sql.ConnectionPool(cfg).connect();
}

/**
 * A failed connect must not poison the cached pool promise.
 *
 * `pool ??= connect(...)` caches the rejected promise, so once the first sign-in of the day fails
 * every later attempt fails instantly with the same stale error — which is why the log shows a
 * 20-second timeout followed by 500s returning in 16ms. Clearing the slot on rejection means the
 * next request genuinely retries.
 */
function cache(current: Promise<sql.ConnectionPool> | null, make: () => Promise<sql.ConnectionPool>, clear: () => void): Promise<sql.ConnectionPool> {
  if (current) return current;
  const p = make();
  p.catch(clear);
  return p;
}

export function getSourcePool(): Promise<sql.ConnectionPool> {
  const cs = getConfig().OUSADB_CONNECTION_STRING;
  if (!cs) throw new Error("OUSADB_CONNECTION_STRING is not configured");
  sourcePool = cache(sourcePool, () => connect(cs, "jadi-dashboard-source"), () => (sourcePool = null));
  return sourcePool;
}

export function getDashPool(): Promise<sql.ConnectionPool> {
  const cs = getConfig().DASH_CONNECTION_STRING;
  if (!cs) throw new Error("DASH_CONNECTION_STRING is not configured");
  appPool = cache(appPool, () => connect(cs, "jadi-dashboard-dash"), () => (appPool = null));
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
