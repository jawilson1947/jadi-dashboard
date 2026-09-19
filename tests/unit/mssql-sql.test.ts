import { describe, expect, it } from "vitest";
import { Q, SAFE_STUDENT_COLUMNS } from "@/server/repositories/mssql/sql";

const FORBIDDEN = ["SSN", "dob", "gender", "BankAccount", "PIN", "VIEW_OURM_ACAD", "172.18", "JICSSQL", "TMSEPRD"];
const sprintWhere = Object.values(Q.sprintWhere);
const allSql = [
  Q.terms, Q.nightlyFigures, Q.enrollmentClearance, Q.currentReceivable, Q.chargesCredits, Q.dnrDncSummary, Q.classificationCounts,
  ...Object.values(Q.populationWhere).map((w) => Q.studentPage(w, "S.lastname", "ASC")),
  ...Object.values(Q.populationWhere).map((w) => Q.studentCount(w)),
  // Sprint statements are always sent as prelude + body + epilogue, so the guardrails see the whole batch.
  `${Q.sprintPrelude()}${Q.clearanceByDate}${Q.sprintEpilogue()}`,
  `${Q.sprintPrelude()}${Q.clearanceByOperator}${Q.sprintEpilogue()}`,
  `${Q.sprintPrelude(true)}${Q.classificationCountsInRange}${Q.sprintEpilogue(true)}`,
  ...sprintWhere.map((w) => `${Q.sprintPrelude(true)}${Q.sprintStudentPage(w, "S.lastname", "ASC")}${Q.sprintEpilogue(true)}`),
  ...sprintWhere.map((w) => `${Q.sprintPrelude(true)}${Q.sprintStudentCount(w)}${Q.sprintEpilogue(true)}`),
];

describe("mssql SQL guardrails (Spec §15, §18; FINDINGS §2, §6, §7)", () => {
  it("never references sensitive columns, the academic view, or linked servers", () => {
    for (const s of allSql) for (const f of FORBIDDEN) expect(s, `contains ${f}`).not.toMatch(new RegExp(`\\b${f.replace(".", "\\.")}\\b`, "i"));
  });
  it("never queries the slow views VIEW_OURM_FCA / VIEW_OURM_STATS (40–120 s per query)", () => {
    for (const s of allSql) expect(s).not.toMatch(/dbo\.VIEW_OURM_(FCA|STATS)\b/i);
  });
  it("is read-only except for its own #temp tables", () => {
    for (const s of allSql) {
      expect(s).not.toMatch(/\b(INSERT|UPDATE|DELETE|MERGE|ALTER|EXEC)\b/i);
      for (const m of s.matchAll(/\b(DROP TABLE|CREATE\s+(?:UNIQUE\s+)?CLUSTERED INDEX \w+ ON|INTO)\s+(\S+)/gi)) expect(m[2].startsWith("#"), m[0]).toBe(true);
    }
  });
  it("selects only whitelisted tblStudent columns in the student pages", () => {
    for (const page of [Q.studentPage(Q.populationWhere.enrolled, "S.lastname", "ASC"), Q.sprintStudentPage(Q.sprintWhere.all, "S.lastname", "ASC")]) {
      const selected = [...page.matchAll(/\bS\.([A-Za-z_]+)/g)].map((m) => m[1]);
      for (const col of selected) expect(SAFE_STUDENT_COLUMNS as readonly string[], col).toContain(col);
    }
  });

  it("binds every sprint filter value instead of interpolating it", () => {
    for (const w of Object.values(Q.sprintWhere)) {
      if (w === "1 = 1") continue;
      expect(w, `${w} has no bound parameter`).toMatch(/@[a-z]+/i);
      // The only literals allowed in a filter fragment are the fixed codes of the A-19 bucket rule.
      const literals = [...w.matchAll(/'([^']*)'/g)].map((m) => m[1]);
      for (const literal of literals) expect(["", "22", "TR", "FR", "FF", "XX"], `unexpected literal ${literal}`).toContain(literal);
    }
  });

  it("counts each student once per sprint, on their first clearance action", () => {
    expect(Q.sprintPrelude()).toMatch(/ROW_NUMBER\(\) OVER \(PARTITION BY ID_NUMBER ORDER BY DateCleared/);
    expect(Q.sprintPrelude()).toMatch(/rn = 1 AND DateCleared >= @start AND DateCleared < DATEADD\(day, 1, @end\)/);
  });

  it("applies the A-19 transfer rule identically to term-wide and sprint classification counts", () => {
    const rule = /TEL_WEB_GRP_CDE AS varchar\(10\)\)+ = '22' THEN 'TR'/;
    expect(Q.classificationCounts).toMatch(rule);
    expect(Q.classificationCountsInRange).toMatch(rule);
  });
  it("dedups clearance actions per student and applies the enrollment guard to DNR", () => {
    expect(Q.enrollmentClearance).toMatch(/FROM dbo\.VIEW_OURM_CLEARED GROUP BY ID_NUMBER/);
    expect(Q.dnrDncSummary).toMatch(/LEFT JOIN #enrolled e ON e\.idnumber = d\.idnumber WHERE e\.idnumber IS NULL/);
    expect(Q.populationWhere.dnr).toMatch(/NOT EXISTS \(SELECT 1 FROM #enrolled/);
  });
});

describe("writable stores stay inside schema [dash] (A-21; USER-MANAGEMENT-PLAN Sec.1)", () => {
  const sources = ["src/server/store/mssql.ts", "src/server/identity/mssql.ts", "db/migrations/001_init.sql", "db/migrations/002_identity.sql", "db/migrations/003_sprint.sql"];
  it("never names a dbo object and never touches source tables", async () => {
    const { readFileSync } = await import("node:fs");
    for (const f of sources) {
      const text = readFileSync(f, "utf8").replace(/^\s*--.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
      expect(text, `${f} references dbo.`).not.toMatch(/\bdbo\.\w/i);
      for (const t of ["tblStudent", "tblOUSA", "VIEW_OURM", "student_master"]) expect(text, `${f} references ${t}`).not.toMatch(new RegExp(`\\b${t}\\b`, "i"));
    }
  });
  it("grants script denies writes on dbo for the writable login", async () => {
    const { readFileSync } = await import("node:fs");
    expect(readFileSync("db/grants/jadi_dash.sql", "utf8")).toMatch(/DENY INSERT, UPDATE, DELETE, ALTER ON SCHEMA::dbo TO jadi_dash/);
  });
});
