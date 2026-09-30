import { describe, expect, it } from "vitest";
import { MockDataProvider } from "@/server/repositories/mock/provider";
import { checkStudentClearance } from "@/server/services/clearance-check";
import { getMemoryAuditEvents } from "@/server/audit/audit";
import type { Principal } from "@/server/authz/permissions";

const provider = new MockDataProvider();
const actor: Principal = {
  userId: "u-op", displayName: "Olive Operator", email: "op@example.edu",
  roles: ["OPERATOR"], extraPermissions: [],
};

/** A student the mock's VIEW_OURM_CLEARED stand-in holds a clearance action for. */
async function clearedStudent(): Promise<string> {
  const rows = await provider.getCurrentlyClearedPopulation();
  if (rows.length === 0) throw new Error("fixture has no cleared student");
  return rows[0].idnumber;
}

/** A student with no clearance action this term — the notCleared drill-down is exactly that set. */
async function unclearedStudent(): Promise<string> {
  const page = await provider.getStudentsForPopulation("notCleared", { page: 1, pageSize: 20 });
  const id = page.rows.find((r) => r.clearedBy === null)?.idnumber;
  if (!id) throw new Error("fixture has no uncleared student");
  return id;
}

describe("confirming clearance from the source actions (A-34)", () => {
  it("writes the semester and the clearance date alongside the flag", async () => {
    const id = await clearedStudent();
    const r = await checkStudentClearance(actor, id, "c1", { provider });
    expect(r.status).toBe("cleared");
    // Per A-22a the flag is a flag ON the LastCleared term, so a semester the app can resolve has
    // to be written with it, or the card claims a current-term clearance about an older semester.
    const terms = await provider.getTermMetadata();
    const current = terms.find((t) => t.isCurrent)!;
    expect([current.tradName, current.leapName]).toContain(r.lastCleared);
    // ClearedOn is varchar YYYYMMDD on tblStudent, not an ISO date.
    expect(r.clearedOn).toMatch(/^\d{8}$/);
  });

  it("reports a student with no clearance action, and writes nothing", async () => {
    const id = await unclearedStudent();
    const r = await checkStudentClearance(actor, id, "c2", { provider });
    expect(r.status).toBe("no_clearance_record");
    expect(r.lastCleared).toBeNull();
    expect(r.clearedOn).toBeNull();
    expect(r.message).toMatch(/unchanged/i);
  });

  it("rejects an id that is not a student number without touching the provider", async () => {
    const r = await checkStudentClearance(actor, "not-an-id", "c3", { provider });
    expect(r.status).toBe("invalid_id");
  });

  it("reports a student the table no longer holds", async () => {
    const r = await checkStudentClearance(actor, "999999999", "c4", { provider });
    expect(r.status).toBe("no_student");
  });

  it("audits the no-write outcome too, not only the write", async () => {
    // "Someone asked whether this student was cleared and the answer was no" is what explains a
    // balance staying in the collection population. Auditing only the writes loses that.
    const id = await unclearedStudent();
    await checkStudentClearance(actor, id, "c5", { provider });
    const event = getMemoryAuditEvents().filter((e) => e.action === "student.clearance_check").at(-1)!;
    expect(event.targetId).toBe(id);
    expect(event.metadata).toMatchObject({ outcome: "no_clearance_record", rowsUpdated: 0 });
  });

  it("records the source operator separately from the dashboard user", async () => {
    const id = await clearedStudent();
    await checkStudentClearance(actor, id, "c6", { provider });
    const event = getMemoryAuditEvents().filter((e) => e.action === "student.clearance_check").at(-1)!;
    // Who cleared them in the billing system, and who pressed the button here, answer different
    // questions — the audit row keeps both.
    expect(event.metadata).toHaveProperty("sourceClearedBy");
    expect(event.actorEmail ?? actor.email).toBe(actor.email);
  });
});
