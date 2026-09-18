import { describe, expect, it } from "vitest";
import { BREAKDOWN_CLASSES, breakdownCode, buildBreakdown } from "@/server/metadata/clearance-breakdown";

describe("Clearance Breakdown rules (Spec §7.3, docs/validation-sql/clearance_by_classification.sql)", () => {
  it("maps codes exactly as the source query's CASE expressions", () => {
    expect(breakdownCode("FF", false)).toBe("FR");
    expect(breakdownCode("FR", false)).toBe("FR");
    expect(breakdownCode("fr ", false)).toBe("FR");
    expect(breakdownCode("", false)).toBe("XX");
    expect(breakdownCode(null, false)).toBe("XX");
    expect(breakdownCode("SO", true)).toBe("TR"); // Incoming Transfer wins over the class code
    expect(breakdownCode("GR", false)).toBe("GR");
  });

  it("emits the fixed class list in SortOrder followed by a Total row", () => {
    const rows = buildBreakdown(new Map(), new Map());
    expect(rows.map((r) => r.cCode)).toEqual([...BREAKDOWN_CLASSES.map((c) => c.cCode), ""]);
    expect(rows.at(-1)).toMatchObject({ className: "Total", isTotal: true, enrolled: 0, cleared: 0, notCleared: 0, clearedPercent: null });
    expect(BREAKDOWN_CLASSES.map((c) => c.sortOrder)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it("computes NotCleared, % (DECIMAL(6,2)) and Total like ReportData/FinalReport", () => {
    const enrolled = new Map([["FR", 300], ["SO", 200], ["TR", 7]]);
    const cleared = new Map([["FR", 250], ["SO", 199], ["TR", 0]]);
    const rows = buildBreakdown(enrolled, cleared);
    const fr = rows.find((r) => r.cCode === "FR")!;
    expect(fr).toMatchObject({ enrolled: 300, cleared: 250, notCleared: 50, clearedPercent: 83.33 });
    expect(rows.find((r) => r.cCode === "SO")!.clearedPercent).toBe(99.5);
    expect(rows.find((r) => r.cCode === "TR")!.clearedPercent).toBe(0);
    expect(rows.find((r) => r.cCode === "GR")!.clearedPercent).toBeNull(); // source prints 0% for 0/0
    const total = rows.at(-1)!;
    expect(total).toMatchObject({ enrolled: 507, cleared: 449, notCleared: 58, clearedPercent: 88.56 });
  });

  it("ignores codes outside the fixed list, as the source LEFT JOIN from ClassCodes does", () => {
    const rows = buildBreakdown(new Map([["ZZ", 5], ["FR", 1]]), new Map([["ZZ", 5]]));
    expect(rows.some((r) => r.cCode === "ZZ")).toBe(false);
    expect(rows.at(-1)!.enrolled).toBe(1);
  });
});
