import { beforeEach, describe, expect, it } from "vitest";
import { MockDataProvider } from "@/server/repositories/mock/provider";
import { MemoryAppStore } from "@/server/store/memory";
import { getCurrentDashboard, getDrillDown, refreshClearanceBreakdown } from "@/server/services/dashboard";
import { runJob } from "@/server/jobs/runner";
import { withOverrides } from "../helpers/provider";

const provider = new MockDataProvider();
let store: MemoryAppStore;
const T0 = new Date("2026-09-17T13:00:00Z");

beforeEach(() => {
  store = new MemoryAppStore();
});

describe("current dashboard (A-1, A-2 definitions; Spec §6, §21.2–3)", () => {
  it("hero figures follow A-2 and reconcile via the cleared-not-enrolled line", async () => {
    const dash = await getCurrentDashboard({ provider, store, now: T0 });
    const hero = dash.heroCard.value!;
    expect(hero.enrolled).toBe(1188);
    expect(hero.notCleared).toBe(192);
    expect(hero.cleared).toBe(996 + 25);
    expect(hero.clearedNotEnrolled).toBe(25);
    // Cleared + NotCleared − clearedNotEnrolled === Enrolled
    expect(hero.cleared + hero.notCleared - hero.clearedNotEnrolled).toBe(hero.enrolled);
    expect(hero.clearedPct).toBeCloseTo((hero.cleared / hero.enrolled) * 100, 6);
    expect(hero.nightly).toEqual({ census: 1186, financiallyCleared: 1012 });
  });

  it("drill-down totals match the card figures under the same definitions", async () => {
    const dash = await getCurrentDashboard({ provider, store, now: T0 });
    const hero = dash.heroCard.value!;
    for (const [population, expected] of [["enrolled", hero.enrolled], ["cleared", hero.cleared], ["notCleared", hero.notCleared]] as const) {
      const page = await getDrillDown(population, { page: 1, pageSize: 10 }, provider);
      expect(page.totalRows).toBe(expected);
    }
    const recv = await getDrillDown("receivable", { page: 1, pageSize: 10 }, provider);
    expect(recv.totalRows).toBe(dash.receivable.value!.studentCount);
    expect(recv.rows.every((r) => r.accountBalance > 0)).toBe(true);
  });

  it("DNC/DNR are positive-balance populations (A-1) and DNR excludes current enrollment", async () => {
    const dash = await getCurrentDashboard({ provider, store, now: T0 });
    const dd = dash.dnrDnc.value!;
    expect(dd.dnc.count).toBe(73);
    expect(dd.dnr.count).toBe(111);
    expect(dd.dnrGuardViolations).toBe(0);
    const dnr = await getDrillDown("dnr", { page: 1, pageSize: 200 }, provider);
    expect(dnr.totalRows).toBe(111);
    expect(dnr.rows.every((r) => !r.enrolledCurrentTerm && r.accountBalance > 0 && r.status === "Cleared")).toBe(true);
    const dnc = await getDrillDown("dnc", { page: 1, pageSize: 200 }, provider);
    expect(dnc.rows.every((r) => r.accountBalance > 0 && r.status === "Not Cleared")).toBe(true);
  });

  it("masks PID and resolves classification including the Incoming Transfer override (A-3, A-19)", async () => {
    const page = await getDrillDown("enrolled", { page: 1, pageSize: 400 }, provider);
    expect(page.rows[0].pidMasked).toMatch(/^•••••\d{4}$/);
    expect(page.rows.some((r) => r.classification === "Transfer Student" && r.classificationCode !== "TR")).toBe(true);
    expect(page.rows.some((r) => r.classification === "Freshmen")).toBe(true);
  });

  it("prefers snapshots over live reads and reports staleness from the snapshot age", async () => {
    await runJob("dashboard.enrollmentClearance", { triggeredBy: "test", store, provider, now: () => T0, owner: "t" });
    const fresh = await getCurrentDashboard({ provider, store, now: new Date(T0.getTime() + 10 * 60_000) });
    expect(fresh.heroCard.status).toBe("ok");
    expect(fresh.heroCard.snapshotId).not.toBeNull();
    const later = await getCurrentDashboard({ provider, store, now: new Date(T0.getTime() + 4 * 3600_000) });
    expect(later.heroCard.status).toBe("stale");
    expect(later.source.anyStale).toBe(true);
  });

  it("computes change since the prior snapshot", async () => {
    await runJob("dashboard.enrollmentClearance", { triggeredBy: "test", store, provider, now: () => T0, owner: "t", ignoreMinInterval: true });
    const bumped = withOverrides(provider, { getEnrollmentClearance: async () => ({ ...(await provider.getEnrollmentClearance()), cleared: 1030, enrolled: 1190 }) });
    const T1 = new Date(T0.getTime() + 3600_000);
    await runJob("dashboard.enrollmentClearance", { triggeredBy: "test", store, provider: bumped, now: () => T1, owner: "t", ignoreMinInterval: true });
    const dash = await getCurrentDashboard({ provider, store, now: T1 });
    expect(dash.heroCard.value!.changeSincePrior).toMatchObject({ cleared: 1030 - 1021, enrolled: 2 });
  });

  it("a failed metric reports failed with a null value — never zero — and does not blank the others", async () => {
    const failing = withOverrides(provider, { getCurrentReceivable: async () => { throw new Error("boom"); } });
    const dash = await getCurrentDashboard({ provider: failing, store, now: T0 });
    expect(dash.receivable.status).toBe("failed");
    expect(dash.receivable.value).toBeNull();
    expect(dash.heroCard.status).toBe("ok");
  });

  it("reports pending (not zero) when the real provider has no snapshot yet", async () => {
    const mssqlLike = withOverrides(provider, { name: "mssql" });
    const dash = await getCurrentDashboard({ provider: mssqlLike, store, now: T0 });
    expect(dash.heroCard.status).toBe("pending");
    expect(dash.heroCard.value).toBeNull();
  });
});

describe("Clearance Breakdown card (Spec §7.3)", () => {
  it("Total row equals the hero card's enrolled and cleared figures", async () => {
    const dash = await getCurrentDashboard({ provider, store, now: T0 });
    const rows = dash.clearanceBreakdown.value!;
    const total = rows.at(-1)!;
    expect(total.isTotal).toBe(true);
    expect(total.enrolled).toBe(dash.heroCard.value!.enrolled);
    expect(total.cleared).toBe(dash.heroCard.value!.cleared);
    expect(rows.filter((r) => !r.isTotal)).toHaveLength(12);
    expect(rows.find((r) => r.cCode === "TR")!.enrolled).toBeGreaterThan(0);
  });

  it("runs the job on screen load when the snapshot is missing or older than the threshold, otherwise reuses it", async () => {
    expect(await store.latestSnapshot("clearanceBreakdown")).toBeNull();
    const first = await getCurrentDashboard({ provider, store, now: T0, autoRefresh: ["clearanceBreakdown"], autoRefreshAfterMinutes: 15 });
    const snap1 = await store.latestSnapshot("clearanceBreakdown");
    expect(snap1).not.toBeNull();
    expect(first.clearanceBreakdown.snapshotId).toBe(snap1!.id);
    expect((await store.listRuns("dashboard.clearanceBreakdown", 5))[0]).toMatchObject({ triggeredBy: "page-load", status: "SUCCEEDED" });

    // 10 minutes later: fresh enough, no new run
    await getCurrentDashboard({ provider, store, now: new Date(T0.getTime() + 10 * 60_000), autoRefresh: ["clearanceBreakdown"], autoRefreshAfterMinutes: 15 });
    expect(await store.listRuns("dashboard.clearanceBreakdown", 5)).toHaveLength(1);

    // 16 minutes later: refreshed again
    const later = await getCurrentDashboard({ provider, store, now: new Date(T0.getTime() + 16 * 60_000), autoRefresh: ["clearanceBreakdown"], autoRefreshAfterMinutes: 15 });
    expect(await store.listRuns("dashboard.clearanceBreakdown", 5)).toHaveLength(2);
    expect(later.clearanceBreakdown.snapshotId).not.toBe(snap1!.id);
  });

  it("Refresh runs through the audited pipeline as manual:<user> and is not blocked by the minimum interval", async () => {
    await runJob("dashboard.clearanceBreakdown", { triggeredBy: "schedule", store, provider, now: () => T0 });
    const run = await refreshClearanceBreakdown({ userId: "viewer-1", email: "v@example.edu", displayName: "Viewer", role: "VIEWER" } as never, "corr-1", { store, provider });
    expect(run.status).toBe("SUCCEEDED");
    expect(run.triggeredBy).toBe("manual:viewer-1");
    expect(await store.listRuns("dashboard.clearanceBreakdown", 5)).toHaveLength(2);
  });
});
