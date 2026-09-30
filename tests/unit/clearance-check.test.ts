import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { canCheckClearance, CLEARANCE_CHECK_MESSAGES } from "@/server/services/clearance-check";
import { QS } from "@/server/repositories/mssql/student-sql";
import { PERMISSIONS, ROLE_PERMISSIONS } from "@/server/authz/permissions";

function executableSql(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

const PROCEDURE = executableSql(readFileSync("db/production/12_usp_check_clearance.sql", "utf8"));

describe("when the Check Clearance button appears", () => {
  it("appears only for a student the record says is NOT cleared", () => {
    expect(canCheckClearance(false)).toBe(true);
  });

  it("does NOT appear for a student already flagged cleared", () => {
    // There is nothing to reconcile, and offering it there invites someone to press it expecting
    // the opposite action — the one the procedure deliberately does not perform.
    expect(canCheckClearance(true)).toBe(false);
  });
});

describe("outcomes", () => {
  it("has a message for every status, so a redirect never lands on a silent page", () => {
    for (const status of ["cleared", "no_clearance_record", "no_student", "invalid_id", "unavailable"] as const) {
      expect(CLEARANCE_CHECK_MESSAGES[status], status).toBeTruthy();
    }
  });

  it("no_clearance_record is phrased as an answer, not a failure", () => {
    // It IS the report: the student is not cleared and the flag was right.
    expect(CLEARANCE_CHECK_MESSAGES.no_clearance_record).toMatch(/no clearance action/i);
    expect(CLEARANCE_CHECK_MESSAGES.no_clearance_record).not.toMatch(/error|failed/i);
    // And it must say the record was left alone, or someone will assume a write happened.
    expect(CLEARANCE_CHECK_MESSAGES.no_clearance_record).toMatch(/unchanged/i);
  });
});

describe("SQL the application sends", () => {
  it("is EXEC only — the app never constructs an UPDATE against dbo", () => {
    expect(QS.checkClearance).toMatch(/^EXEC dbo\.usp_CheckStudentClearance/);
    expect(QS.checkClearance).not.toMatch(/\bUPDATE\b/i);
  });

  it("binds the id and the actor rather than interpolating them", () => {
    expect(QS.checkClearance).toContain("@Idnumber = @id");
    expect(QS.checkClearance).toContain("@actor = @actor");
  });

  it("names no view at all — the read happens inside the procedure", () => {
    // The guardrail in mssql-sql.test.ts bars the slow views from the application's own statements;
    // this keeps that true for the clearance check rather than smuggling a view name past it.
    expect(executableSql(QS.checkClearance)).not.toMatch(/VIEW_OURM/i);
  });
});

describe("the stored procedure (db/production/12_usp_check_clearance.sql)", () => {
  it("reads VIEW_OURM_CLEARED and never VIEW_OURM_STATS", () => {
    // The supplied instruction named STATS; STATS costs 40–120 s (FINDINGS §6) and CLEARED returns
    // the same clearance actions in 0.0 s. A regression here is a button that hangs for a minute.
    expect(PROCEDURE).toMatch(/VIEW_OURM_CLEARED/);
    expect(PROCEDURE).not.toMatch(/VIEW_OURM_STATS/);
  });

  it("never sets ClearedCurrentSession to 0 — it only ever confirms a clearance", () => {
    // The one behaviour that would be unrecoverable from the UI. An empty view is not evidence
    // that a stored clearance was wrong.
    expect(PROCEDURE).not.toMatch(/ClearedCurrentSession\s*=\s*0/i);
    expect(PROCEDURE).toMatch(/ClearedCurrentSession\s*=\s*1/i);
  });

  it("writes lastcleared and ClearedOn alongside the flag (A-22a)", () => {
    // The flag is a flag ON the LastCleared term, so writing it alone against a stale semester
    // would assert a current-term clearance about an older one.
    const update = PROCEDURE.slice(PROCEDURE.search(/UPDATE\s+S\b/i));
    expect(update).toMatch(/S\.lastcleared\s*=/i);
    expect(update).toMatch(/S\.ClearedOn\s*=/i);
  });

  it("touches no table in dbo except tblStudent", () => {
    // The procedure is the whole of the application's write privilege on dbo; anything else it
    // wrote would be a privilege nobody reviewed.
    const writes = [...PROCEDURE.matchAll(/\b(?:UPDATE|INSERT\s+INTO|DELETE\s+FROM)\s+([\w.\[\]]+)/gi)].map((m) => m[1]);
    for (const target of writes) {
      expect(["S", "dash.ClearanceCheck"], `writes to ${target}`).toContain(target);
    }
  });

  it("uses no construct that needs compatibility level 110+ (ousadb runs at 100)", () => {
    expect(PROCEDURE).not.toMatch(/\bTRY_(CONVERT|CAST)\b/i);
    expect(PROCEDURE).not.toMatch(/\bTHROW\b/i);
    expect(PROCEDURE).not.toMatch(/\bOFFSET\b[\s\S]{0,40}\bFETCH\b/i);
    expect(PROCEDURE).not.toMatch(/CREATE\s+OR\s+ALTER/i);
  });

  it("derives lastcleared the same way the semester update does, so the two cannot disagree", () => {
    // Both buttons sit on the same card. If they derived the semester differently, pressing them
    // in a different order would leave a different record.
    expect(PROCEDURE).toMatch(/JADI_LeapName/);
    expect(PROCEDURE).toMatch(/JADI_TradName/);
    expect(PROCEDURE).toMatch(/stud_term_sum_div/);
  });
});

describe("permission", () => {
  it("is gated on student.update — the same grant as the Update Semester button beside it", () => {
    expect(PERMISSIONS).toContain("student.update");
    expect(ROLE_PERMISSIONS.OPERATOR).toContain("student.update");
    expect(ROLE_PERMISSIONS.VIEWER).not.toContain("student.update");
  });
});
