import { describe, expect, it } from "vitest";
import { resolveOperator } from "@/server/metadata/operators";
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
