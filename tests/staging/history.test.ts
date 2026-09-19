/**
 * Historical Analysis against staging (Spec §9). npm run test:staging
 * Also answers the plan's open verification item: are the nightly census / cleared figures actually
 * populated for the older tblOUSA rows, or only for recent ones?
 */
import { afterAll, describe, expect, it } from "vitest";
import { MssqlDataProvider } from "@/server/repositories/mssql/provider";
import { closePools } from "@/server/db/mssql";
import { buildAcademicYears, buildReceivables, buildTermSeries } from "@/server/services/history";
import { buildSemesterIndex } from "@/server/metadata/semesters";

const cs = process.env.OUSADB_CONNECTION_STRING;
const d = cs ? describe : describe.skip;

d("historical analysis against staging ousadb", () => {
  const p = new MssqlDataProvider();
  afterAll(() => closePools());

  it("reports which semesters carry nightly figures and which do not", async () => {
    const terms = await p.getTermMetadata();
    const series = buildTermSeries(terms);
    const missing = terms.filter((t) => !/^summer/i.test(t.semesterName) && !(t.census && t.census > 0)).map((t) => t.semesterName);
    console.info(`captured semesters: ${series.length} of ${terms.length}; without a census figure: ${missing.join(", ") || "none"}`);
    expect(series.length).toBeGreaterThan(0);
    expect(series[0].census).toBeGreaterThan(0);
  }, 60_000);

  it("receivables by semester reconcile with the global positive total", async () => {
    const [terms, balances, rows] = await Promise.all([p.getTermMetadata(), p.getGlobalBalances(), p.getReceivablesByTerm()]);
    const view = buildReceivables(rows, buildSemesterIndex(terms), "semester");
    console.info(`global positive ${balances.positiveTotal} across ${balances.positiveCount}; by-term total ${view.total} across ${view.totalStudents}`);
    expect(view.total).toBeCloseTo(balances.positiveTotal, 2);
    expect(view.totalStudents).toBe(balances.positiveCount);
    // Any unmatched code means tblStudent and tblOUSA have drifted — name them rather than hide them.
    if (view.unknown.students > 0) console.warn(`unmatched term codes: ${view.unknown.terms.join(", ")}`);
  }, 120_000);

  it("academic years pair Fall with the following Spring and omit summer", async () => {
    const years = buildAcademicYears(await p.getTermMetadata());
    expect(years.length).toBeGreaterThan(5);
    expect(years.every((y) => /^\d{4}-\d{4}$/.test(y.academicYear))).toBe(true);
    expect(JSON.stringify(years)).not.toMatch(/summer/i);
  }, 60_000);

  it("runs at page speed", async () => {
    const t0 = Date.now();
    await Promise.all([p.getGlobalBalances(), p.getReceivablesByTerm()]);
    const elapsed = Date.now() - t0;
    console.info(`global balances + receivables by term: ${elapsed} ms`);
    expect(elapsed).toBeLessThan(20_000);
  }, 60_000);
});
