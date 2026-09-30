import { describe, expect, it } from "vitest";
import { normalizeId, buildArtifacts, buildProposed, describeGaps } from "@/server/services/reclaim";
import { QS } from "@/server/repositories/mssql/student-sql";
import { PERMISSIONS, ROLE_PERMISSIONS } from "@/server/authz/permissions";
import type { ReclaimDiagnostic } from "@/server/repositories/types";
import type { ReclaimedStudentRecord } from "@/server/store/types";

/**
 * Strip SQL comments before matching. A guardrail that scans raw text will happily flag the comment
 * explaining why a construct is absent — which is exactly what happened here, twice: once on an
 * ORDER BY and once on a comment reading "No TRY_CONVERT: ...". The rule is about executable SQL,
 * so the assertion has to look at executable SQL.
 */
function executableSql(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

const base: ReclaimDiagnostic = {
  idnumber: "123456",
  inTblStudent: false,
  hasStudentMaster: true,
  hasNameRecord: true,
  hasBiograph: true,
  addressRows: 1,
  qualifyingAddressRows: 1,
  addressCodes: "LHP",
  proposed: { lastName: "WILSON", firstName: "JAMES", middleName: "", email: "jw@example.edu", city: "Huntsville", stateCode: "AL" },
};

describe("id normalisation", () => {
  it("treats a padded id and its bare form as the same student", () => {
    // student_master.ID_NUM is numeric, tblStudent.idnumber is varchar. Without this, a padded id
    // reads as "not in Jenzabar" for a student who is plainly there.
    expect(normalizeId("0123456")).toBe("123456");
    expect(normalizeId(" 123456 ")).toBe("123456");
  });

  it("rejects anything that is not a plain number", () => {
    for (const bad of ["", "abc", "12-34", "12 34", "1e5", "-1"]) expect(normalizeId(bad), bad).toBeNull();
  });
});

describe("artifacts", () => {
  it("names the address codes when an address exists under a code the loader ignores", () => {
    // This is the finding that points at the loader's WHERE clause rather than at the student.
    const d = { ...base, qualifyingAddressRows: 0, addressRows: 2, addressCodes: "PRM, BIL" };
    const address = buildArtifacts(d).find((a) => a.key === "address_master")!;
    expect(address.found).toBe(false);
    expect(address.detail).toContain("PRM, BIL");
    expect(address.detail).toContain("LHP");
  });

  it("distinguishes no qualifying address from no address at all", () => {
    const none = buildArtifacts({ ...base, addressRows: 0, qualifyingAddressRows: 0, addressCodes: null });
    expect(none.find((a) => a.key === "address_master")!.detail).toBe("no address rows at all");
  });

  it("reports every artifact the loader inner-joins", () => {
    expect(buildArtifacts(base).map((a) => a.key)).toEqual(["student_master", "name_master", "biograph_master", "address_master"]);
  });
});

describe("proposed values", () => {
  it("offers the real email, not the batch script's placeholder (S-D3)", () => {
    const email = buildProposed(base).find((f) => f.label === "Email")!;
    expect(email.value).toBe("jw@example.edu");
    expect(email.value).not.toBe("none@oakwood.edu");
  });

  it("marks a field missing when its source record is absent", () => {
    const fields = buildProposed({ ...base, hasBiograph: false, qualifyingAddressRows: 0 });
    expect(fields.find((f) => f.label === "Date of birth, SSN, gender")!.missing).toBe(true);
    expect(fields.find((f) => f.label === "Address")!.missing).toBe(true);
    // The defaults the loader always writes are never "missing" — they are chosen values.
    expect(fields.find((f) => f.label === "Balance")!.missing).toBe(false);
    expect(fields.find((f) => f.label === "Classification")!.value).toBe("NA");
  });
});

describe("incomplete-record banner", () => {
  const rec: ReclaimedStudentRecord = {
    idnumber: "123456", reclaimedAt: new Date(), reclaimedBy: "a@b.c",
    hadNameRecord: true, hadBiograph: true, hadQualifyingAddress: true,
    source: "procedure", resolvedAt: null, resolvedBy: null,
  };

  it("says nothing when the record was complete", () => {
    expect(describeGaps(rec)).toBeNull();
  });

  it("names each gap when it was not", () => {
    const text = describeGaps({ ...rec, hadBiograph: false, hadQualifyingAddress: false })!;
    expect(text).toContain("date of birth");
    expect(text).toContain("address");
  });
});

describe("SQL guardrails", () => {
  it("the diagnostic is read-only and parameterised", () => {
    expect(executableSql(QS.reclaimDiagnostic)).not.toMatch(/\b(INSERT|UPDATE|DELETE|MERGE|DROP|ALTER)\b/i);
    expect(QS.reclaimDiagnostic).toContain("@id");
  });

  it("the write is EXEC only — the app never constructs an INSERT against dbo (S-D1)", () => {
    // The whole safety argument is that the application has no INSERT privilege and does not need
    // one. An INSERT statement appearing here would mean that argument had quietly stopped holding.
    expect(QS.reclaimExecute).toMatch(/^EXEC dbo\.usp_ReclaimStudentFromJenzabar/);
    expect(QS.reclaimExecute).not.toMatch(/\bINSERT\b/i);
  });

  it("compares the id numerically, as the nightly loader's EXCEPT does", () => {
    expect(QS.reclaimDiagnostic).toContain("CAST(@clean AS numeric(18,0))");
    expect(QS.reclaimDiagnostic).toContain("CAST(LTRIM(RTRIM(idnumber)) AS numeric(18,0))");
  });

  it("uses no construct that needs compatibility level 110+", () => {
    // TRY_CONVERT and TRY_CAST fail on this database with "'numeric' is not a recognized built-in
    // function name", because below level 110 the parser reads them as user functions. The
    // procedure hit this on first install; this stops the app's own SQL regressing the same way.
    for (const [key, sql] of Object.entries(QS)) {
      if (typeof sql !== "string") continue;
      expect(executableSql(sql), `${key} uses TRY_CONVERT`).not.toMatch(/\bTRY_(CONVERT|CAST)\b/i);
    }
  });
});

describe("permission", () => {
  it("student.create exists and is held by no role but ADMINISTRATOR", () => {
    expect(PERMISSIONS).toContain("student.create");
    expect(ROLE_PERMISSIONS.ADMINISTRATOR).toContain("student.create");
    expect(ROLE_PERMISSIONS.OPERATOR).not.toContain("student.create");
    expect(ROLE_PERMISSIONS.VIEWER).not.toContain("student.create");
  });
});
