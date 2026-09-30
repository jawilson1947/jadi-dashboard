import { describe, expect, it } from "vitest";
import { MockDataProvider } from "@/server/repositories/mock/provider";
import { updateStudentSemester } from "@/server/services/semester-update";
import { getMemoryAuditEvents } from "@/server/audit/audit";
import type { Principal } from "@/server/authz/permissions";

const provider = new MockDataProvider();
const actor: Principal = {
  userId: "u-op", displayName: "Olive Operator", email: "op@example.edu",
  roles: ["OPERATOR"], extraPermissions: [],
};

/** The mock returns no_registration for ids ending 7 and updates everything else it knows. */
async function anyStudent(endingIn7: boolean): Promise<string> {
  const ids = (await provider.getCurrentlyClearedPopulation()).map((r) => r.idnumber);
  const id = ids.find((i) => i.endsWith("7") === endingIn7);
  if (!id) throw new Error("fixture has no suitable id");
  return id;
}

describe("setting a semester from the Jenzabar registration (A-33)", () => {
  it("writes a value taken from the term metadata, so it always resolves", async () => {
    const id = await anyStudent(false);
    const r = await updateStudentSemester(actor, id, "c1", { provider });
    expect(r.status).toBe("updated");
    // The whole point of deriving from JADI_TradName rather than concatenating a Jenzabar term
    // code: the value written must be one the app can resolve back to a semester.
    const terms = await provider.getTermMetadata();
    const current = terms.find((t) => t.isCurrent)!;
    expect([current.tradName, current.leapName]).toContain(r.lastCleared);
  });

  it("reports no_registration as a finding, and asks the card to relabel", async () => {
    const id = await anyStudent(true);
    const r = await updateStudentSemester(actor, id, "c2", { provider });
    expect(r.status).toBe("no_registration");
    expect(r.lastCleared).toBeNull();
    // Step 4: this is what flips "No semester on record" to "No Semester Info found".
    expect(r.noInfoFound).toBe(true);
  });

  it("rejects an id that is not a student number without touching the provider", async () => {
    const r = await updateStudentSemester(actor, "not-an-id", "c3", { provider });
    expect(r.status).toBe("invalid_id");
    expect(r.noInfoFound).toBe(false);
  });

  it("reports a student the table no longer holds", async () => {
    const r = await updateStudentSemester(actor, "999999999", "c4", { provider });
    expect(r.status).toBe("no_student");
  });

  it("audits the semester it wrote, not merely that it wrote something", async () => {
    const id = await anyStudent(false);
    await updateStudentSemester(actor, id, "c5", { provider });
    const event = getMemoryAuditEvents().filter((e) => e.action === "student.semester_update").at(-1)!;
    expect(event.targetId).toBe(id);
    // This change moves a student into current-term populations, so "which semester" is the part
    // someone will need when they come back to ask why a figure moved.
    expect(event.metadata).toHaveProperty("lastCleared");
    expect(event.metadata).toMatchObject({ outcome: "updated" });
  });
});
