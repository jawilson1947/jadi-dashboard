import { describe, expect, it } from "vitest";
import { coverageWarning, type ObservedCode } from "@/components/admin/sprint/OperatorForm";

const codes: ObservedCode[] = [{ code: "DSHARPE", cleared: 412, firstAt: "2026-04-14T15:00:00Z", lastAt: "2026-09-19T18:00:00Z" }];

/**
 * The form's guard against the mistake that started this: dates that silently exclude every action
 * the code has, leaving a saved profile looking like no profile at all.
 */
describe("effective-date coverage warning", () => {
  it("says nothing when both dates are empty — an open-ended mapping is the normal case", () => {
    expect(coverageWarning({ sourceCode: "DSHARPE", effectiveFrom: "", effectiveTo: "" }, codes)).toBeNull();
  });

  it("warns that every action is excluded when the range starts after the last one", () => {
    const w = coverageWarning({ sourceCode: "DSHARPE", effectiveFrom: "2026-09-24", effectiveTo: "" }, codes);
    expect(w).toContain("all 412");
    expect(w).toContain("2026-04-14 to 2026-09-19");
  });

  it("warns that every action is excluded when the range ends before the first one", () => {
    expect(coverageWarning({ sourceCode: "DSHARPE", effectiveFrom: "", effectiveTo: "2026-01-01" }, codes)).toContain("all 412");
  });

  it("warns about a partial range without calling it a total miss", () => {
    const w = coverageWarning({ sourceCode: "DSHARPE", effectiveFrom: "2026-06-01", effectiveTo: "" }, codes);
    expect(w).toContain("only part");
    expect(w).not.toContain("all 412");
  });

  it("says nothing when the range covers the whole span, or the code has no actions here", () => {
    expect(coverageWarning({ sourceCode: "DSHARPE", effectiveFrom: "2026-01-01", effectiveTo: "2026-12-31" }, codes)).toBeNull();
    expect(coverageWarning({ sourceCode: "NEWCODE", effectiveFrom: "2026-09-24", effectiveTo: "" }, codes)).toBeNull();
  });

  it("matches the code case-insensitively, as the resolver does", () => {
    expect(coverageWarning({ sourceCode: "dsharpe", effectiveFrom: "2026-09-24", effectiveTo: "" }, codes)).toContain("all 412");
  });
});
