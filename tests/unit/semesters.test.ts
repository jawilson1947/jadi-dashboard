import { describe, expect, it } from "vitest";
import { buildSemesterIndex, isSummerCode, NEVER_CLEARED, resolveSemester, semesterLabel } from "@/server/metadata/semesters";
import { generateTerms } from "@/server/repositories/mock/synthetic";

const index = buildSemesterIndex(generateTerms());

describe("semester resolver (A-22)", () => {
  it("resolves both the Traditional and the LEAP identifier of a row", () => {
    const trad = resolveSemester("FA2025", index);
    const leap = resolveSemester("LF2025", index);
    expect(trad.matched && trad.semesterName).toBe("Fall 2025");
    expect(trad.matched && trad.program).toBe("TRADITIONAL");
    expect(leap.matched && leap.semesterName).toBe("Fall 2025");
    expect(leap.matched && leap.program).toBe("LEAP");
  });

  it("resolves any historical term, not only the current and previous pair", () => {
    for (const code of ["SP2016", "FA2019", "FA2026"]) expect(resolveSemester(code, index).matched, code).toBe(true);
  });

  it("carries the academic year and the nightly figures", () => {
    const fall = resolveSemester("FA2026", index);
    expect(fall.matched && fall.academicYear).toBe("2026-2027");
    expect(fall.matched && fall.census).toBe(1186);
    expect(fall.matched && fall.financiallyCleared).toBe(1012);
    expect(fall.matched && fall.isCurrent).toBe(true);
  });

  it("reports the never-cleared sentinel and unknown codes separately, and never guesses", () => {
    const never = resolveSemester(NEVER_CLEARED, index);
    expect(never.matched).toBe(false);
    expect(!never.matched && never.reason).toBe("never-cleared");
    const unknown = resolveSemester("ZZ9999", index);
    expect(!unknown.matched && unknown.reason).toBe("unknown");
    expect(semesterLabel("ZZ9999", index)).toBe("ZZ9999 (unknown term)");
    expect(semesterLabel(NEVER_CLEARED, index)).toBe("Never cleared");
    expect(semesterLabel("LF2025", index)).toBe("Fall 2025 (LEAP)");
  });

  it("recognises summer codes for the omission rule (A-23)", () => {
    expect(isSummerCode("SU2025")).toBe(true);
    expect(isSummerCode("SL2025")).toBe(true);
    expect(isSummerCode("SP2025")).toBe(false);
    expect(isSummerCode("FA2025")).toBe(false);
  });
});
