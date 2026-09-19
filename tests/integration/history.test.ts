import { beforeEach, describe, expect, it } from "vitest";
import { MockDataProvider } from "@/server/repositories/mock/provider";
import { MemoryAppStore } from "@/server/store/memory";
import { getHistoryView } from "@/server/services/history";
import { runJob } from "@/server/jobs/runner";

const provider = new MockDataProvider();
let store: MemoryAppStore;
const T0 = new Date("2026-09-18T13:00:00Z");

beforeEach(() => {
  store = new MemoryAppStore();
});

describe("historical analysis (Spec §9)", () => {
  it("receivables by semester reconcile exactly with global receivables", async () => {
    const view = await getHistoryView({}, { provider, store, now: T0 });
    expect(view.balances.value!.positiveTotal).toBeGreaterThan(0);
    expect(view.receivables.value!.total).toBeCloseTo(view.balances.value!.positiveTotal, 2);
    expect(view.reconciles).toBe(true);
  });

  it("never nets credit balances against receivables (A-5)", async () => {
    const view = await getHistoryView({}, { provider, store, now: T0 });
    const b = view.balances.value!;
    expect(b.negativeTotal).toBeGreaterThan(0);
    expect(view.receivables.value!.total).toBeCloseTo(b.positiveTotal, 2);
    expect(view.labels.credits).toBe("Credit balances");
  });

  it("offers the whole record to the trend charts and the picked range to the table", async () => {
    const all = await getHistoryView({}, { provider, store, now: T0 });
    expect(all.series.length).toBeGreaterThan(10);
    expect(all.series.map((p) => p.begins)).toEqual([...all.series.map((p) => p.begins)].sort());
    expect(all.series.every((p) => !p.label.startsWith("Summer"))).toBe(true);

    const ranged = await getHistoryView({ from: "2020-2021", to: "2022-2023" }, { provider, store, now: T0 });
    expect(ranged.enrollment.value!.map((y) => y.academicYear)).toEqual(["2020-2021", "2021-2022", "2022-2023"]);
    // The range picker filters the view, never the captured series.
    expect(ranged.series.length).toBe(all.series.length);
  });

  it("school-year grouping keeps the same total as semester grouping", async () => {
    const bySemester = await getHistoryView({ groupBy: "semester" }, { provider, store, now: T0 });
    const byYear = await getHistoryView({ groupBy: "schoolYear" }, { provider, store, now: T0 });
    expect(byYear.receivables.value!.total).toBeCloseTo(bySemester.receivables.value!.total, 2);
    expect(byYear.receivables.value!.rows.length).toBeLessThan(bySemester.receivables.value!.rows.length);
  });

  it("reads snapshots once the history jobs have run, and the jobs capture raw rows", async () => {
    for (const key of ["history.enrollmentClearance", "history.globalBalances", "history.receivablesBySemester"] as const) {
      const run = await runJob(key, { triggeredBy: "test", store, provider, ignoreMinInterval: true });
      expect(run.status, key).toBe("SUCCEEDED");
    }
    const view = await getHistoryView({}, { provider, store, now: T0 });
    expect(view.enrollment.status).toBe("ok");
    expect(view.enrollment.snapshotId).not.toBeNull();
    expect(view.receivables.snapshotId).not.toBeNull();
    expect(view.reconciles).toBe(true);

    // Receivables are stored as raw per-term rows so a later resolver fix corrects the whole archive.
    const snap = await store.latestSnapshot<Array<{ termKey: string }>>("historyReceivables");
    expect(Array.isArray(snap!.payload)).toBe(true);
    expect(snap!.payload.some((r) => r.termKey === "XX0000")).toBe(true);
  });
});
