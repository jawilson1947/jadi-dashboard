import { describe, expect, it } from "vitest";
import { canUpdateSemester, SEMESTER_UPDATE_MESSAGES } from "@/server/services/semester-update";
import { QS } from "@/server/repositories/mssql/student-sql";
import { PERMISSIONS, ROLE_PERMISSIONS } from "@/server/authz/permissions";

function executableSql(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

describe("when the Update Semester button appears", () => {
  it("appears for the XX0000 sentinel — what every reclaimed student carries", () => {
    expect(canUpdateSemester("XX0000", "No semester on record")).toBe(true);
    expect(canUpdateSemester(null, "—")).toBe(true);
  });

  it("appears for a stored code that resolves to nothing", () => {
    // Same practical problem: the student sits outside every current-term population.
    expect(canUpdateSemester("FA2019", "FA2019 (unknown term)")).toBe(true);
  });

  it("does NOT appear when the semester already resolves", () => {
    // The button fills a gap; it must not offer to overwrite a good value with a fresh guess.
    expect(canUpdateSemester("FA2026", "Fall 2026")).toBe(false);
    expect(canUpdateSemester("SP2026", "Spring 2026")).toBe(false);
  });
});

describe("outcomes", () => {
  it("has a message for every status, so a redirect never lands on a silent page", () => {
    for (const status of ["updated", "no_registration", "no_student", "invalid_id", "unavailable"] as const) {
      expect(SEMESTER_UPDATE_MESSAGES[status], status).toBeTruthy();
    }
  });

  it("no_registration is phrased as a finding, not a failure", () => {
    // Step 4: the student simply is not registered this term. Saying "error" would send someone
    // looking for a fault that is not there.
    expect(SEMESTER_UPDATE_MESSAGES.no_registration).toMatch(/no current-term registration/i);
    expect(SEMESTER_UPDATE_MESSAGES.no_registration).not.toMatch(/error|failed/i);
  });
});

describe("SQL", () => {
  it("is EXEC only — the app never constructs an UPDATE against dbo", () => {
    expect(QS.updateSemester).toMatch(/^EXEC dbo\.usp_UpdateStudentSemester/);
    expect(QS.updateSemester).not.toMatch(/\bUPDATE\b/i);
  });

  it("binds the id and the actor rather than interpolating them", () => {
    expect(QS.updateSemester).toContain("@Idnumber = @id");
    expect(QS.updateSemester).toContain("@actor = @actor");
  });

  it("uses no construct that needs compatibility level 110+", () => {
    expect(executableSql(QS.updateSemester)).not.toMatch(/\bTRY_(CONVERT|CAST)\b/i);
  });
});

describe("permission", () => {
  it("student.update is distinct from student.create and grantable to operators", () => {
    expect(PERMISSIONS).toContain("student.update");
    expect(ROLE_PERMISSIONS.ADMINISTRATOR).toContain("student.update");
    // Granted to operators by decision (2026-09-30): clearance staff hit this at the counter.
    expect(ROLE_PERMISSIONS.OPERATOR).toContain("student.update");
    // But creating a record stays admin-only — the two acts are deliberately not the same grant.
    expect(ROLE_PERMISSIONS.OPERATOR).not.toContain("student.create");
    expect(ROLE_PERMISSIONS.VIEWER).not.toContain("student.update");
  });
});
