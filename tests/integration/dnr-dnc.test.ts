import { beforeEach, describe, expect, it } from "vitest";
import { MockDataProvider } from "@/server/repositories/mock/provider";
import { MemoryAppStore } from "@/server/store/memory";
import { getCurrentDashboard } from "@/server/services/dashboard";
import { exportDnrDnc, getDnrDncView, DNR_DNC_EXPORT_COLUMNS } from "@/server/services/dnr-dnc";
import { getMemoryAuditEvents } from "@/server/audit/audit";
import type { Principal } from "@/server/authz/permissions";

const provider = new MockDataProvider();
let store: MemoryAppStore;
const T0 = new Date("2026-09-18T13:00:00Z");
const actor: Principal = { userId: "u-admin", displayName: "Alex Admin", email: "admin@example.edu", roles: ["ADMINISTRATOR"], extraPermissions: [] };

beforeEach(() => {
  store = new MemoryAppStore();
});

describe("DNR/DNC analysis (Spec §8; A-1 definitions)", () => {
  it("summary cards match the dashboard's DNC/DNR figures", async () => {
    const view = await getDnrDncView({}, { provider, store, now: T0 });
    const dash = await getCurrentDashboard({ provider, store, now: T0 });
    const card = dash.dnrDnc.value!;
    expect(view.summary.DNC.count).toBe(card.dnc.count);
    expect(view.summary.DNR.count).toBe(card.dnr.count);
    expect(view.summary.DNC.positiveBalance).toBeCloseTo(card.dnc.positiveBalance, 2);
    expect(view.summary.DNR.positiveBalance).toBeCloseTo(card.dnr.positiveBalance, 2);
  });

  it("every row owes money and belongs to exactly one category", async () => {
    const view = await getDnrDncView({ pageSize: 200 }, { provider, store, now: T0 });
    expect(view.totalRows).toBe(view.summary.DNC.count + view.summary.DNR.count);
    expect(view.rows.every((r) => r.accountBalance > 0)).toBe(true);
    const keys = view.rows.map((r) => `${r.category}-${r.idnumber}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("the footer total is the filtered population's receivable, not the page's", async () => {
    const all = await getDnrDncView({ pageSize: 10 }, { provider, store, now: T0 });
    expect(all.rows).toHaveLength(10);
    expect(all.filteredReceivable).toBeCloseTo(all.summary.DNC.positiveBalance + all.summary.DNR.positiveBalance, 2);

    const dnc = await getDnrDncView({ filter: { category: "DNC" }, pageSize: 10 }, { provider, store, now: T0 });
    expect(dnc.totalRows).toBe(all.summary.DNC.count);
    expect(dnc.filteredReceivable).toBeCloseTo(all.summary.DNC.positiveBalance, 2);
  });

  it("a balance filter narrows both the rows and the total consistently", async () => {
    const view = await getDnrDncView({ filter: { minBalance: 1000 }, pageSize: 200 }, { provider, store, now: T0 });
    expect(view.rows.every((r) => r.accountBalance >= 1000)).toBe(true);
    expect(view.filteredReceivable).toBeCloseTo(
      view.rows.reduce((s, r) => s + r.accountBalance, 0),
      2,
    );
  });

  it("offers only filter options that exist in the population", async () => {
    const view = await getDnrDncView({}, { provider, store, now: T0 });
    for (const c of view.filterOptions.classifications) {
      const filtered = await getDnrDncView({ filter: { classification: c.code }, pageSize: 200 }, { provider, store, now: T0 });
      expect(filtered.totalRows, c.code).toBe(c.count);
    }
    expect(view.filterOptions.lastCleared.every((l) => l.count > 0)).toBe(true);
  });
});

describe("DNR/DNC export (Spec §11; A-11 approved columns)", () => {
  it("exports the filtered rows with the approved header list and no PID", async () => {
    const view = await getDnrDncView({ filter: { category: "DNR" }, pageSize: 200 }, { provider, store, now: T0 });
    const csv = await exportDnrDnc(actor, { filter: { category: "DNR" } }, "cid-1", { provider, store, now: T0 });

    expect(csv.rowCount).toBe(view.totalRows);
    expect(csv.truncated).toBe(false);
    expect(csv.columns).toEqual(DNR_DNC_EXPORT_COLUMNS.map((c) => c.header));
    expect(csv.columns).toHaveLength(11);
    expect(csv.columns.join(" ").toLowerCase()).not.toContain("pid");
    expect(csv.body).not.toContain("•");
    expect(csv.filteredReceivable).toBeCloseTo(view.filteredReceivable, 2);
    expect(csv.filename).toMatch(/^dnr-dnc-FA2026-\d{8}-\d{4}\.csv$/);
    // Header row + one line per student + trailing newline.
    expect(csv.body.trimEnd().split("\r\n")).toHaveLength(view.totalRows + 1);
  });

  it("writes an audit row carrying counts and filters but never the rows themselves", async () => {
    await exportDnrDnc(actor, { filter: { category: "DNC", minBalance: 500 } }, "cid-2", { provider, store, now: T0 });
    const event = getMemoryAuditEvents().filter((e) => e.action === "export.create").at(-1)!;
    expect(event.correlationId).toBe("cid-2");
    expect(event.actorUserId).toBe("u-admin");
    expect(event.metadata).toMatchObject({ kind: "csv", category: "DNC", minBalance: 500 });
    expect(JSON.stringify(event.metadata)).not.toMatch(/@example\.edu/);
  });
});
