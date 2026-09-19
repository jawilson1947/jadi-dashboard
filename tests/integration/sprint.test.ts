import { beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { MockDataProvider } from "@/server/repositories/mock/provider";
import { MemoryAppStore } from "@/server/store/memory";
import { getSprintDrillDown, getSprintView, type SprintSnapshotPayload } from "@/server/services/sprint";
import { getCurrentDashboard } from "@/server/services/dashboard";
import { runJob } from "@/server/jobs/runner";

const provider = new MockDataProvider();
let store: MemoryAppStore;
/** The synthetic clearance actions run from 2026-07-06 for ~50 days (mock/synthetic.ts). */
const WINDOW = { start: "2026-07-06", end: "2026-08-31" };
const T0 = new Date("2026-08-20T13:00:00Z");

beforeEach(async () => {
  store = new MemoryAppStore();
});

describe("clearance sprint window (ASSUMPTIONS A-10)", () => {
  it("reports an unset window instead of assuming one", async () => {
    const view = await getSprintView({ provider, store, now: T0 });
    expect(view.window).toBeNull();
    expect(view.metric.status).toBe("pending");
    expect(view.byDate).toEqual([]);
    expect(view.metric.error).toMatch(/Sprint dates have not been set/);
  });

  it("captures nothing from the source until an administrator sets the dates", async () => {
    const run = await runJob("sprint.daily", { triggeredBy: "test", store, provider, ignoreMinInterval: true });
    expect(run.status).toBe("SUCCEEDED");
    const snap = await store.latestSnapshot<SprintSnapshotPayload>("sprintDaily");
    expect(snap?.payload.window).toBeNull();
    expect(snap?.payload.byDate).toEqual([]);
  });

  it("re-captures when the window changes, so rows always describe the stored dates", async () => {
    await store.setSprintWindow("FA2026", WINDOW.start, WINDOW.end, "u1");
    const first = await getSprintView({ provider, store, now: T0 });
    expect(first.metric.value!.window).toEqual(WINDOW);

    await store.setSprintWindow("FA2026", "2026-08-01", "2026-08-31", "u1");
    const second = await getSprintView({ provider, store, now: T0 });
    expect(second.metric.value!.window).toEqual({ start: "2026-08-01", end: "2026-08-31" });
    expect(second.totals.cleared).toBeLessThan(first.totals.cleared);
  });
});

describe("sprint view (Spec §7.1–7.3)", () => {
  beforeEach(async () => {
    await store.setSprintWindow("FA2026", WINDOW.start, WINDOW.end, "u1");
  });

  it("covers every day of the window and the running total ends at the sprint total", async () => {
    const view = await getSprintView({ provider, store, now: T0 });
    expect(view.byDate).toHaveLength(57); // 6 Jul – 31 Aug inclusive
    expect(view.byDate[0].date).toBe(WINDOW.start);
    expect(view.byDate.at(-1)!.date).toBe(WINDOW.end);
    expect(view.byDate.at(-1)!.cumulative).toBe(view.totals.cleared);
    expect(view.byDate.reduce((s, r) => s + r.cleared, 0)).toBe(view.totals.cleared);
  });

  it("counts each student once, so the sprint total reconciles with the dashboard's Cleared figure", async () => {
    const view = await getSprintView({ provider, store, now: T0 });
    const dash = await getCurrentDashboard({ provider, store, now: T0 });
    // Every synthetic clearance action falls inside this window, so the two must agree exactly.
    expect(view.totals.cleared).toBe(dash.heroCard.value!.cleared);
  });

  it("splits the same total across operators and classifications", async () => {
    const view = await getSprintView({ provider, store, now: T0 });
    expect(view.byOperator.reduce((s, r) => s + r.cleared, 0)).toBe(view.totals.cleared);
    const total = view.byClassification.find((r) => r.isTotal)!;
    expect(total.cleared).toBe(view.totals.cleared);
    expect(total.notCleared).toBe(total.enrolled - total.cleared);
  });

  it("scopes classification counts to the window: enrolled stays term-wide, cleared shrinks", async () => {
    const wide = await getSprintView({ provider, store, now: T0 });
    await store.setSprintWindow("FA2026", "2026-08-01", "2026-08-31", "u1");
    const narrow = await getSprintView({ provider, store, now: T0 });
    const wideTotal = wide.byClassification.find((r) => r.isTotal)!;
    const narrowTotal = narrow.byClassification.find((r) => r.isTotal)!;
    expect(narrowTotal.enrolled).toBe(wideTotal.enrolled);
    expect(narrowTotal.cleared).toBeLessThan(wideTotal.cleared);
  });

  it("marks unmapped operator codes and resolves the ones with a profile", async () => {
    const before = await getSprintView({ provider, store, now: T0 });
    const target = before.byOperator.find((r) => !r.mapped && r.code !== "")!;
    expect(target.displayName).toBe(`Unmapped (${target.code})`);

    await store.upsertOperatorProfile({
      id: randomUUID(), sourceCode: target.code, displayName: "Named Person", email: null, department: null,
      isActive: true, isSystem: false, effectiveFrom: null, effectiveTo: null, updatedAt: new Date(), updatedBy: "u1",
    });
    const after = await getSprintView({ provider, store, now: T0 });
    const row = after.byOperator.find((r) => r.code === target.code)!;
    expect(row.displayName).toBe("Named Person");
    expect(row.mapped).toBe(true);
  });
});

describe("sprint drill-downs (Spec §7 drill-down)", () => {
  beforeEach(async () => {
    await store.setSprintWindow("FA2026", WINDOW.start, WINDOW.end, "u1");
  });

  it("a day's row count matches the students listed for that day", async () => {
    const view = await getSprintView({ provider, store, now: T0 });
    const busiest = [...view.byDate].sort((a, b) => b.cleared - a.cleared)[0];
    const page = await getSprintDrillDown({ range: WINDOW, date: busiest.date }, { page: 1, pageSize: 10 }, { provider, store });
    expect(page.totalRows).toBe(busiest.cleared);
    expect(page.rows.every((r) => r.clearedOn === busiest.date)).toBe(true);
    expect(page.rows.every((r) => r.pidMasked.startsWith("•"))).toBe(true);
  });

  it("an operator's row count matches the students listed for that operator", async () => {
    const view = await getSprintView({ provider, store, now: T0 });
    const op = view.byOperator[0];
    const page = await getSprintDrillDown({ range: WINDOW, operatorCode: op.code }, { page: 1, pageSize: 5 }, { provider, store });
    expect(page.totalRows).toBe(op.cleared);
    expect(page.rows.every((r) => r.operatorCode === op.code)).toBe(true);
  });

  it("a classification's row count matches its cleared figure", async () => {
    const view = await getSprintView({ provider, store, now: T0 });
    const cls = view.byClassification.filter((r) => !r.isTotal && r.cleared > 0)[0];
    const page = await getSprintDrillDown({ range: WINDOW, classificationCode: cls.cCode }, { page: 1, pageSize: 5 }, { provider, store });
    expect(page.totalRows).toBe(cls.cleared);
  });
});

describe("prior-semester comparison (Spec §7.4)", () => {
  it("benchmarks prior Fall semesters from the nightly figures even with no archived sprint", async () => {
    await store.setSprintWindow("FA2026", WINDOW.start, WINDOW.end, "u1");
    const view = await getSprintView({ provider, store, now: T0 });
    expect(view.comparison).toEqual([]);
    expect(view.benchmarks.map((b) => b.termKey)).toEqual(["FA2025", "FA2024", "FA2023"]);
    expect(view.benchmarks.every((b) => b.financiallyCleared > 0)).toBe(true);
    expect(view.benchmarks.every((b) => !b.label.startsWith("Spring"))).toBe(true);
    const first = view.benchmarks[0];
    expect(first.currentVsBenchmarkPct).toBeCloseTo((view.totals.cleared / first.financiallyCleared) * 100, 6);
  });

  it("is empty until a prior sprint has been archived, then aligns on day of sprint", async () => {
    await store.setSprintWindow("FA2026", WINDOW.start, WINDOW.end, "u1");
    const empty = await getSprintView({ provider, store, now: T0 });
    expect(empty.comparison).toEqual([]);

    const prior: SprintSnapshotPayload = {
      termKey: "FA2025",
      termLabel: "Fall 2025",
      window: { start: "2025-07-07", end: "2025-07-10" },
      byDate: [{ date: "2025-07-07", cleared: 4 }, { date: "2025-07-09", cleared: 6 }],
      byOperator: [],
      byClassification: [],
      totalCleared: 10,
    };
    await store.saveSnapshot({ id: randomUUID(), jobRunId: randomUUID(), metricFamily: "sprintDaily", termKey: "FA2025", capturedAt: new Date("2025-07-10T12:00:00Z"), sourceProvider: "mock", payload: prior, rowCount: 10 });

    const view = await getSprintView({ provider, store, now: T0, autoRefreshAfterMinutes: 0 });
    expect(view.comparison).toHaveLength(1);
    const series = view.comparison[0];
    expect(series.termKey).toBe("FA2025");
    expect(series.points).toEqual([
      { dayOfSprint: 1, cumulative: 4 },
      { dayOfSprint: 2, cumulative: 4 },
      { dayOfSprint: 3, cumulative: 10 },
      { dayOfSprint: 4, cumulative: 10 },
    ]);
    expect(view.currentSeries!.termKey).toBe("FA2026");
  });
});
