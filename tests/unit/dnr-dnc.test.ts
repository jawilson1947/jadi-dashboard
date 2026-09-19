import { describe, expect, it } from "vitest";
import { applyFilter, receivableOf, sortRows, type DnrDncTableRow } from "@/server/services/dnr-dnc";

function row(p: Partial<DnrDncTableRow>): DnrDncTableRow {
  return {
    category: p.category ?? "DNC",
    classificationCode: p.classificationCode ?? "FR",
    classification: p.classification ?? "Freshmen",
    idnumber: p.idnumber ?? "100001",
    lastName: p.lastName ?? "Smith",
    firstName: p.firstName ?? "Avery",
    accountBalance: p.accountBalance ?? 100,
    email: p.email ?? "a@example.edu",
    lastCleared: p.lastCleared ?? "FA2026",
    enrolledCurrentTerm: p.enrolledCurrentTerm ?? true,
    clearedCurrentSession: p.clearedCurrentSession ?? false,
    pidMasked: "•••••1234",
  };
}

describe("DNR/DNC filters (Spec §8)", () => {
  const rows = [
    row({ category: "DNC", classificationCode: "FR", accountBalance: 500, lastCleared: "FA2026" }),
    row({ category: "DNR", classificationCode: "SR", accountBalance: 2500, lastCleared: "SP2026" }),
    row({ category: "DNC", classificationCode: "TR", accountBalance: 50, lastCleared: "LF2026" }),
  ];

  it("filters by category, classification, balance range and last-cleared value", () => {
    expect(applyFilter(rows, { category: "DNR" })).toHaveLength(1);
    expect(applyFilter(rows, { classification: "TR" })[0].accountBalance).toBe(50);
    expect(applyFilter(rows, { minBalance: 100 })).toHaveLength(2);
    expect(applyFilter(rows, { minBalance: 100, maxBalance: 1000 })).toHaveLength(1);
    expect(applyFilter(rows, { lastCleared: "LF2026" })).toHaveLength(1);
    expect(applyFilter(rows, {})).toHaveLength(3);
  });

  it("totals only positive balances, to the cent", () => {
    expect(receivableOf(rows)).toBe(3050);
    expect(receivableOf([])).toBe(0);
  });
});

describe("DNR/DNC ordering (Spec §8 default sort)", () => {
  const rows = [
    row({ category: "DNR", classification: "Senior", lastName: "Turner", firstName: "Blake" }),
    row({ category: "DNC", classification: "Freshmen", lastName: "Brooks", firstName: "Zion" }),
    row({ category: "DNC", classification: "Freshmen", lastName: "Brooks", firstName: "Avery" }),
    row({ category: "DNC", classification: "Senior", lastName: "Adams", firstName: "Kai" }),
  ];

  it("defaults to category, classification, last name, first name", () => {
    const sorted = sortRows(rows, "default", "asc");
    expect(sorted.map((r) => `${r.category}/${r.classification}/${r.lastName}/${r.firstName}`)).toEqual([
      "DNC/Freshmen/Brooks/Avery",
      "DNC/Freshmen/Brooks/Zion",
      "DNC/Senior/Adams/Kai",
      "DNR/Senior/Turner/Blake",
    ]);
  });

  it("keeps the default order as the tie-breaker under a column sort", () => {
    const sorted = sortRows(rows, "classification", "asc");
    expect(sorted.map((r) => r.classification)).toEqual(["Freshmen", "Freshmen", "Senior", "Senior"]);
    expect(sorted.slice(0, 2).map((r) => r.firstName)).toEqual(["Avery", "Zion"]);
  });

  it("sorts balances numerically in both directions", () => {
    const money = [row({ accountBalance: 90 }), row({ accountBalance: 1000 }), row({ accountBalance: 200 })];
    expect(sortRows(money, "accountBalance", "asc").map((r) => r.accountBalance)).toEqual([90, 200, 1000]);
    expect(sortRows(money, "accountBalance", "desc").map((r) => r.accountBalance)).toEqual([1000, 200, 90]);
  });
});
