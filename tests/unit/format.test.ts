import { describe, expect, it } from "vitest";
import { formatCount, formatCurrency, formatPercent, maskPid } from "@/lib/format";

describe("presentation formatting (Spec §5)", () => {
  it("formats USD, thousands separators and 2-decimal percentages", () => {
    expect(formatCurrency(1284512.333)).toBe("$1,284,512.33");
    expect(formatCount(2431)).toBe("2,431");
    expect(formatPercent(78.4039)).toBe("78.40%");
  });
  it("never renders a missing value as zero", () => {
    expect(formatCurrency(null)).toBe("—");
    expect(formatCount(undefined)).toBe("—");
    expect(formatPercent(null)).toBe("N/A");
  });
  it("masks PID to last four", () => {
    expect(maskPid("700123456")).toBe("•••••3456");
  });
});
