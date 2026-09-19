/**
 * Clearance Sprint against staging (Spec §7). Runs only with OUSADB_CONNECTION_STRING:
 *   npm run test:staging
 *
 * What it proves:
 *   - the sprint population is the same population as the dashboard's Cleared figure (A-2), so the
 *     three sprint views (date, operator, classification) each add up to it and to each other;
 *   - each student is counted exactly once, on their first clearance action in the window;
 *   - the queries are page-speed, not view-speed (FINDINGS §6: FCA aggregates take 40–120 s).
 */
import { afterAll, describe, expect, it } from "vitest";
import { MssqlDataProvider } from "@/server/repositories/mssql/provider";
import { closePools } from "@/server/db/mssql";
import { buildBreakdown } from "@/server/metadata/clearance-breakdown";
import { resolveTerms, type DateRange } from "@/server/repositories/types";

const cs = process.env.OUSADB_CONNECTION_STRING;
const d = cs ? describe : describe.skip;

/** Wide enough to hold the whole term: the source views are scoped to the current term anyway. */
const WINDOW: DateRange = { start: "2026-01-01", end: "2026-12-31" };

d("clearance sprint against staging ousadb", () => {
  const p = new MssqlDataProvider();
  afterAll(() => closePools());

  it("by-date, by-operator and by-classification all reconcile with Cleared", async () => {
    const [byDate, byOperator, counts, hero] = await Promise.all([
      p.getClearanceByDate(WINDOW),
      p.getClearanceByOperator(WINDOW),
      p.getClassificationCounts(WINDOW),
      p.getEnrollmentClearance(),
    ]);
    const dateTotal = byDate.reduce((s, r) => s + r.cleared, 0);
    const operatorTotal = byOperator.reduce((s, r) => s + r.cleared, 0);
    const classTotal = buildBreakdown(counts.enrolled, counts.cleared).find((r) => r.isTotal)!.cleared;

    expect(dateTotal).toBe(hero.cleared);
    expect(operatorTotal).toBe(hero.cleared);
    expect(classTotal).toBe(hero.cleared);
    expect(byDate.every((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date))).toBe(true);
  }, 120_000);

  it("counts each student once: the drill-down for the whole window equals the sprint total", async () => {
    const [byDate, page] = await Promise.all([p.getClearanceByDate(WINDOW), p.getSprintStudents({ range: WINDOW }, { page: 1, pageSize: 10 })]);
    expect(page.totalRows).toBe(byDate.reduce((s, r) => s + r.cleared, 0));
    expect(new Set(page.rows.map((r) => r.idnumber)).size).toBe(page.rows.length);
    expect(page.rows.every((r) => r.clearedAt !== null)).toBe(true);
  }, 120_000);

  it("a single day's drill-down matches that day's count", async () => {
    const byDate = await p.getClearanceByDate(WINDOW);
    const busiest = [...byDate].sort((a, b) => b.cleared - a.cleared)[0];
    const page = await p.getSprintStudents({ range: WINDOW, date: busiest.date }, { page: 1, pageSize: 5 });
    expect(page.totalRows).toBe(busiest.cleared);
  }, 120_000);

  it("an operator's drill-down matches that operator's count", async () => {
    const byOperator = await p.getClearanceByOperator(WINDOW);
    const top = byOperator[0];
    const page = await p.getSprintStudents({ range: WINDOW, operatorCode: top.operatorCode }, { page: 1, pageSize: 5 });
    expect(page.totalRows).toBe(top.cleared);
    expect(page.rows.every((r) => (r.clearedBy ?? "") === top.operatorCode)).toBe(true);
  }, 120_000);

  it("window-scoped classification counts never exceed the term-wide ones", async () => {
    const terms = resolveTerms(await p.getTermMetadata());
    expect(terms.current.tradName).toMatch(/^(FA|SP|SU)\d{4}$/);
    const [wide, narrow] = await Promise.all([p.getClassificationCounts(), p.getClassificationCounts({ start: "2026-08-01", end: "2026-08-31" })]);
    const wideTotal = buildBreakdown(wide.enrolled, wide.cleared).find((r) => r.isTotal)!;
    const narrowTotal = buildBreakdown(narrow.enrolled, narrow.cleared).find((r) => r.isTotal)!;
    expect(narrowTotal.enrolled).toBe(wideTotal.enrolled);
    expect(narrowTotal.cleared).toBeLessThanOrEqual(wideTotal.cleared);
  }, 180_000);

  it("runs at page speed (each sprint query well under the 40–120 s view cost)", async () => {
    const t0 = Date.now();
    await Promise.all([p.getClearanceByDate(WINDOW), p.getClearanceByOperator(WINDOW)]);
    const elapsed = Date.now() - t0;
    console.info(`sprint by-date + by-operator: ${elapsed} ms`);
    expect(elapsed).toBeLessThan(20_000);
  }, 60_000);
});
