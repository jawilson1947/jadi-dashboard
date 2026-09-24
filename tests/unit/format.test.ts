import { describe, expect, it } from "vitest";
import { formatCount, formatCurrency, formatPercent, maskPid, parseCompactDate } from "@/lib/format";

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

describe("ClearedOn is a varchar column, so it holds more than one shape (Bio Spec 1.3)", () => {
  it("reads the documented YYYYMMDD form", () => {
    expect(parseCompactDate("20260715")).toBe("2026-07-15");
    expect(parseCompactDate("  20260715  ")).toBe("2026-07-15");
  });

  it("reads the run-together timestamp staging actually holds", () => {
    // tblStudent.ClearedOn on idnumber 181083, confirmed 2026-09-24: YYYYMMDDhhmmss.fff, no separators.
    expect(parseCompactDate("20260806110107.143")).toBe("2026-08-06");
    expect(parseCompactDate("20260806110107")).toBe("2026-08-06");
    expect(parseCompactDate("202608061101")).toBe("2026-08-06");
  });

  it("reads the other forms a free-text date column collects", () => {
    expect(parseCompactDate("2026-07-15")).toBe("2026-07-15");
    expect(parseCompactDate("2026/07/15")).toBe("2026-07-15");
    expect(parseCompactDate("07/15/2026")).toBe("2026-07-15");
    expect(parseCompactDate("7/15/2026")).toBe("2026-07-15");
    expect(parseCompactDate("2026-07-15 14:32:00")).toBe("2026-07-15");
    expect(parseCompactDate("2026-07-15T14:32:00")).toBe("2026-07-15");
  });

  it("returns null for empty and for genuine nonsense, so the caller can show the raw text", () => {
    expect(parseCompactDate(null)).toBeNull();
    expect(parseCompactDate("")).toBeNull();
    expect(parseCompactDate("   ")).toBeNull();
    expect(parseCompactDate("N/A")).toBeNull();
    expect(parseCompactDate("00000000")).toBeNull();
  });

  it("rejects a date that does not exist rather than silently rolling it over", () => {
    expect(parseCompactDate("20260231")).toBeNull();
    expect(parseCompactDate("20261301")).toBeNull();
  });
});
