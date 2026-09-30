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
 * TARGET-PREFERRED VARIABLES ARE THE EXCEPTION TO THAT LAST RULE, and the exception is
 * deliberate (J. Wilson, 2026-09-30). The student photo share is not a secret, and .env.local
 * carries STUDENT_PHOTO_SHARE (the production share) alongside STAGING_PHOTO_SHARE. Under the
 * "explicit beats derived" rule the staging entry would never be read, because the generic name
 * is always set: staging would silently serve production photographs. So for these the
 * target-specific value WINS:
 *
 *   DB_TARGET=staging     -> STAGING_PHOTO_SHARE if set, else STUDENT_PHOTO_SHARE
 *   DB_TARGET=production  -> STUDENT_PHOTO_SHARE
 *
 * The inversion is safe here for the reason it would be unsafe above: a connection string has no
 * correct default, so falling back to an explicit one is right, while a share has a correct
 * default (production) that staging must be able to override.
 *
 * NOTHING here ever puts a connection string into a thrown message, a log line or a return
 * value. Errors name the VARIABLE and the TARGET, never the value. tests/unit/target.test.ts
 * asserts this.
 */

export const TARGETS = ["staging", "production"] as const;
export type Target = (typeof TARGETS)[number];

/** The generic names config.ts reads, and the suffix stem each derives from. */
const PROMOTED = ["OUSADB_CONNECTION_STRING", "DASH_CONNECTION_STRING"] as const;

/**
 * Variables where the target-specific value OVERRIDES an already-set generic name, keyed by the
 * generic name the application reads. A target with no entry keeps whatever the generic name
 * holds — production is the default, and naming it again would be one more thing to keep in step.
 *
 * Values here are filesystem paths, never credentials. Anything secret belongs in PROMOTED above,
 * where an explicit value is never overridden.
 */
const TARGET_PREFERRED: Record<string, Partial<Record<Target, string>>> = {
  // A-27. Staging must not serve photographs of real students from the production share.
  STUDENT_PHOTO_SHARE: { staging: "STAGING_PHOTO_SHARE" },
};

export interface ResolvedTarget {
  target: Target;
  /** Which generic names this call filled in (as opposed to finding already set). */
  promoted: string[];
  /** Names that were already set explicitly and therefore left untouched. */
  preserved: string[];
  /**
   * Generic names a target-specific value replaced, as `NAME<-SOURCE` — the two VARIABLE names,
   * never their values, so this stays safe to log and to serialise.
   */
  overridden: string[];
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

  /*
    Target-preferred variables, applied after the promotions above so the rule is visible in one
    place: the target-specific name wins outright when it is set, whatever the generic name holds.
  */
  const overridden: string[] = [];
  for (const [name, bySource] of Object.entries(TARGET_PREFERRED)) {
    const source = bySource[target];
    if (!source) continue;
    const value = env[source]?.trim();
    if (!value) continue;
    if (env[name]?.trim() === value) continue;
    env[name] = value;
    overridden.push(`${name}<-${source}`);
  }

  env.DB_TARGET = target;
  return { target, promoted, preserved, overridden };
}

/** The target-specific source variable for a generic name, or undefined. Exported for tests. */
export function targetPreferredSource(name: string, target: Target): string | undefined {
  return TARGET_PREFERRED[name]?.[target];
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
