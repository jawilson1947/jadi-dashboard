import { describe, expect, it } from "vitest";
import { addDays, dayOfSprint, daysBetween, eachDate, formatIsoDate, isIsoDate, toIsoDate, todayIso } from "@/lib/dates";

describe("calendar-date helpers (ASSUMPTIONS A-10, A-15)", () => {
  it("validates real calendar dates only", () => {
    expect(isIsoDate("2026-08-14")).toBe(true);
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("8/14/2026")).toBe(false);
  });

  it("converts an instant to the institution's calendar date, not the server's", () => {
    // 02:30 UTC on 15 Aug is still 21:30 on 14 Aug in Chicago — the sprint day must be the 14th.
    const instant = new Date("2026-08-15T02:30:00Z");
    expect(toIsoDate(instant, "America/Chicago")).toBe("2026-08-14");
    expect(toIsoDate(instant, "UTC")).toBe("2026-08-15");
    expect(todayIso("America/Chicago", instant)).toBe("2026-08-14");
  });

  it("walks and measures windows inclusively", () => {
    expect(eachDate("2026-08-13", "2026-08-16")).toEqual(["2026-08-13", "2026-08-14", "2026-08-15", "2026-08-16"]);
    expect(eachDate("2026-08-16", "2026-08-13")).toEqual([]);
    expect(daysBetween("2026-08-13", "2026-08-16")).toBe(3);
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
  });

  it("crosses a DST change without losing or repeating a day", () => {
    // US DST ends 1 Nov 2026; a naive local-time walk would produce 25- or 23-hour days.
    const days = eachDate("2026-10-31", "2026-11-02");
    expect(days).toEqual(["2026-10-31", "2026-11-01", "2026-11-02"]);
  });

  it("numbers days of the sprint from 1 and refuses dates outside the window", () => {
    expect(dayOfSprint("2026-06-17", "2026-06-17", "2026-08-28")).toBe(1);
    expect(dayOfSprint("2026-06-30", "2026-06-17", "2026-08-28")).toBe(14);
    expect(dayOfSprint("2026-06-16", "2026-06-17", "2026-08-28")).toBeNull();
  });

  it("formats a calendar date without shifting it back a day", () => {
    expect(formatIsoDate("2026-08-14")).toBe("Aug 14, 2026");
    expect(formatIsoDate(null)).toBe("—");
  });
});
