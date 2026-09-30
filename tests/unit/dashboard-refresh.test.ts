import { describe, expect, it } from "vitest";
import { DASHBOARD_REFRESH_JOBS, isDashboardRefreshJob } from "@/server/services/dashboard-refresh";
import { JOB_DEFINITIONS } from "@/server/jobs/definitions";

/**
 * The page Refresh button re-runs source queries on demand, so what it may run is a security
 * boundary as much as a correctness one.
 */
describe("what the dashboard Refresh button runs", () => {
  it("names only jobs that exist", () => {
    const known = new Set(JOB_DEFINITIONS.map((d) => d.key));
    for (const j of DASHBOARD_REFRESH_JOBS) expect(known.has(j.key as never), j.key).toBe(true);
  });

  it("covers every dashboard.* job and nothing else", () => {
    // If a sixth card lands on the page, this fails until its job is added — which is the point:
    // a Refresh that silently misses a card is worse than no Refresh.
    const dashboardJobs = JOB_DEFINITIONS.map((d) => d.key).filter((k) => k.startsWith("dashboard."));
    expect([...DASHBOARD_REFRESH_JOBS.map((j) => j.key)].sort()).toEqual([...dashboardJobs].sort());
  });

  it("refuses any job that does not back this page", () => {
    // The route uses this guard. Without it, dashboard.view would let a viewer start ANY scheduled
    // job from the browser, including ones whose figures they are not permitted to see.
    expect(isDashboardRefreshJob("history.globalBalances")).toBe(false);
    expect(isDashboardRefreshJob("report.unclassified")).toBe(false);
    expect(isDashboardRefreshJob("")).toBe(false);
    expect(isDashboardRefreshJob("dashboard.currentReceivable")).toBe(true);
  });

  it("gives every job a human label, since the button names what it is running", () => {
    // The invariant is "not the raw job key", not "contains no full stop" — the first version of
    // this test used the dot as a proxy and fired on the legitimate label "Enrolled vs. cleared".
    for (const j of DASHBOARD_REFRESH_JOBS) {
      expect(j.label.length, j.key).toBeGreaterThan(0);
      expect(j.label, j.key).not.toBe(j.key);
      expect(j.label, j.key).not.toMatch(/^dashboard\./);
    }
    // And the labels must be distinct, or the progress text names the wrong card.
    expect(new Set(DASHBOARD_REFRESH_JOBS.map((j) => j.label)).size).toBe(DASHBOARD_REFRESH_JOBS.length);
  });

  it("puts the slowest job last so the hero figures move first", () => {
    // Ordering is a stated UI decision, not an accident of how the list was typed.
    expect(DASHBOARD_REFRESH_JOBS.at(-1)!.key).toBe("dashboard.clearanceBreakdown");
    expect(DASHBOARD_REFRESH_JOBS[0].key).toBe("dashboard.enrollmentClearance");
  });
});
