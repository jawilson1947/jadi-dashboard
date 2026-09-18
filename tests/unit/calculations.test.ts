import { describe, expect, it } from "vitest";
import { academicYearForTerm, chargesCreditsDelta, clearancePercentage, deltaTreatment, isStale } from "@/server/services/calculations";

describe("clearancePercentage (Spec §6.1, App. B)", () => {
  it("computes cleared / enrolled * 100", () => {
    expect(clearancePercentage(1906, 2431)).toBeCloseTo(78.4039, 3);
  });
  it("returns null instead of dividing by zero", () => {
    expect(clearancePercentage(0, 0)).toBeNull();
    expect(clearancePercentage(5, 0)).toBeNull();
  });
});

describe("charges/credits delta (Spec §6.3)", () => {
  it("delta = charges - credits", () => {
    expect(chargesCreditsDelta(100, 40)).toBe(60);
  });
  it("treatment follows the configurable rule and is a token, not a color", () => {
    expect(deltaTreatment(100, 120, 0.1)).toBe("positive");
    expect(deltaTreatment(100, 95, 0.1)).toBe("neutral");
    expect(deltaTreatment(100, 80, 0.1)).toBe("warning");
    expect(deltaTreatment(0, 0, 0.1)).toBe("positive");
  });
});

describe("academic year grouping (Spec §9.1)", () => {
  it("groups Fall and the following Spring", () => {
    expect(academicYearForTerm("FA2025")).toBe("2025-2026");
    expect(academicYearForTerm("SP2026")).toBe("2025-2026");
    expect(academicYearForTerm("LEAP-FA2026")).toBe("2026-2027");
  });
  it("rejects unknown codes", () => {
    expect(academicYearForTerm("WINTER26")).toBeNull();
  });
});

describe("stale detection (Spec §19)", () => {
  it("flags refreshes older than the threshold", () => {
    const captured = new Date("2026-09-17T07:00:00Z");
    expect(isStale(captured, new Date("2026-09-17T09:00:00Z"), 180)).toBe(false);
    expect(isStale(captured, new Date("2026-09-17T10:01:00Z"), 180)).toBe(true);
  });
});
