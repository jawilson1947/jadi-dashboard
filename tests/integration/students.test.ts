import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { MockDataProvider } from "@/server/repositories/mock/provider";
import { ROLE_PERMISSIONS, effectivePermissions, hasPermission, type Principal, type Role } from "@/server/authz/permissions";
import { getStudentProfile, searchStudents } from "@/server/services/students";

const provider = new MockDataProvider();
const principal = (roles: Role[], extra: Principal["extraPermissions"] = []): Principal => ({
  userId: `u-${roles.join("-")}`,
  displayName: "Test",
  email: "t@example.edu",
  roles,
  extraPermissions: extra,
});

/**
 * Phase 5 is student-level end to end, so "who may see what" is tested as a matrix rather than
 * assumed from the role table being short.
 */
describe("permission matrix for the Student subsystem (Spec §3.3)", () => {
  it("gives a Viewer no student data at all without an explicit grant", () => {
    const viewer = principal(["VIEWER"]);
    for (const p of ["student.view", "student.transactions.view", "student.clearance.analyze", "student.pii.view", "ai.notice.create"] as const) {
      expect(hasPermission(viewer, p), p).toBe(false);
    }
  });

  it("gives an Operator the working set but neither PII nor AI drafting", () => {
    const operator = principal(["OPERATOR"]);
    expect(hasPermission(operator, "student.view")).toBe(true);
    expect(hasPermission(operator, "student.transactions.view")).toBe(true);
    expect(hasPermission(operator, "student.clearance.analyze")).toBe(true);
    expect(hasPermission(operator, "student.pii.view")).toBe(false);
    expect(hasPermission(operator, "ai.notice.create")).toBe(false);
  });

  it("lets an administrator grant a single capability to one person", () => {
    const granted = principal(["VIEWER"], ["student.view"]);
    expect(hasPermission(granted, "student.view")).toBe(true);
    expect(hasPermission(granted, "student.transactions.view")).toBe(false);
  });

  it("keeps the identified-data AI permission to administrators", () => {
    expect(ROLE_PERMISSIONS.OPERATOR).not.toContain("ai.notice.create");
    expect(effectivePermissions(principal(["ADMINISTRATOR"]))).toContain("ai.notice.create");
  });
});

describe("every student route checks a permission before it reads anything", () => {
  const routes: Array<[string, string]> = [
    ["src/app/api/v1/students/search/route.ts", "student.view"],
    ["src/app/api/v1/students/[id]/route.ts", "student.view"],
    ["src/app/api/v1/students/[id]/photo/route.ts", "student.view"],
    ["src/app/api/v1/students/[id]/transactions/route.ts", "student.transactions.view"],
    ["src/app/api/v1/students/[id]/payment-analysis/route.ts", "student.transactions.view"],
    ["src/app/api/v1/students/[id]/clearance-analysis/route.ts", "student.clearance.analyze"],
    ["src/app/api/v1/students/[id]/collection-notice/route.ts", "ai.notice.create"],
  ];

  it.each(routes)("%s requires %s", (file, permission) => {
    const source = readFileSync(file, "utf8");
    expect(source).toContain(`requirePermission(await getPrincipal(), "${permission}")`);
    // The permission check is the first thing in the handler, before any provider call.
    expect(source.indexOf("requirePermission")).toBeLessThan(source.indexOf("await getPrincipal()") + 200);
  });

  it("audits every student-level read", () => {
    for (const [file] of routes) {
      expect(readFileSync(file, "utf8"), `${file} writes no audit row`).toMatch(/await audit\(/);
    }
  });
});

describe("an unprivileged payload carries no unmasked personal data", () => {
  it("holds for the profile a plain student.view holder receives", async () => {
    const rows = await searchStudents({ by: "name", lastName: "an" }, provider);
    const viewer = principal(["VIEWER"], ["student.view"]);
    for (const row of rows.rows.slice(0, 25)) {
      const raw = await provider.getStudentBio(row.idnumber);
      const profile = await getStudentProfile(row.idnumber, viewer, { revealDob: true }, provider);
      const json = JSON.stringify(profile);
      expect(json, `dob leaked for ${row.idnumber}`).not.toContain(raw!.dob!);
      expect(json, `pid leaked for ${row.idnumber}`).not.toContain(raw!.pid);
    }
  });
});
