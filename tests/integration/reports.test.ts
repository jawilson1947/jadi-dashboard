import { beforeEach, describe, expect, it } from "vitest";
import { MockDataProvider } from "@/server/repositories/mock/provider";
import { MemoryAppStore } from "@/server/store/memory";
import { runJob } from "@/server/jobs/runner";
import { snapshotReports, getReportDefinition } from "@/server/reports/definitions";
import {
  getUnclassifiedView,
  getFreshmanView,
  getClearedMoreThanOnceView,
  getEnrolleeBalanceView,
  getCurrentlyClearedView,
  mismatchesAt,
  unclassifiedGroup,
  buildUnclassifiedSummary,
} from "@/server/services/reports";
import { STUDENT_LEVEL_FAMILIES } from "@/server/store/types";

const provider = new MockDataProvider();
let store: MemoryAppStore;
const T0 = new Date("2026-09-29T13:00:00Z");

/**
 * Capture every snapshot-backed report, as the worker would.
 *
 * The job's clock is frozen to the same instant the views are read with. An earlier version froze
 * only the read side, so capturedAt (real now) came out LATER than contactsReadAt (a fixed past
 * time) and the freshness assertion failed against code that was correct.
 */
async function captureAll(s: MemoryAppStore, at: Date = T0) {
  for (const r of snapshotReports()) {
    await runJob(r.jobKey!, { triggeredBy: "test", provider, store: s, ignoreMinInterval: true, now: () => at });
  }
}

beforeEach(async () => {
  store = new MemoryAppStore();
});

describe("report snapshots (A-30)", () => {
  it("captures a population for every snapshot-backed report", async () => {
    await captureAll(store);
    for (const r of snapshotReports()) {
      const snap = await store.latestSnapshot(r.family!);
      expect(snap, r.key).not.toBeNull();
      expect(Array.isArray(snap!.payload), r.key).toBe(true);
    }
  });

  it("stores ids and codes but never a name, email or balance", async () => {
    await captureAll(store);
    for (const r of snapshotReports()) {
      const snap = await store.latestSnapshot<Record<string, unknown>[]>(r.family!);
      for (const row of snap!.payload.slice(0, 20)) {
        const keys = Object.keys(row).map((k) => k.toLowerCase());
        expect(keys, r.key).not.toContain("lastname");
        expect(keys, r.key).not.toContain("firstname");
        expect(keys, r.key).not.toContain("email");
        expect(keys, r.key).not.toContain("accountbalance");
      }
    }
  });

  it("replaces the previous population rather than accumulating it", async () => {
    const def = getReportDefinition("currently-cleared")!;
    await runJob(def.jobKey!, { triggeredBy: "test", provider, store, ignoreMinInterval: true });
    await runJob(def.jobKey!, { triggeredBy: "test", provider, store, ignoreMinInterval: true });
    const kept = await store.latestSnapshotsByTerm(def.family!, 50);
    // Student identifiers must not pile up in dash: one capture per report family survives.
    expect(kept.length).toBe(1);
    expect(STUDENT_LEVEL_FAMILIES).toContain(def.family!);
  });

  it("reports a missing snapshot rather than an empty report", async () => {
    const view = await getCurrentlyClearedView({ provider, store, now: T0 });
    expect(view.meta.missing).toBe(true);
    expect(view.rows).toEqual([]);
  });

  it("joins names and balances live, so they are never as old as the population", async () => {
    await captureAll(store);
    const view = await getCurrentlyClearedView({ provider, store, now: T0 });
    expect(view.rows.length).toBeGreaterThan(0);
    expect(view.rows.every((r) => r.lastName !== "")).toBe(true);
    expect(view.contactsReadAt.getTime()).toBeGreaterThanOrEqual(view.meta.capturedAt!.getTime());
  });
});

describe("R1 — Unclassified Students", () => {
  it("splits the population into resolvable and needs-a-lookup", async () => {
    await captureAll(store);
    const view = await getUnclassifiedView({ provider, store, now: T0 });
    expect(view.totals.resolvable + view.totals.noSignal).toBe(view.totals.students);
  });

  it("treats a code the web group code resolves as resolvable, and anything else as no signal", () => {
    expect(unclassifiedGroup({ idnumber: "1", classCode: "", resolvableAs: "TR", status: "x", source: "enrolled" })).toBe("resolvable");
    expect(unclassifiedGroup({ idnumber: "1", classCode: "PS", resolvableAs: "PS", status: "x", source: "enrolled" })).toBe("no-signal");
    expect(unclassifiedGroup({ idnumber: "1", classCode: "", resolvableAs: "XX", status: "x", source: "enrolled" })).toBe("no-signal");
  });

  it("flags a non-blank code that is not in the mapping table — one fix, however many students", () => {
    const rows = [
      { classCode: "PS", group: "no-signal" as const },
      { classCode: "PS", group: "no-signal" as const },
      { classCode: "", group: "resolvable" as const },
    ] as Parameters<typeof buildUnclassifiedSummary>[0];
    const summary = buildUnclassifiedSummary(rows, ["FR", "SO"]);
    const ps = summary.find((s) => s.code === "PS")!;
    expect(ps.students).toBe(2);
    expect(ps.unknownCode).toBe(true);
    // A blank code is a missing value, not an unrecognised one — different problem, different fix.
    expect(summary.find((s) => s.code === "")!.unknownCode).toBe(false);
  });

  it("the summary's student counts add up to the table", async () => {
    await captureAll(store);
    const view = await getUnclassifiedView({ provider, store, now: T0 });
    expect(view.summary.reduce((t, s) => t + s.students, 0)).toBe(view.totals.students);
  });
});

describe("R2 — Freshman Classification Analysis", () => {
  it("counts a mismatch as cCode <> the derived class (R-D7)", async () => {
    await captureAll(store);
    const view = await getFreshmanView({ provider, store, now: T0 });
    const manual = view.rows.filter((r) => r.classCode.toUpperCase() !== r.derivedClass).length;
    expect(view.mismatches).toBe(manual);
  });

  it("covers the current AND previous semester, each with its own boundary (R-D2a)", async () => {
    await captureAll(store);
    const view = await getFreshmanView({ provider, store, now: T0 });
    expect(view.terms.length).toBe(2);
    expect(view.terms[0].isCurrentTerm).toBe(true);
    expect(view.terms[1].isCurrentTerm).toBe(false);
    // Two terms, two different SemesterBegins — that is the whole reason the panels are per-term.
    const begins = view.terms.map((t) => t.semesterBegins?.getTime());
    expect(begins[0]).not.toBe(begins[1]);
    // The groups partition the population; nothing is dropped or double-counted.
    expect(view.terms.reduce((t, g) => t + g.students, 0)).toBe(view.rows.length);
    expect(view.terms.reduce((t, g) => t + g.mismatches, 0)).toBe(view.mismatches);
  });

  it("prices each term's candidate boundaries against that term's students only", async () => {
    await captureAll(store);
    const view = await getFreshmanView({ provider, store, now: T0 });
    for (const term of view.terms) {
      expect(term.whatIf.length).toBeGreaterThan(0);
      const current = term.whatIf.find((w) => w.date === term.semesterBegins!.toISOString().slice(0, 10));
      // At the term's real start date the what-if must reproduce that term's count, not the total.
      expect(current!.mismatches).toBe(term.mismatches);
    }
  });

  it("a boundary before every record makes every FF correct and every FR wrong", () => {
    const base = { webCode: null, mostRecentYearEnrolled: null, semesterName: "Fall 2026", isCurrentTerm: true, semesterBegins: null };
    const rows = [
      { ...base, idnumber: "1", classCode: "FF", dateCreated: new Date("2026-08-20"), derivedClass: "FF" as const, mismatch: false, currentClassCode: "FF" },
      { ...base, idnumber: "2", classCode: "FR", dateCreated: new Date("2026-08-21"), derivedClass: "FR" as const, mismatch: false, currentClassCode: "FR" },
    ];
    // Everything created after the boundary derives FF, so the FR record is the only mismatch.
    expect(mismatchesAt(rows, new Date("2026-01-01"))).toBe(1);
    // Everything created before it derives FR, so the FF record is the only mismatch.
    expect(mismatchesAt(rows, new Date("2026-12-31"))).toBe(1);
  });

  it("buckets record creation by week and marks the week holding each term's boundary", async () => {
    await captureAll(store);
    const view = await getFreshmanView({ provider, store, now: T0 });
    for (const term of view.terms) {
      expect(term.buckets.length).toBeGreaterThan(0);
      expect(term.buckets.filter((b) => b.containsBoundary).length).toBeLessThanOrEqual(1);
      expect(term.buckets.reduce((t, b) => t + b.mismatches, 0)).toBe(term.mismatches);
    }
  });
});

describe("R3 — Cleared More Than Once", () => {
  it("groups actions under their student and keeps each action's own date and operator", async () => {
    await captureAll(store);
    const view = await getClearedMoreThanOnceView({ provider, store, now: T0 });
    for (const g of view.groups) {
      expect(g.actions.length).toBeGreaterThan(1);
      expect(g.actions.map((a) => a.actionNo)).toEqual(g.actions.map((_, i) => i + 1));
    }
    expect(view.totals.actions).toBe(view.groups.reduce((t, g) => t + g.actions.length, 0));
  });
});

describe("R4 — Enrollee Account Balance", () => {
  it("filters the captured population by the live balance, and the total matches the rows", async () => {
    await captureAll(store);
    const all = await getEnrolleeBalanceView({ min: 0.01, max: Number.MAX_SAFE_INTEGER }, { provider, store, now: T0 });
    expect(all.rows.length).toBeGreaterThan(0);
    const sum = all.rows.reduce((t, r) => t + r.accountBalance, 0);
    expect(all.totals.debitBalance).toBeCloseTo(Math.round(sum * 100) / 100, 2);
  });

  it("a narrower range returns a subset, and the population size does not change", async () => {
    await captureAll(store);
    const wide = await getEnrolleeBalanceView({ min: 0.01, max: Number.MAX_SAFE_INTEGER }, { provider, store, now: T0 });
    const narrow = await getEnrolleeBalanceView({ min: 0.01, max: 100 }, { provider, store, now: T0 });
    expect(narrow.rows.length).toBeLessThanOrEqual(wide.rows.length);
    expect(narrow.populationSize).toBe(wide.populationSize);
    expect(narrow.rows.every((r) => r.accountBalance <= 100)).toBe(true);
  });
});

describe("R6 — Currently Cleared", () => {
  it("returns one row per student and the classification counts add up", async () => {
    await captureAll(store);
    const view = await getCurrentlyClearedView({ provider, store, now: T0 });
    expect(new Set(view.rows.map((r) => r.idnumber)).size).toBe(view.rows.length);
    expect(view.byClassification.reduce((t, c) => t + c.students, 0)).toBe(view.totals.students);
  });

  it("is stable across refreshes — the same student keeps the same clearance date", async () => {
    await captureAll(store);
    const first = await getCurrentlyClearedView({ provider, store, now: T0 });
    await captureAll(store);
    const second = await getCurrentlyClearedView({ provider, store, now: T0 });
    const a = new Map(first.rows.map((r) => [r.idnumber, r.dateCleared?.toISOString() ?? null]));
    for (const r of second.rows) expect(a.get(r.idnumber)).toBe(r.dateCleared?.toISOString() ?? null);
  });
});
