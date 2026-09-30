import { beforeEach, describe, expect, it } from "vitest";
import { MockDataProvider } from "@/server/repositories/mock/provider";
import { MemoryAppStore } from "@/server/store/memory";
import { getReclaimView, reclaimStudent, describeGaps, RECLAIM_MESSAGES } from "@/server/services/reclaim";
import { getMemoryAuditEvents } from "@/server/audit/audit";
import type { Principal } from "@/server/authz/permissions";

const provider = new MockDataProvider();
let store: MemoryAppStore;
const T0 = new Date("2026-09-29T13:00:00Z");
const admin: Principal = {
  userId: "u-admin", displayName: "Alex Admin", email: "admin@example.edu",
  roles: ["ADMINISTRATOR"], extraPermissions: [],
};

/**
 * Ids that are NOT in the synthetic dataset. The fixture numbers its students from 100000 upward,
 * so the obvious-looking constants 100000 and 100003 are real students — an earlier version used
 * exactly those and every reclaim came back "already_exists", which looked like six code failures
 * and was one test-data collision. Picked above the fixture's range instead, and asserted below.
 *
 * The mock provider derives the gap shape from id % 4: 0 = complete, 3 = no biograph and no
 * qualifying address.
 */
const WITH_GAPS = "900003";
const COMPLETE = "900000";
const NOT_IN_JENZABAR = "12";  // fewer than four digits — the mock's stand-in for "not in Jenzabar"

beforeEach(() => {
  store = new MemoryAppStore();
});

describe("test fixtures", () => {
  it("uses ids the synthetic dataset does not already contain", async () => {
    // Guards the collision that made six real-looking failures out of one mistake.
    const existing = new Set((await provider.getCurrentlyClearedPopulation()).map((r) => r.idnumber));
    for (const id of [WITH_GAPS, COMPLETE]) expect(existing.has(id), `${id} collides with the fixture`).toBe(false);
    expect((await provider.getReclaimDiagnostic(WITH_GAPS)).inTblStudent).toBe(false);
    expect((await provider.getReclaimDiagnostic(COMPLETE)).inTblStudent).toBe(false);
  });
});

describe("the three-way not-found card (§3)", () => {
  it("distinguishes an id Jenzabar does not know from one it does", async () => {
    // A mistyped id and a genuinely skipped student look identical today; only one has a fix.
    expect((await getReclaimView(NOT_IN_JENZABAR, { provider, store })).kind).toBe("not-in-jenzabar");
    expect((await getReclaimView(COMPLETE, { provider, store })).kind).toBe("reclaimable");
  });

  it("points at the existing profile when the record is there but the search missed it", async () => {
    // tblStudent stores idnumber as text and the diagnostic compares it numerically, so a padded
    // record is missed by the search and found here. Offering to create them would be wrong.
    const existing = (await provider.getCurrentlyClearedPopulation())[0].idnumber;
    const view = await getReclaimView(existing, { provider, store });
    expect(view.kind).toBe("already-present");
    expect(view.blocked).toBe(false);
  });

  it("treats a malformed id as an ordinary miss, with no diagnostic", async () => {
    const view = await getReclaimView("not-an-id", { provider, store });
    expect(view.kind).toBe("no-match");
    expect(view.diagnostic).toBeNull();
  });

  it("reports the gaps that caused the student to be skipped", async () => {
    const view = await getReclaimView(WITH_GAPS, { provider, store });
    expect(view.hasGaps).toBe(true);
    expect(view.artifacts.filter((a) => !a.found).length).toBeGreaterThan(0);
  });
});

describe("the reclaim itself", () => {
  it("refuses an incomplete record unless the caller opted in (S-D2)", async () => {
    const refused = await reclaimStudent(admin, WITH_GAPS, false, "c1", { provider, store, now: T0 });
    expect(refused.outcome).toBe("partial_not_allowed");
    expect(refused.landOnProfile).toBe(false);

    const allowed = await reclaimStudent(admin, WITH_GAPS, true, "c2", { provider, store, now: T0 });
    expect(allowed.outcome).toBe("inserted");
    expect(allowed.landOnProfile).toBe(true);
  });

  it("inserts a complete record without needing the partial opt-in", async () => {
    const r = await reclaimStudent(admin, COMPLETE, false, "c3", { provider, store, now: T0 });
    expect(r.outcome).toBe("inserted");
  });

  it("refuses when Jenzabar has no record at all", async () => {
    const r = await reclaimStudent(admin, NOT_IN_JENZABAR, true, "c4", { provider, store, now: T0 });
    expect(r.outcome).toBe("not_in_jenzabar");
    expect(r.landOnProfile).toBe(false);
  });

  it("treats a student someone else just created as success, not an error", async () => {
    // Two operators clicking at once must not produce a confusing failure for the second one.
    const existing = (await provider.getCurrentlyClearedPopulation())[0].idnumber;
    const r = await reclaimStudent(admin, existing, false, "c5", { provider, store, now: T0 });
    expect(r.outcome).toBe("already_exists");
    expect(r.landOnProfile).toBe(true);
  });

  it("audits every attempt with the artifacts, and never the record itself", async () => {
    await reclaimStudent(admin, WITH_GAPS, true, "c6", { provider, store, now: T0 });
    const event = getMemoryAuditEvents().filter((e) => e.action === "student.reclaim").at(-1)!;
    expect(event.targetId).toBe(WITH_GAPS);
    expect(event.metadata).toMatchObject({ outcome: "inserted", allowPartial: true });
    // The audit row explains the STATE of the record it created, not merely that one was created.
    expect(event.metadata).toHaveProperty("hadBiograph");
    expect(event.metadata).toHaveProperty("hadQualifyingAddress");
    expect(JSON.stringify(event.metadata)).not.toMatch(/SYNTHETIC|example\.edu/);
  });
});

describe("what the caller is told to do next", () => {
  it("sends a successful reclaim to the profile, and a refusal back to the lookup", async () => {
    // landOnProfile is what the route turns into a 303. Getting this wrong is not cosmetic: the
    // first real reclaim created the record and then rendered the raw JSON response, because the
    // route answered a plain HTML form post with JSON instead of a redirect.
    const ok = await reclaimStudent(admin, COMPLETE, false, "n1", { provider, store, now: T0 });
    expect(ok.outcome).toBe("inserted");
    expect(ok.landOnProfile).toBe(true);

    const refused = await reclaimStudent(admin, WITH_GAPS, false, "n2", { provider, store, now: T0 });
    expect(refused.landOnProfile).toBe(false);
    expect(refused.message).toBeTruthy();
  });

  it("has a message for every outcome, so a redirect never lands on a silent page", () => {
    for (const outcome of ["inserted", "already_exists", "not_in_jenzabar", "no_name_record", "partial_not_allowed", "invalid_id", "unavailable"] as const) {
      expect(RECLAIM_MESSAGES[outcome], outcome).toBeTruthy();
    }
  });
});

describe("the incomplete-record flag", () => {
  it("records the gaps so the banner survives the redirect", async () => {
    await reclaimStudent(admin, WITH_GAPS, true, "c7", { provider, store, now: T0 });
    const rec = await store.getReclaimedStudent(WITH_GAPS);
    expect(rec).not.toBeNull();
    expect(describeGaps(rec!)).toContain("date of birth");
  });

  it("leaves no flag on a student nobody reclaimed", async () => {
    expect(await store.getReclaimedStudent("999999")).toBeNull();
  });

  it("lists open reclaims as a follow-up worklist", async () => {
    await reclaimStudent(admin, WITH_GAPS, true, "c8", { provider, store, now: T0 });
    const open = await store.listReclaimedStudents(true);
    expect(open.map((r) => r.idnumber)).toContain(WITH_GAPS);
  });
});
