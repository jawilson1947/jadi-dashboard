import { describe, expect, it } from "vitest";
import { parseEnv } from "../../scripts/load-env";

describe("script .env loader (npm run db:migrate and friends)", () => {
  it("splits on the first = so connection strings survive intact", () => {
    const cs = "Server=SJ-VMS;Database=ousadb;User Id=jadi_dash;Password=p=a;ss;Encrypt=true";
    expect(parseEnv(`DASH_CONNECTION_STRING=${cs}`).DASH_CONNECTION_STRING).toBe(cs);
  });

  it("handles Windows line endings, comments, blanks and export prefixes", () => {
    const parsed = parseEnv("# comment\r\nAPP_STORE=mssql\r\n\r\nexport APP_ENV=development\r\n");
    expect(parsed).toEqual({ APP_STORE: "mssql", APP_ENV: "development" });
    expect(parsed.APP_STORE).not.toMatch(/\r/);
  });

  it("drops surrounding quotes but keeps inner ones", () => {
    expect(parseEnv('A="quoted value"\nB=\'single\'\nC=say "hi"').A).toBe("quoted value");
    expect(parseEnv("B='single'").B).toBe("single");
    expect(parseEnv('C=say "hi"').C).toBe('say "hi"');
  });

  it("ignores malformed lines rather than inventing keys", () => {
    expect(parseEnv("no-equals-here\n=novalue\n123BAD=x\nGOOD=1")).toEqual({ GOOD: "1" });
  });
});
