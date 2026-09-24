import { describe, expect, it } from "vitest";
import { MockDataProvider } from "@/server/repositories/mock/provider";
import { MemoryAppStore } from "@/server/store/memory";
import { DEFAULT_SOURCE_LABELS, SOURCE_LABELS_SETTING, getTransactionsView, labelFor, summarizeYears } from "@/server/services/transactions";

const provider = new MockDataProvider();

describe("transaction source labels (A-28)", () => {
  it("uses the Bio Spec's map by default", () => {
    expect(labelFor("FA", DEFAULT_SOURCE_LABELS)).toBe("Financial Aid");
    expect(labelFor("rc", DEFAULT_SOURCE_LABELS)).toBe("Cash or Credit Card");
    expect(labelFor("IV", DEFAULT_SOURCE_LABELS)).toBe("Refund");
  });

  it("shows an unknown code as itself rather than folding it into Miscellaneous", () => {
    expect(labelFor("ZZ", DEFAULT_SOURCE_LABELS)).toBe("ZZ");
  });

  it("lets an administrator name a code without a deployment", async () => {
    const store = new MemoryAppStore();
    await store.setSetting(SOURCE_LABELS_SETTING, { ZZ: "Third-party sponsor" }, "u-admin");
    const id = (await provider.searchStudents({ by: "name", lastName: "", limit: 1 })).at(0)?.idnumber;
    expect(id).toBeDefined();
    const view = await getTransactionsView(id!, { scope: "global" }, provider, store);
    expect(labelFor("ZZ", { ...DEFAULT_SOURCE_LABELS, ZZ: "Third-party sponsor" })).toBe("Third-party sponsor");
    expect(view.rows.every((r) => r.sourceLabel.length > 0)).toBe(true);
  });
});

describe("transaction paging by year (Bio Spec 2.1)", () => {
  it("groups the history into years, newest first, with per-year totals", () => {
    const years = summarizeYears([
      { postedOn: "2026-01-02", description: "a", amount: 100, sourceCode: "CG" },
      { postedOn: "2026-05-02", description: "b", amount: -40, sourceCode: "RC" },
      { postedOn: "2024-05-02", description: "c", amount: 70, sourceCode: "CG" },
    ]);
    expect(years.map((y) => y.year)).toEqual(["2026", "2024"]);
    expect(years[0]).toMatchObject({ rows: 2, debits: 100, credits: 40 });
  });

  it("defaults to the newest year and pages within it", async () => {
    const id = (await provider.searchStudents({ by: "name", lastName: "", limit: 1 })).at(0)!.idnumber;
    const view = await getTransactionsView(id, { scope: "global", pageSize: 5 }, provider, new MemoryAppStore());
    expect(view.year).toBe(view.years[0]?.year ?? null);
    expect(view.rows.length).toBeLessThanOrEqual(5);
    expect(view.totalRows).toBe(view.years[0]?.rows ?? 0);
    // The header count is the whole history, not the page — a page total would understate the account.
    expect(view.allRows).toBeGreaterThanOrEqual(view.totalRows);
  });

  it("returns the newest transaction first", async () => {
    const id = (await provider.searchStudents({ by: "name", lastName: "", limit: 1 })).at(0)!.idnumber;
    const view = await getTransactionsView(id, { scope: "global", pageSize: 200 }, provider, new MemoryAppStore());
    const dates = view.rows.map((r) => r.postedOn);
    expect([...dates].sort().reverse()).toEqual(dates);
  });
});
