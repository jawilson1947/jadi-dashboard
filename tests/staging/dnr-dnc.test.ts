/**
 * DNR/DNC detail against staging (Spec §8). Runs only with OUSADB_CONNECTION_STRING:
 *   npm run test:staging
 * Proves the detail rows are the same population as the summary card (A-1), that the DNR guard holds,
 * and that the query is page-speed rather than view-speed.
 */
import { afterAll, describe, expect, it } from "vitest";
import { MssqlDataProvider } from "@/server/repositories/mssql/provider";
import { closePools } from "@/server/db/mssql";

const cs = process.env.OUSADB_CONNECTION_STRING;
const d = cs ? describe : describe.skip;

d("DNR/DNC population against staging ousadb", () => {
  const p = new MssqlDataProvider();
  afterAll(() => closePools());

  it("detail rows reconcile row-for-row and dollar-for-dollar with the summary card", async () => {
    const t0 = Date.now();
    const [rows, summary] = await Promise.all([p.getDnrDncPopulation(), p.getDnrDncSummary()]);
    console.info(`dnr/dnc population: ${rows.length} rows in ${Date.now() - t0} ms`);

    const of = (category: "DNR" | "DNC") => rows.filter((r) => r.category === category);
    expect(of("DNC")).toHaveLength(summary.dnc.count);
    expect(of("DNR")).toHaveLength(summary.dnr.count);
    const sum = (category: "DNR" | "DNC") => Math.round(of(category).reduce((s, r) => s + r.accountBalance, 0) * 100) / 100;
    expect(sum("DNC")).toBeCloseTo(summary.dnc.positiveBalance, 2);
    expect(sum("DNR")).toBeCloseTo(summary.dnr.positiveBalance, 2);
  }, 120_000);

  it("every row owes money, appears once, and DNR rows are absent from current enrollment", async () => {
    const rows = await p.getDnrDncPopulation();
    expect(rows.every((r) => r.accountBalance > 0)).toBe(true);
    const keys = rows.map((r) => r.idnumber);
    expect(new Set(keys).size, "a student appears in one category only").toBe(keys.length);
    expect(rows.filter((r) => r.category === "DNR").every((r) => !r.enrolledCurrentTerm)).toBe(true);
    expect(rows.filter((r) => r.category === "DNC").every((r) => r.status === "Not Cleared")).toBe(true);
  }, 120_000);

  it("stays well inside the safety cap and runs at page speed", async () => {
    const t0 = Date.now();
    const rows = await p.getDnrDncPopulation();
    expect(rows.length).toBeLessThan(5000);
    expect(Date.now() - t0).toBeLessThan(20_000);
  }, 60_000);
});
