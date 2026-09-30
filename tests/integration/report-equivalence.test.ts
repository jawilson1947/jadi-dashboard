import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getSourcePool, closePools } from "@/server/db/mssql";
import { RQ } from "@/server/repositories/mssql/report-sql";

/**
 * Equivalence: the rewritten report queries return the same students as the supplied scripts.
 *
 * This is the control the whole Phase 7a plan rests on. Four reports read VIEW_OURM_FCA or
 * VIEW_OURM_STATS at 40–120 s, and the application replaces them with queries over the objects
 * underneath. That is only safe if something fails when the two disagree — a comment claiming they
 * match is worth nothing.
 *
 * Runs only with VITEST_STAGING=1 (`npm run test:staging`), because it needs a real database and
 * deliberately executes the slow originals. Expect it to take a couple of minutes.
 *
 * It compares ID SETS, not whole rows. Two known and intended differences would break a row-level
 * comparison:
 *   - R6: `[rows] = 1` in VIEW_OURM_STATS picks an arbitrary action for a twice-cleared student,
 *     so DateCleared is not stable in the original. One instance is all that is required
 *     (J. Wilson, 2026-09-29); the rewrite makes it the same instance every time.
 *   - R2: the rewrite drops FORMAT(), so dates come back typed rather than as MM/dd/yyyy strings.
 */

const STAGING = process.env.VITEST_STAGING === "1";
const suite = STAGING ? describe : describe.skip;

const scriptDir = join(process.cwd(), "docs", "validation-sql", "reports");
const script = (name: string) => readFileSync(join(scriptDir, name), "utf8");

async function ids(sql: string, column = "idnumber", params: Record<string, number> = {}): Promise<Set<string>> {
  const pool = await getSourcePool();
  const req = pool.request();
  for (const [k, v] of Object.entries(params)) req.input(k, v);
  const r = await req.query(sql);
  // A batch returns several recordsets; the ids are in the last one that has the column.
  const sets = (r.recordsets as unknown as Record<string, unknown>[][]) ?? [r.recordset];
  const rows = [...sets].reverse().find((rs) => rs.length > 0 && column in rs[0]) ?? r.recordset ?? [];
  return new Set(rows.map((row) => String((row as Record<string, unknown>)[column]).trim()));
}

/** Report the difference in a way that names the students, not just a count. */
function diff(a: Set<string>, b: Set<string>) {
  return {
    onlyInOriginal: [...a].filter((x) => !b.has(x)).slice(0, 20),
    onlyInRewrite: [...b].filter((x) => !a.has(x)).slice(0, 20),
  };
}

suite("report SQL equivalence against staging (docs/validation-sql/reports)", () => {
  beforeAll(() => {
    if (!process.env.OUSADB_CONNECTION_STRING) throw new Error("OUSADB_CONNECTION_STRING is required for the staging suite");
  });
  afterAll(async () => {
    await closePools();
  });

  it("R1 unclassified: same students as GetUnclassifiedStudents.sql", async () => {
    const original = await ids(script("GetUnclassifiedStudents.sql"));
    const rewrite = await ids(RQ.unclassified);
    expect(diff(original, rewrite)).toEqual({ onlyInOriginal: [], onlyInRewrite: [] });
  }, 300_000);

  it("R3 cleared more than once: same students as StudentsClearedMoreThanOnce.sql", async () => {
    const original = await ids(script("StudentsClearedMoreThanOnce.sql"));
    const rewrite = await ids(RQ.clearedMoreThanOnce);
    expect(diff(original, rewrite)).toEqual({ onlyInOriginal: [], onlyInRewrite: [] });
  }, 300_000);

  it("R4 enrollee balance: the captured population covers every row the script returns for any range", async () => {
    // The script takes a range; the rewrite captures the population unfiltered and filters in the
    // service. Equivalence therefore means: for a wide range, the script's rows are a subset of
    // the captured population. A student in the script but not the population is a real defect.
    const pool = await getSourcePool();
    const r = await pool
      .request()
      .input("min", 0.01)
      .input("max", 99_999_999)
      .query(script("fcaAccountBalanceMailMerge.sql").replace(/\?/g, (_m, i) => (i === 0 ? "@min" : "@max")).replace("between  @min and @max", "between @min and @max"));
    const original = new Set(r.recordset.map((row: Record<string, unknown>) => String(row.idnumber).trim()));
    const population = await ids(RQ.enrolleeBalancePopulation);
    expect([...original].filter((x) => !population.has(x)).slice(0, 20)).toEqual([]);
  }, 300_000);

  it("R6 currently cleared: same students as CurrentlyCleared.sql", async () => {
    const original = await ids(script("CurrentlyCleared.sql"), "idnumber");
    const rewrite = await ids(RQ.currentlyCleared);
    expect(diff(original, rewrite)).toEqual({ onlyInOriginal: [], onlyInRewrite: [] });
  }, 300_000);

  it("R2 freshman analysis: same students, and the same mismatch verdict per student", async () => {
    const pool = await getSourcePool();
    const [a, b] = await Promise.all([pool.request().query(script("FreshmanWebCodeAnalysis.sql")), pool.request().query(RQ.freshmanAnalysis)]);
    const original = new Map(
      a.recordset.map((row: Record<string, unknown>) => [String(row.idnumber).trim(), String(row.cCode).trim().toUpperCase() !== String(row.cClass).trim().toUpperCase()]),
    );
    const rewrite = new Map(b.recordset.map((row: Record<string, unknown>) => [String(row.idnumber).trim(), Boolean(row.mismatch)]));
    expect([...rewrite.keys()].sort()).toEqual([...original.keys()].sort());
    // The verdict is the report's entire output, so it must match student by student, not in total.
    const disagreements = [...original.entries()].filter(([id, v]) => rewrite.get(id) !== v).map(([id]) => id);
    expect(disagreements.slice(0, 20)).toEqual([]);
  }, 300_000);
});
