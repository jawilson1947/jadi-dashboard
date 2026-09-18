import { describe, expect, it } from "vitest";
import { Q, SAFE_STUDENT_COLUMNS } from "@/server/repositories/mssql/sql";

const FORBIDDEN = ["SSN", "dob", "gender", "BankAccount", "PIN", "VIEW_OURM_ACAD", "172.18", "JICSSQL", "TMSEPRD"];
const allSql = [
  Q.terms, Q.nightlyFigures, Q.enrollmentClearance, Q.currentReceivable, Q.chargesCredits, Q.dnrDncSummary, Q.classificationCounts,
  ...Object.values(Q.populationWhere).map((w) => Q.studentPage(w, "S.lastname", "ASC")),
  ...Object.values(Q.populationWhere).map((w) => Q.studentCount(w)),
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
  it("selects only whitelisted tblStudent columns in the student page", () => {
    const page = Q.studentPage(Q.populationWhere.enrolled, "S.lastname", "ASC");
    const selected = [...page.matchAll(/\bS\.([A-Za-z_]+)/g)].map((m) => m[1]);
    for (const col of selected) expect(SAFE_STUDENT_COLUMNS as readonly string[], col).toContain(col);
  });
  it("dedups clearance actions per student and applies the enrollment guard to DNR", () => {
    expect(Q.enrollmentClearance).toMatch(/FROM dbo\.VIEW_OURM_CLEARED GROUP BY ID_NUMBER/);
    expect(Q.dnrDncSummary).toMatch(/LEFT JOIN #enrolled e ON e\.idnumber = d\.idnumber WHERE e\.idnumber IS NULL/);
    expect(Q.populationWhere.dnr).toMatch(/NOT EXISTS \(SELECT 1 FROM #enrolled/);
  });
});

describe("writable stores stay inside schema [dash] (A-21; USER-MANAGEMENT-PLAN Sec.1)", () => {
  const sources = ["src/server/store/mssql.ts", "src/server/identity/mssql.ts", "db/migrations/001_init.sql", "db/migrations/002_identity.sql"];
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
