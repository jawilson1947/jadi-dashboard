import { describe, expect, it } from "vitest";
import { MockDataProvider } from "@/server/repositories/mock/provider";
import { MemoryAppStore } from "@/server/store/memory";
import { ensureJobsSeeded, runJob, safeSummary } from "@/server/jobs/runner";
import { JOB_DEFINITIONS } from "@/server/jobs/definitions";
import { withOverrides } from "../helpers/provider";

const provider = new MockDataProvider();
const T0 = new Date("2026-09-17T13:00:00Z");
const clock = (ms = 0) => () => new Date(T0.getTime() + ms);

describe("snapshot job pipeline (Spec §9.4, §14.6)", () => {
  it("seeds every job definition once and never overwrites edited schedules", async () => {
    const store = new MemoryAppStore();
    await ensureJobsSeeded(store);
    expect((await store.listJobs()).map((j) => j.key).sort()).toEqual(JOB_DEFINITIONS.map((j) => j.key).sort());
    const job = (await store.getJob("dashboard.dnrDnc"))!;
    await store.upsertJob({ ...job, cronExpression: "*/7 * * * *" });
    await ensureJobsSeeded(store);
    expect((await store.getJob("dashboard.dnrDnc"))!.cronExpression).toBe("*/7 * * * *");
  });

  it("a successful run records RUNNING→SUCCEEDED, saves a snapshot with the term key, and unlocks", async () => {
    const store = new MemoryAppStore();
    const run = await runJob("dashboard.enrollmentClearance", { triggeredBy: "test", store, provider, now: clock(), owner: "w1" });
    expect(run.status).toBe("SUCCEEDED");
    expect(run.rowsProcessed).toBe(1188);
    const snap = await store.latestSnapshot<{ enrolled: number }>("enrollmentClearance");
    expect(snap?.payload.enrolled).toBe(1188);
    expect(snap?.termKey).toBe("FA2026");
    expect(snap?.sourceProvider).toBe("mock");
    expect((await store.getJob("dashboard.enrollmentClearance"))!.lockedAt).toBeNull();
  });

  it("a failing provider records FAILED with a safe summary and leaves no snapshot", async () => {
    const store = new MemoryAppStore();
    const failing = withOverrides(provider, { getDnrDncSummary: async () => { throw new Error("Login failed for user 'x'; Server=secret-host;Password=hunter2"); } });
    const run = await runJob("dashboard.dnrDnc", { triggeredBy: "test", store, provider: failing, now: clock(), owner: "w1" });
    expect(run.status).toBe("FAILED");
    expect(run.errorSummary).not.toContain("hunter2");
    expect(run.errorSummary).not.toContain("secret-host");
    expect(await store.latestSnapshot("dnrDnc")).toBeNull();
    expect((await store.getJob("dashboard.dnrDnc"))!.lockedAt).toBeNull();
  });

  it("a second worker is skipped while the job is locked (no overlapping executions)", async () => {
    const store = new MemoryAppStore();
    await ensureJobsSeeded(store);
    expect(await store.tryLockJob("dashboard.currentReceivable", "w1", T0, 30 * 60_000)).toBe(true);
    const run = await runJob("dashboard.currentReceivable", { triggeredBy: "schedule", store, provider, now: clock(1000), owner: "w2" });
    expect(run.status).toBe("SKIPPED_OVERLAP");
    // stale lock (crashed worker) can be taken over
    const late = await runJob("dashboard.currentReceivable", { triggeredBy: "schedule", store, provider, now: clock(31 * 60_000), owner: "w2" });
    expect(late.status).toBe("SUCCEEDED");
  });

  it("enforces the safe minimum interval for scheduled runs but not for manual ones", async () => {
    const store = new MemoryAppStore();
    const first = await runJob("dashboard.chargesCredits", { triggeredBy: "schedule", store, provider, now: clock(), owner: "w1" });
    expect(first.status).toBe("SUCCEEDED");
    const tooSoon = await runJob("dashboard.chargesCredits", { triggeredBy: "schedule", store, provider, now: clock(60_000), owner: "w1" });
    expect(tooSoon.status).toBe("SKIPPED_OVERLAP");
    const manual = await runJob("dashboard.chargesCredits", { triggeredBy: "manual:u-admin", store, provider, now: clock(120_000), owner: "w1", ignoreMinInterval: true });
    expect(manual.status).toBe("SUCCEEDED");
  });

  it("safeSummary redacts credentials and hosts", () => {
    expect(safeSummary(new Error("Server=db01;Password=abc;Database=x"))).toBe("Error: Server=***;Password=***;Database=x");
  });
});
