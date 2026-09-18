import { z } from "zod";

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
});

export type AppConfig = z.infer<typeof envSchema>;

let cached: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Invalid environment configuration: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  }
  if (parsed.data.APP_ENV === "production" && parsed.data.AUTH_DEV_LOGIN) {
    throw new Error("AUTH_DEV_LOGIN must not be enabled in production.");
  }
  if (parsed.data.APP_ENV !== "development" && parsed.data.SESSION_SECRET.startsWith("dev-only")) {
    throw new Error("SESSION_SECRET must be set outside development.");
  }
  parsed.data.DASH_CONNECTION_STRING ??= parsed.data.DATABASE_URL ?? parsed.data.JADI_DASH_CONNECTION_STRING;
  if (parsed.data.APP_STORE === "mssql" && !parsed.data.DASH_CONNECTION_STRING) {
    throw new Error("DASH_CONNECTION_STRING is required when APP_STORE=mssql.");
  }
  if (parsed.data.DATA_PROVIDER === "mssql" && !parsed.data.OUSADB_CONNECTION_STRING) {
    throw new Error("OUSADB_CONNECTION_STRING is required when DATA_PROVIDER=mssql.");
  }
  cached = parsed.data;
  return cached;
}

/** Test helper. */
export function resetConfigCache(): void {
  cached = null;
}
