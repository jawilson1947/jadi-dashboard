import { describe, expect, it } from "vitest";
import { buildBenchmarks, buildDaySeries, buildOperatorRows } from "@/server/services/sprint";
import type { OperatorProfileRecord } from "@/server/store/types";
import type { TermMetadata } from "@/server/repositories/types";

const WINDOW = { start: "2026-08-10", end: "2026-08-14" };

describe("sprint day series (Spec §7.1)", () => {
  it("zero-fills quiet days and carries the running total", () => {
    const rows = buildDaySeries([{ date: "2026-08-10", cleared: 12 }, { date: "2026-08-13", cleared: 5 }], WINDOW, "2026-08-13");
    expect(rows.map((r) => r.cleared)).toEqual([12, 0, 0, 5, 0]);
    expect(rows.map((r) => r.cumulative)).toEqual([12, 12, 12, 17, 17]);
    expect(rows.map((r) => r.dayOfSprint)).toEqual([1, 2, 3, 4, 5]);
  });

  it("marks today and flags days that have not happened yet", () => {
    const rows = buildDaySeries([], WINDOW, "2026-08-12");
    expect(rows.filter((r) => r.isToday).map((r) => r.date)).toEqual(["2026-08-12"]);
    expect(rows.filter((r) => r.isFuture).map((r) => r.date)).toEqual(["2026-08-13", "2026-08-14"]);
  });

  it("ignores counts outside the window rather than smearing them into it", () => {
    const rows = buildDaySeries([{ date: "2026-08-01", cleared: 99 }], WINDOW, "2026-08-14");
    expect(rows.reduce((s, r) => s + r.cleared, 0)).toBe(0);
  });
});

describe("sprint operator rows (Spec §7.2)", () => {
  const profiles: OperatorProfileRecord[] = [
    { id: "1", sourceCode: "HSMITH", displayName: "H. Smith", email: null, department: null, isActive: true, isSystem: false, effectiveFrom: null, effectiveTo: null, updatedAt: new Date(), updatedBy: null },
  ];

  it("resolves names, computes share, and sorts by volume", () => {
    const rows = buildOperatorRows(
      [
        { operatorCode: "HSMITH", cleared: 30, firstAt: "2026-08-10T13:00:00Z", lastAt: "2026-08-14T20:00:00Z" },
        { operatorCode: "sa", cleared: 60, firstAt: null, lastAt: null },
        { operatorCode: "ZZ9", cleared: 10, firstAt: null, lastAt: null },
      ],
      profiles,
      100,
    );
    expect(rows.map((r) => r.displayName)).toEqual(["Automatic clearance (sa)", "H. Smith", "Unmapped (ZZ9)"]);
    expect(rows[0].sharePct).toBe(60);
    expect(rows.find((r) => r.code === "ZZ9")!.mapped).toBe(false);
  });

  it("reports share as N/A rather than 0 when nothing has been cleared", () => {
    const rows = buildOperatorRows([{ operatorCode: "HSMITH", cleared: 0, firstAt: null, lastAt: null }], profiles, 0);
    expect(rows[0].sharePct).toBeNull();
  });
});

describe("prior-semester benchmarks (Spec §7.4; A-2 nightly figures)", () => {
  function term(p: Partial<TermMetadata> & { semesterName: string; tradName: string; begins: string }): TermMetadata {
    return {
      id: 1, semesterName: p.semesterName, tradName: p.tradName, leapName: `L${p.tradName.slice(1)}`, yearCode: p.tradName.slice(2),
      semesterBegins: new Date(p.begins), semesterEnds: new Date(p.begins), isCurrent: p.isCurrent ?? false, wasCurrent: false,
      census: p.census ?? null, financiallyCleared: p.financiallyCleared ?? null, dropClassesDate: null, worksheetFolder: null,
    };
  }
  const current = term({ semesterName: "Fall 2026", tradName: "FA2026", begins: "2026-06-17", isCurrent: true, census: 1186, financiallyCleared: 1012 });
  const all = [
    current,
    term({ semesterName: "Fall 2025", tradName: "FA2025", begins: "2025-06-17", census: 1250, financiallyCleared: 1100 }),
    term({ semesterName: "Fall 2024", tradName: "FA2024", begins: "2024-06-17", census: 1300, financiallyCleared: 1150 }),
    term({ semesterName: "Fall 2023", tradName: "FA2023", begins: "2023-06-17", census: 1350, financiallyCleared: 1200 }),
    term({ semesterName: "Fall 2022", tradName: "FA2022", begins: "2022-06-17", census: 1400, financiallyCleared: 1250 }),
    term({ semesterName: "Spring 2026", tradName: "SP2026", begins: "2026-01-02", census: 1150, financiallyCleared: 1000 }),
    term({ semesterName: "Fall 2021", tradName: "FA2021", begins: "2021-06-17", census: 1450, financiallyCleared: null }),
  ];

  it("offers same-season prior semesters only, newest first, and never the current term", () => {
    const rows = buildBenchmarks(all, current, 500);
    expect(rows.map((r) => r.termKey)).toEqual(["FA2025", "FA2024", "FA2023"]);
  });

  it("skips semesters with no captured nightly figure rather than showing zero", () => {
    expect(buildBenchmarks(all, current, 500, 10).map((r) => r.termKey)).not.toContain("FA2021");
  });

  it("expresses this sprint against each benchmark and the benchmark against its own census", () => {
    const [fa2025] = buildBenchmarks(all, current, 550);
    expect(fa2025.financiallyCleared).toBe(1100);
    expect(fa2025.currentVsBenchmarkPct).toBeCloseTo(50, 6);
    expect(fa2025.clearedPctOfCensus).toBeCloseTo((1100 / 1250) * 100, 6);
  });
});
