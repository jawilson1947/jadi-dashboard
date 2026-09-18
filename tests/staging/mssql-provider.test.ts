/**
 * Runs ONLY when OUSADB_CONNECTION_STRING is set (staging, read-only login).
 *   npm run test:staging
 * Reads aggregates and one page of drill-down rows; asserts the A-1/A-2 definitions reconcile
 * and that no forbidden column reaches the application layer.
 */
import { afterAll, describe, expect, it } from "vitest";
import { MssqlDataProvider } from "@/server/repositories/mssql/provider";
import { closePools } from "@/server/db/mssql";
import { resolveTerms } from "@/server/repositories/types";

const cs = process.env.OUSADB_CONNECTION_STRING;
const d = cs ? describe : describe.skip;

d("mssql provider against staging ousadb", () => {
  const p = new MssqlDataProvider();
  afterAll(() => closePools());

  it("resolves exactly one current and one previous term from tblOUSA", async () => {
    const terms = await p.getTermMetadata();
    expect(terms.length).toBeGreaterThan(20);
    const r = resolveTerms(terms);
    expect(r.current.tradName).toMatch(/^(FA|SP|SU)\d{4}$/);
    expect(r.currentKeys).toHaveLength(2);
  }, 30_000);

  it("hero figures reconcile: cleared + notCleared - clearedNotEnrolled = enrolled", async () => {
    const e = await p.getEnrollmentClearance();
    expect(e.enrolled).toBeGreaterThan(0);
    expect(e.cleared + e.notCleared - e.clearedNotEnrolled).toBe(e.enrolled);
    expect(e.nightly).not.toBeNull();
  }, 120_000);

  it("DNC/DNR match the supplied query semantics and the DNR guard holds", async () => {
    const dd = await p.getDnrDncSummary();
    expect(dd.dnc.count).toBeGreaterThan(0);
    expect(dd.dnrGuardViolations).toBe(0);
    const dnr = await p.getStudentsForPopulation("dnr", { page: 1, pageSize: 500 });
    expect(dnr.totalRows).toBe(dd.dnr.count);
    expect(dnr.rows.every((r) => r.accountBalance > 0 && r.status === "Cleared" && !r.enrolledCurrentTerm)).toBe(true);
    const dnc = await p.getStudentsForPopulation("dnc", { page: 1, pageSize: 500 });
    expect(dnc.totalRows).toBe(dd.dnc.count);
  }, 60_000);

  it("receivable and charges/credits return typed numbers", async () => {
    const terms = resolveTerms(await p.getTermMetadata());
    const r = await p.getCurrentReceivable(terms.currentKeys);
    expect(typeof r.total).toBe("number");
    const cc = await p.getChargesCredits();
    expect(cc.charges).toBeGreaterThan(0);
    expect(typeof cc.afterDropDate).toBe("boolean");
  }, 60_000);

  it("drill-down rows carry only the approved fields", async () => {
    const page = await p.getStudentsForPopulation("notCleared", { page: 1, pageSize: 5, sort: { field: "accountBalance", direction: "desc" } });
    expect(page.rows.length).toBeGreaterThan(0);
    const keys = Object.keys(page.rows[0]).sort();
    expect(keys).toEqual(["accountBalance", "classificationCode", "clearedAt", "clearedBy", "email", "enrolledCurrentTerm", "firstName", "idnumber", "isIncomingTransfer", "lastCleared", "lastName", "middleName", "pid", "status"]);
  }, 60_000);
});
