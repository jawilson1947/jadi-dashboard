import { z } from "zod";
import { TARGETS, connectionHost, missingConnectionMessage, resolveTarget } from "./target";

/**
 * Environment configuration, validated once at startup (Spec §16 environment-based config).
 * Secrets are read here and NEVER re-exported to client components or logged.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  /** Deployment environment (Spec §16). Security guards key off this, not NODE_ENV, so a local
   *  production build can still run in mock mode. Set APP_ENV=production on the real deployment. */
  APP_ENV: z.enum(["development", "staging", "production"]).default("development"),
  /** Which DataProvider to use. `mock` needs no database. */
  DATA_PROVIDER: z.enum(["mock", "mssql"]).default("mock"),
  /** Allow the dev-only credentials sign-in (never enable in production). */
  AUTH_DEV_LOGIN: z
    .string()
    .optional()
    .transform((v) => v === "true"),
  /** HMAC key for the session cookie. Required outside test. */
  SESSION_SECRET: z.string().min(16).default("dev-only-change-me-0123456789"),
  /** Institution timezone for snapshots and display (ASSUMPTIONS A-15). */
  APP_TIMEZONE: z.string().default("America/Chicago"),
  /** Minutes after which the latest refresh is considered stale (Spec §19). */
  STALE_AFTER_MINUTES: z.coerce.number().int().positive().default(180),
  /** Delta warning rule: warn when (charges - credits) / charges exceeds this fraction (Spec §6.3). */
  DELTA_WARNING_RATIO: z.coerce.number().min(0).max(1).default(0.1),
  /** Where jobs, runs, snapshots, settings and dashboard users live. memory = in-process (+ optional JSON file); mssql = ousadb schema [dash]. */
  APP_STORE: z.enum(["memory", "mssql"]).default("memory"),
  /** Optional JSON file for the memory store so snapshots survive restarts in development. */
  APP_STORE_FILE: z.string().optional().default(".data/app-store.json"),
  /** Writable login jadi_dash on ousadb (schema [dash] only — A-21). Required when APP_STORE=mssql. */
  DASH_CONNECTION_STRING: z.string().optional(),
  /** @deprecated alias for DASH_CONNECTION_STRING (pre-A-21 name). */
  DATABASE_URL: z.string().optional(),
  /** Developer convenience: the value scripts/setup-dash-login.ps1 stores in the Windows user environment. */
  JADI_DASH_CONNECTION_STRING: z.string().optional(),
  /** Identity store file for APP_STORE=memory (users, sessions, tokens). */
  IDENTITY_STORE_FILE: z.string().optional().default(".data/identity.json"),
  /** Credential policy (USER-MANAGEMENT-PLAN Sec.4). */
  PASSWORD_MIN_LENGTH: z.coerce.number().int().min(8).default(12),
  LOCKOUT_THRESHOLD: z.coerce.number().int().positive().default(5),
  LOCKOUT_MINUTES: z.coerce.number().int().positive().default(15),
  SESSION_IDLE_HOURS: z.coerce.number().positive().default(8),
  SESSION_ABSOLUTE_HOURS: z.coerce.number().positive().default(12),
  CREDENTIAL_TOKEN_HOURS: z.coerce.number().positive().default(72),
  /** Worker identity for job locks (defaults to hostname:pid). */
  WORKER_ID: z.string().optional(),
  /** Source database (ousadb) read-only connection. Only used by the mssql provider. */
  OUSADB_CONNECTION_STRING: z.string().optional(),
  /* ── Phase 5 — Student subsystem (docs/STUDENT-PLAN.md) ────────────────────────────────── */
  /** UNC path or folder holding <idnumber>.jpg student photos (A-27). Unset = the card shows a placeholder. */
  STUDENT_PHOTO_SHARE: z.string().optional(),
  /**
   * A-24 is unsigned: the Bio Spec's global trans_hist lives behind a linked server that may be
   * PRODUCTION. The query is only sent when this is deliberately set to true, so nobody reaches
   * production data by forgetting a flag.
   */
  TRANS_HIST_GLOBAL_ENABLED: z
    .string()
    .optional()
    .transform((v) => v === "true"),
  /** Four-part-name prefix of the linked server holding the Jenzabar Cloud copy (A-24). */
  TRANS_HIST_GLOBAL_SERVER: z.string().default("[172.18.96.11,1433\\MSSQL].[TMSEPRD]"),
  /** Master switch for every AI module (Spec §12, A-13). */
  AI_ENABLED: z
    .string()
    .optional()
    .transform((v) => v === "true"),
  /**
   * A-26: separate switch for the ONE path that sends identified student data (the collection
   * notice). AI_ENABLED alone must not be enough to turn it on.
   */
  AI_IDENTIFIED_DATA_ENABLED: z
    .string()
    .optional()
    .transform((v) => v === "true"),
  /** Days a stored AI draft is kept (A-13 retention). */
  AI_RETENTION_DAYS: z.coerce.number().int().positive().default(90),
  /** Which SQL Server the two connection strings point at (docs/TARGET-SWITCHING-PLAN.md).
   *  Set by the npm scripts (dev:prod, worker:prod, ...); defaults to staging so that a
   *  forgotten flag goes somewhere harmless. resolveTarget() has already run by the time this
   *  is parsed, so the value here is the resolved one. */
  DB_TARGET: z.enum(TARGETS).default("staging"),
});

export type AppConfig = z.infer<typeof envSchema>;

let cached: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (cached) return cached;
  // Promote the target-specific connection strings into the generic names BEFORE validation,
  // so the schema sees one consistent pair whichever target was chosen.
  const resolved = resolveTarget(process.env);

  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Invalid environment configuration: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  }
  if (parsed.data.APP_ENV === "production" && parsed.data.AUTH_DEV_LOGIN) {
    throw new Error("AUTH_DEV_LOGIN must not be enabled in production.");
  }
  // A-26: identified data may only go to a model when the AI module itself is on. Setting the
  // narrower switch alone is a configuration mistake, not a quiet half-enablement.
  if (parsed.data.AI_IDENTIFIED_DATA_ENABLED && !parsed.data.AI_ENABLED) {
    throw new Error("AI_IDENTIFIED_DATA_ENABLED requires AI_ENABLED=true (ASSUMPTIONS A-13, A-26).");
  }
  if (parsed.data.APP_ENV !== "development" && parsed.data.SESSION_SECRET.startsWith("dev-only")) {
    throw new Error("SESSION_SECRET must be set outside development.");
  }
  parsed.data.DASH_CONNECTION_STRING ??= parsed.data.DATABASE_URL ?? parsed.data.JADI_DASH_CONNECTION_STRING;
  if (parsed.data.APP_STORE === "mssql" && !parsed.data.DASH_CONNECTION_STRING) {
    throw new Error(missingConnectionMessage("DASH_CONNECTION_STRING", resolved.target, "APP_STORE=mssql"));
  }
  if (parsed.data.DATA_PROVIDER === "mssql" && !parsed.data.OUSADB_CONNECTION_STRING) {
    throw new Error(missingConnectionMessage("OUSADB_CONNECTION_STRING", resolved.target, "DATA_PROVIDER=mssql"));
  }
  // A production deployment pointed at staging (or the reverse) means one of the two was changed
  // and the other forgotten. There is no legitimate use for the combination.
  if (parsed.data.APP_ENV === "production" && parsed.data.DB_TARGET !== "production") {
    throw new Error(
      `APP_ENV=production requires DB_TARGET=production (currently "${parsed.data.DB_TARGET}"). ` +
        "Refusing to run a production deployment against a non-production database.",
    );
  }
  cached = parsed.data;

  // One line, hosts only — never a connection string. This is the answer to "which database am
  // I actually pointed at", which is otherwise only discoverable from the server side.
  console.log(
    JSON.stringify({
      level: "info",
      msg: "config resolved",
      target: cached.DB_TARGET,
      appEnv: cached.APP_ENV,
      provider: cached.DATA_PROVIDER,
      store: cached.APP_STORE,
      ousaHost: connectionHost(cached.OUSADB_CONNECTION_STRING),
      dashHost: connectionHost(cached.DASH_CONNECTION_STRING),
    }),
  );

  return cached;
}

/** Test helper. */
export function resetConfigCache(): void {
  cached = null;
}
