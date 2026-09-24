import { describe, expect, it } from "vitest";
import { formatRange, resolveOperator } from "@/server/metadata/operators";
import type { OperatorProfileRecord } from "@/server/store/types";

function profile(p: Partial<OperatorProfileRecord>): OperatorProfileRecord {
  return {
    id: p.id ?? "1",
    sourceCode: p.sourceCode ?? "HSMITH",
    displayName: p.displayName ?? "H. Smith",
    email: p.email ?? null,
    department: p.department ?? null,
    isActive: p.isActive ?? true,
    isSystem: p.isSystem ?? false,
    effectiveFrom: p.effectiveFrom ?? null,
    effectiveTo: p.effectiveTo ?? null,
    updatedAt: new Date("2026-09-18T00:00:00Z"),
    updatedBy: null,
  };
}

describe("operator resolution (Spec §7.2)", () => {
  it("never invents a name for an unmapped code", () => {
    const r = resolveOperator("DSHARPE", "2026-08-14", []);
    expect(r.displayName).toBe("Unmapped (DSHARPE)");
    expect(r.mapped).toBe(false);
  });

  it("keeps a blank code in its own Unknown bucket", () => {
    expect(resolveOperator("", "2026-08-14", []).displayName).toBe("Unknown");
    expect(resolveOperator(null, null, []).mapped).toBe(false);
  });

  it("treats sa as automatic clearance rather than a person (Spec §10.5)", () => {
    const r = resolveOperator("sa", "2026-08-14", []);
    expect(r.isSystem).toBe(true);
    expect(r.mapped).toBe(true);
  });

  it("resolves a code to whoever held it on the date of the action", () => {
    const profiles = [
      profile({ id: "a", displayName: "First Holder", effectiveFrom: null, effectiveTo: "2025-12-31" }),
      profile({ id: "b", displayName: "Second Holder", effectiveFrom: "2026-01-01" }),
    ];
    expect(resolveOperator("HSMITH", "2025-08-14", profiles).displayName).toBe("First Holder");
    expect(resolveOperator("HSMITH", "2026-08-14", profiles).displayName).toBe("Second Holder");
  });

  it("matches the code case-insensitively but reports the code as recorded", () => {
    const r = resolveOperator("hsmith", "2026-08-14", [profile({})]);
    expect(r.displayName).toBe("H. Smith");
    expect(r.code).toBe("hsmith");
  });
});

describe("a profile whose dates exclude the actions is not the same as no profile (2026-09-24)", () => {
  const dated = [profile({ id: "d", sourceCode: "DSHARPE", displayName: "D. Sharpe", effectiveFrom: "2026-09-24" })];

  it("reports out-of-range, names the person and the range, and does not say a profile is needed", () => {
    const r = resolveOperator("DSHARPE", "2026-09-19", dated);
    expect(r.mapped).toBe(false);
    expect(r.reason).toBe("out-of-range");
    expect(r.ranges).toEqual([{ displayName: "D. Sharpe", effectiveFrom: "2026-09-24", effectiveTo: null }]);
    expect(r.displayName).not.toContain("Unmapped");
  });

  it("still reports no-profile when the code has none at all", () => {
    expect(resolveOperator("NOBODY", "2026-09-19", dated).reason).toBe("no-profile");
  });

  it("resolves normally once the date falls inside the range", () => {
    const r = resolveOperator("DSHARPE", "2026-09-30", dated);
    expect(r.reason).toBe("mapped");
    expect(r.displayName).toBe("D. Sharpe");
  });

  it("treats a dateless action as uncovered by a dated profile, and says why", () => {
    expect(resolveOperator("DSHARPE", null, dated).reason).toBe("out-of-range");
  });

  it("keeps the system account and the blank code in their own buckets", () => {
    expect(resolveOperator("sa", "2026-09-19", dated).reason).toBe("system");
    expect(resolveOperator("", "2026-09-19", dated).reason).toBe("blank-code");
  });

  it("describes every shape of range in words an administrator can act on", () => {
    expect(formatRange({ displayName: "x", effectiveFrom: "2026-01-01", effectiveTo: "2026-06-30" })).toBe("2026-01-01 to 2026-06-30");
    expect(formatRange({ displayName: "x", effectiveFrom: "2026-01-01", effectiveTo: null })).toBe("from 2026-01-01");
    expect(formatRange({ displayName: "x", effectiveFrom: null, effectiveTo: "2026-06-30" })).toBe("until 2026-06-30");
    expect(formatRange({ displayName: "x", effectiveFrom: null, effectiveTo: null })).toBe("open-ended");
  });
});
