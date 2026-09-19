import { describe, expect, it } from "vitest";
import { buildAcademicYears, buildReceivables, buildTermSeries } from "@/server/services/history";
import { buildSemesterIndex } from "@/server/metadata/semesters";
import type { TermMetadata } from "@/server/repositories/types";

function term(p: { name: string; trad: string; leap?: string; begins: string; census?: number | null; cleared?: number | null }): TermMetadata {
  return {
    // Real rows carry LF#### for Fall and LS#### for Spring (FINDINGS §3).
    id: 1, semesterName: p.name, tradName: p.trad, leapName: p.leap ?? `L${p.trad.slice(0, 1)}${p.trad.slice(2)}`, yearCode: p.trad.slice(2),
    semesterBegins: new Date(p.begins), semesterEnds: new Date(p.begins), isCurrent: false, wasCurrent: false,
    census: p.census === undefined ? 100 : p.census, financiallyCleared: p.cleared === undefined ? 80 : p.cleared,
    dropClassesDate: null, worksheetFolder: null,
  };
}

const TERMS = [
  term({ name: "Fall 2024", trad: "FA2024", begins: "2024-06-17", census: 1000, cleared: 900 }),
  term({ name: "Spring 2025", trad: "SP2025", begins: "2025-01-02", census: 950, cleared: 800 }),
  term({ name: "Summer 2025", trad: "SU2025", leap: "SL2025", begins: "2025-05-20", census: 120, cleared: 110 }),
  term({ name: "Fall 2025", trad: "FA2025", begins: "2025-06-17", census: 1100, cleared: 1000 }),
  term({ name: "Spring 2026", trad: "SP2026", begins: "2026-01-02", census: 0, cleared: 0 }),
];

describe("academic-year pairing (Spec §9.1; A-23)", () => {
  it("pairs Fall with the following Spring and omits summer entirely", () => {
    const years = buildAcademicYears(TERMS);
    expect(years.map((y) => y.academicYear)).toEqual(["2024-2025", "2025-2026"]);
    const first = years[0];
    expect(first.fall?.semesterName).toBe("Fall 2024");
    expect(first.spring?.semesterName).toBe("Spring 2025");
    expect(JSON.stringify(years)).not.toContain("Summer");
  });

  it("totals and percentages come from the captured terms only", () => {
    const [first] = buildAcademicYears(TERMS);
    expect(first.totalCensus).toBe(1950);
    expect(first.totalCleared).toBe(1700);
    expect(first.clearedPct).toBeCloseTo((1700 / 1950) * 100, 6);
  });

  it("treats a zero figure as never captured rather than as zero students", () => {
    const [, second] = buildAcademicYears(TERMS);
    expect(second.spring?.captured).toBe(false);
    expect(second.spring?.census).toBeNull();
    expect(second.totalCensus).toBe(1100); // Fall only — the uncaptured Spring is not counted as 0
  });

  it("filters to the requested academic-year range", () => {
    expect(buildAcademicYears(TERMS, { from: "2025-2026" }).map((y) => y.academicYear)).toEqual(["2025-2026"]);
    expect(buildAcademicYears(TERMS, { to: "2024-2025" }).map((y) => y.academicYear)).toEqual(["2024-2025"]);
  });
});

describe("full-record trend series (census and cleared charts)", () => {
  it("runs oldest to newest, skips summer, and leaves uncaptured terms out", () => {
    const series = buildTermSeries(TERMS);
    expect(series.map((p) => p.termKey)).toEqual(["FA2024", "SP2025", "FA2025"]);
    expect(series[0].census).toBe(1000);
    expect(series.at(-1)!.cleared).toBe(1000);
  });
});

describe("receivables by semester (Spec §9.3; A-22, A-23)", () => {
  const index = buildSemesterIndex(TERMS);
  const rows = [
    { termKey: "FA2025", students: 10, positiveBalance: 5000 },
    { termKey: "LF2025", students: 2, positiveBalance: 800 },
    { termKey: "SU2025", students: 3, positiveBalance: 300 },
    { termKey: "XX0000", students: 5, positiveBalance: 1200 },
    { termKey: "ZZ9999", students: 1, positiveBalance: 100 },
  ];

  it("groups matched terms, buckets summer and unmatched codes, and still adds up", () => {
    const view = buildReceivables(rows, index, "semester");
    expect(view.rows.map((r) => r.label)).toEqual(["Fall 2025", "Fall 2025 (LEAP)"]);
    expect(view.excluded).toMatchObject({ students: 3, positiveBalance: 300, terms: ["SU2025"] });
    expect(view.neverCleared).toMatchObject({ students: 5, positiveBalance: 1200 });
    expect(view.unknown).toMatchObject({ students: 1, positiveBalance: 100, terms: ["ZZ9999"] });
    expect(view.total).toBe(7400);
    expect(view.total).toBe(rows.reduce((s, r) => s + r.positiveBalance, 0));
    expect(view.totalStudents).toBe(21);
  });

  it("school-year grouping merges Traditional and LEAP into one row without losing money", () => {
    const view = buildReceivables(rows, index, "schoolYear");
    expect(view.rows).toHaveLength(1);
    expect(view.rows[0].label).toBe("2025-2026");
    expect(view.rows[0].positiveBalance).toBe(5800);
    expect(view.total).toBe(7400);
  });
});
