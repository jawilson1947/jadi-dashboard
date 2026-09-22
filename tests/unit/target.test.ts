import { beforeEach, describe, expect, it } from "vitest";
import { connectionHost, isTarget, missingConnectionMessage, resolveTarget } from "@/server/db/target";

const STAGING_OUSA = "Server=STAGINGSQL;Database=ousadb;User Id=jadi_readonly;Password=s3cret-staging;Encrypt=true";
const STAGING_DASH = "Server=STAGINGSQL;Database=ousadb;User Id=jadi_dash;Password=s3cret-staging;Encrypt=true";
const PROD_OUSA = "Server=OUSASERVER03;Database=ousadb;User Id=jadi_readonly;Password=s3cret-prod;Encrypt=true";
const PROD_DASH = "Server=OUSASERVER03;Database=ousadb;User Id=jadi_dash;Password=s3cret-prod;Encrypt=true";

/** A .env.local with both pairs and neither generic name set. */
function bothPairs(): NodeJS.ProcessEnv {
  return {
    OUSADB_CONNECTION_STRING_STAGING: STAGING_OUSA,
    DASH_CONNECTION_STRING_STAGING: STAGING_DASH,
    OUSADB_CONNECTION_STRING_PRODUCTION: PROD_OUSA,
    DASH_CONNECTION_STRING_PRODUCTION: PROD_DASH,
  } as unknown as NodeJS.ProcessEnv;
}

describe("resolveTarget (docs/TARGET-SWITCHING-PLAN.md)", () => {
  let env: NodeJS.ProcessEnv;
  beforeEach(() => {
    env = bothPairs();
  });

  it("defaults to staging when DB_TARGET is absent", () => {
    const r = resolveTarget(env);
    expect(r.target).toBe("staging");
    expect(env.OUSADB_CONNECTION_STRING).toBe(STAGING_OUSA);
    expect(env.DASH_CONNECTION_STRING).toBe(STAGING_DASH);
    expect(r.promoted).toEqual(["OUSADB_CONNECTION_STRING", "DASH_CONNECTION_STRING"]);
  });

  it("treats an empty DB_TARGET as absent", () => {
    env.DB_TARGET = "   ";
    expect(resolveTarget(env).target).toBe("staging");
    expect(env.OUSADB_CONNECTION_STRING).toBe(STAGING_OUSA);
  });

  it("promotes the production pair when asked", () => {
    env.DB_TARGET = "production";
    const r = resolveTarget(env);
    expect(r.target).toBe("production");
    expect(env.OUSADB_CONNECTION_STRING).toBe(PROD_OUSA);
    expect(env.DASH_CONNECTION_STRING).toBe(PROD_DASH);
  });

  it("throws on an unrecognised DB_TARGET rather than falling back", () => {
    env.DB_TARGET = "prod"; // the plausible typo
    expect(() => resolveTarget(env)).toThrow(/DB_TARGET must be one of: staging, production/);
    // and nothing was promoted
    expect(env.OUSADB_CONNECTION_STRING).toBeUndefined();
  });

  it("leaves an explicitly set generic name alone (explicit beats derived)", () => {
    const pinned = "Server=SOMEWHERE-ELSE;Database=ousadb;User Id=x;Password=y";
    env.OUSADB_CONNECTION_STRING = pinned;
    env.DB_TARGET = "production";
    const r = resolveTarget(env);
    expect(env.OUSADB_CONNECTION_STRING).toBe(pinned);
    expect(env.DASH_CONNECTION_STRING).toBe(PROD_DASH);
    expect(r.preserved).toEqual(["OUSADB_CONNECTION_STRING"]);
    expect(r.promoted).toEqual(["DASH_CONNECTION_STRING"]);
  });

  it("leaves generic names unset when the target has no suffixed pair (mock mode)", () => {
    const empty = {} as unknown as NodeJS.ProcessEnv;
    const r = resolveTarget(empty);
    expect(r.target).toBe("staging");
    expect(empty.OUSADB_CONNECTION_STRING).toBeUndefined();
    expect(r.promoted).toEqual([]);
  });

  it("records the resolved target back into the environment", () => {
    env.DB_TARGET = "production";
    resolveTarget(env);
    expect(env.DB_TARGET).toBe("production");
  });
});

describe("missingConnectionMessage", () => {
  it("names the suffixed variable and the target, not the generic name alone", () => {
    const msg = missingConnectionMessage("DASH_CONNECTION_STRING", "production", "APP_STORE=mssql");
    expect(msg).toContain("DASH_CONNECTION_STRING_PRODUCTION");
    expect(msg).toContain("production");
    expect(msg).toContain("APP_STORE=mssql");
  });
});

describe("connectionHost", () => {
  it("returns the server only", () => {
    expect(connectionHost(PROD_OUSA)).toBe("OUSASERVER03");
    expect(connectionHost("Data Source=SQL01\\INST,1433;Database=x;Password=p")).toBe("SQL01\\INST,1433");
  });
  it("degrades without throwing", () => {
    expect(connectionHost(undefined)).toBe("none");
    expect(connectionHost("Database=x;User Id=y")).toBe("unknown");
  });
  it("never leaks the password", () => {
    expect(connectionHost(PROD_DASH)).not.toContain("s3cret");
  });
});

/**
 * The resolver exists to handle secrets, so the thing most worth proving is that it never
 * repeats one. A "could not connect using Server=...;Password=..." error is how credentials end
 * up in a log file that gets emailed around.
 */
describe("no connection string ever reaches an error message", () => {
  const secrets = ["s3cret-staging", "s3cret-prod", STAGING_OUSA, STAGING_DASH, PROD_OUSA, PROD_DASH];

  it("not from an invalid DB_TARGET", () => {
    const env = bothPairs();
    env.DB_TARGET = "nonsense";
    try {
      resolveTarget(env);
      expect.unreachable("should have thrown");
    } catch (e) {
      const text = e instanceof Error ? `${e.message}${e.stack ?? ""}` : String(e);
      for (const s of secrets) expect(text).not.toContain(s);
    }
  });

  it("not from a missing connection string", () => {
    for (const target of ["staging", "production"] as const) {
      const msg = missingConnectionMessage("OUSADB_CONNECTION_STRING", target, "DATA_PROVIDER=mssql");
      for (const s of secrets) expect(msg).not.toContain(s);
    }
  });

  it("not from the resolver's return value", () => {
    const env = bothPairs();
    const serialised = JSON.stringify(resolveTarget(env));
    for (const s of secrets) expect(serialised).not.toContain(s);
  });
});

describe("isTarget", () => {
  it("accepts only the two targets", () => {
    expect(isTarget("staging")).toBe(true);
    expect(isTarget("production")).toBe(true);
    expect(isTarget("prod")).toBe(false);
    expect(isTarget(undefined)).toBe(false);
  });
});
