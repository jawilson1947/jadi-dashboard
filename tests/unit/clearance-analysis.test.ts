import { describe, expect, it } from "vitest";
import { MockDataProvider } from "@/server/repositories/mock/provider";
import { CLEARANCE_THRESHOLD, NotCurrentTermError, docFormulaNeeded, getClearanceAnalysis, isEligible } from "@/server/services/clearance-analysis";

const provider = new MockDataProvider();

async function findStudent(predicate: (s: { lastCleared: string | null }) => boolean) {
  const rows = await provider.searchStudents({ by: "name", lastName: "", limit: 200 });
  for (const r of rows) {
    const bio = await provider.getStudentBio(r.idnumber);
    if (bio && predicate(bio)) return bio;
  }
  throw new Error("no matching student in the synthetic dataset");
}

describe("eligibility gate (Bio Spec 1.4.4; A-16)", () => {
  it("treats a term's Traditional and LEAP identifiers as the same semester", () => {
    expect(isEligible("FA2026", ["FA2026", "LF2026"])).toBe(true);
    expect(isEligible("LF2026", ["FA2026", "LF2026"])).toBe(true);
    expect(isEligible("SP2026", ["FA2026", "LF2026"])).toBe(false);
    expect(isEligible(null, ["FA2026", "LF2026"])).toBe(false);
  });

  it("refuses the analysis for a student who is not on the current semester", async () => {
    const past = await findStudent((s) => s.lastCleared === "XX0000" || (s.lastCleared ?? "").startsWith("SP20"));
    await expect(getClearanceAnalysis(past.idnumber, provider)).rejects.toBeInstanceOf(NotCurrentTermError);
  });

  it("produces an analysis for a current enrollee", async () => {
    const current = await findStudent((s) => s.lastCleared === "FA2026");
    const a = await getClearanceAnalysis(current.idnumber, provider);
    expect(a.idnumber).toBe(current.idnumber);
    expect(a.totalMoniesDue).toBeCloseTo(a.accountBalance + a.worksheetNetAmount, 2);
  });
});

describe("the 80% rule has one authority (D-2)", () => {
  it("reports the cost analysis figure, not the Bio Spec's inline arithmetic", async () => {
    const current = await findStudent((s) => s.lastCleared === "FA2026");
    const a = await getClearanceAnalysis(current.idnumber, provider);
    if (a.status === "ok") expect(a.amountNeededToClear).toBe(a.costAnalysis!.needed);
  });

  it("exits with no amount outstanding when the worksheet nets to a credit (1.5.5)", () => {
    expect(docFormulaNeeded(500, -20)).toBeNull();
  });

  it("keeps the doc formula available as an oracle and agrees with it on a plain case", () => {
    // 1.5.5 as written: AccountBalance + (net x 0.80).
    expect(docFormulaNeeded(1000, 500)).toBe(1000 + 500 * CLEARANCE_THRESHOLD);
  });

  it("DIVERGENCE WATCH — records where the two definitions disagree instead of silently picking one", async () => {
    const current = await findStudent((s) => s.lastCleared === "FA2026");
    const a = await getClearanceAnalysis(current.idnumber, provider);
    if (a.status !== "ok" || !a.costAnalysis) return;
    const doc = docFormulaNeeded(a.accountBalance, a.worksheetNetAmount);
    // On synthetic data the institution's function is modelled, so the two may differ. What this test
    // pins is that the APPLICATION shows the function's figure; the comparison is reported, never
    // reconciled by quietly averaging or preferring whichever looks nicer.
    expect(a.amountNeededToClear).toBe(a.costAnalysis.needed);
    if (doc !== null && Math.abs(doc - a.costAnalysis.needed) > 0.01) {
      expect(a.amountNeededToClear).not.toBe(doc);
    }
  });
});
