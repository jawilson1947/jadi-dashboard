import { describe, expect, it } from "vitest";
import { classificationDisplayName, normalizeClassificationCode } from "@/server/metadata/classifications";

describe("classification mappings (Spec §7.3, §15)", () => {
  it("treats Incoming Transfer as TR before combining FF/FR as Freshmen", () => {
    expect(normalizeClassificationCode("Incoming Transfer")).toBe("TR");
    expect(classificationDisplayName("Incoming Transfer").displayName).toBe("Transfer Student");
    expect(classificationDisplayName("FF").displayName).toBe("Freshmen");
    expect(classificationDisplayName("fr").displayName).toBe("Freshmen");
  });
  it("normalizes blank, null and XX to Unclassified", () => {
    for (const raw of ["", "  ", null, undefined, "XX"]) {
      expect(classificationDisplayName(raw).displayName).toBe("Unclassified");
    }
  });
  it("surfaces unknown codes instead of hiding them", () => {
    const r = classificationDisplayName("ZZ");
    expect(r.mapped).toBe(false);
    expect(r.displayName).toContain("ZZ");
  });
});
