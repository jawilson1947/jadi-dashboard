/**
 * Database target resolution (docs/TARGET-SWITCHING-PLAN.md).
 *
 * Staging and production differ in exactly one respect: the SQL Server named in the two
 * connection strings. Rather than editing .env.local to move between them, .env.local holds both
 * pairs under suffixed names and DB_TARGET chooses which pair is promoted into the generic names
 * that config.ts reads:
 *
 *   OUSADB_CONNECTION_STRING_STAGING     ─┐  DB_TARGET=staging     ┌─> OUSADB_CONNECTION_STRING
 *   OUSADB_CONNECTION_STRING_PRODUCTION  ─┘  DB_TARGET=production  └─> DASH_CONNECTION_STRING
 *
 * Rules:
 *   - No DB_TARGET            -> "staging". Forgetting the flag goes somewhere harmless.
 *   - Unrecognised DB_TARGET  -> throws. A typo must never silently fall back to the default;
 *                                that is how work lands in the wrong database while reporting
 *                                success.
 *   - Generic name already set -> left alone. Explicit beats derived, so an existing .env.local,
 *                                CI, and one-off overrides keep working unchanged.
 *
 * NOTHING here ever puts a connection string into a thrown message, a log line or a return
 * value. Errors name the VARIABLE and the TARGET, never the value. tests/unit/target.test.ts
 * asserts this.
 */

export const TARGETS = ["staging", "production"] as const;
export type Target = (typeof TARGETS)[number];

/** The generic names config.ts reads, and the suffix stem each derives from. */
const PROMOTED = ["OUSADB_CONNECTION_STRING", "DASH_CONNECTION_STRING"] as const;

export interface ResolvedTarget {
  target: Target;
  /** Which generic names this call filled in (as opposed to finding already set). */
  promoted: string[];
  /** Names that were already set explicitly and therefore left untouched. */
  preserved: string[];
}

export function isTarget(value: unknown): value is Target {
  return typeof value === "string" && (TARGETS as readonly string[]).includes(value);
}

/**
 * Reads DB_TARGET and promotes the matching connection strings into the generic names.
 * Mutates `env` (process.env by default) so that everything downstream — config.ts, the worker,
 * every script — sees one consistent pair.
 */
export function resolveTarget(env: NodeJS.ProcessEnv = process.env): ResolvedTarget {
  const raw = env.DB_TARGET?.trim();

  if (raw !== undefined && raw !== "" && !isTarget(raw)) {
    throw new Error(`DB_TARGET must be one of: ${TARGETS.join(", ")} (received "${raw}").`);
  }
  const target: Target = isTarget(raw) ? raw : "staging";

  const promoted: string[] = [];
  const preserved: string[] = [];

  for (const name of PROMOTED) {
    const existing = env[name]?.trim();
    if (existing) {
      preserved.push(name);
      continue;
    }
    const suffixed = `${name}_${target.toUpperCase()}`;
    const value = env[suffixed]?.trim();
    if (value) {
      env[name] = value;
      promoted.push(name);
    }
    // Absent is not an error here: mock mode needs neither. config.ts raises the error, and
    // requireTargetConnection() below makes that message name the target.
  }

  env.DB_TARGET = target;
  return { target, promoted, preserved };
}

/**
 * Error text for a connection string that the chosen target needs but does not have. Called by
 * config.ts so the message points at the variable actually missing from .env.local rather than at
 * the generic name, which would send someone looking in the wrong place.
 */
export function missingConnectionMessage(name: (typeof PROMOTED)[number], target: Target, because: string): string {
  return (
    `${name} is required when ${because}, and neither ${name} nor ${name}_${target.toUpperCase()} is set. ` +
    `Add ${name}_${target.toUpperCase()} to .env.local, or choose a different DB_TARGET ` +
    `(current: ${target}).`
  );
}

/**
 * The host from a SQL Server connection string, for logging and for the UI. Returns "unknown"
 * rather than throwing, and NEVER returns any other part of the string — no database, no user,
 * and above all no password.
 */
export function connectionHost(connectionString: string | undefined): string {
  if (!connectionString) return "none";
  const match = /(?:^|;)\s*(?:Server|Data Source|Addr(?:ess)?|Network Address)\s*=\s*([^;]+)/i.exec(connectionString);
  return match?.[1]?.trim() || "unknown";
}
