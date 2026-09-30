import { describe, expect, it } from "vitest";
import { RQ, KNOWN_CLASS_CODES, CLASS_BUCKET as REPORT_CLASS_BUCKET } from "@/server/repositories/mssql/report-sql";
import { Q, CLASS_BUCKET as DASHBOARD_CLASS_BUCKET } from "@/server/repositories/mssql/sql";
import { REPORT_DEFINITIONS, REPORT_KEYS, snapshotReports } from "@/server/reports/definitions";

/**
 * Strip SQL comments before matching. A guardrail that scans raw text will happily flag the comment
 * explaining why a construct is absent — which is exactly what happened here, twice: once on an
 * ORDER BY and once on a comment reading "No TRY_CONVERT: ...". The rule is about executable SQL,
 * so the assertion has to look at executable SQL.
 */
function executableSql(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

/**
 * Every SELECT list in a batch: the text between each SELECT and its matching FROM. Crude, but it
 * is the part of the statement the A-30 guarantee is actually about.
 */
function selectLists(sql: string): string[] {
  return [...executableSql(sql).matchAll(/\bSELECT\b([\s\S]*?)\bFROM\b/gi)].map((m) => m[1]);
}

const FORBIDDEN = ["SSN", "dob", "gender", "BankAccount", "PIN", "VIEW_OURM_ACAD", "172.18", "JICSSQL", "TMSEPRD"];
const allSql = Object.values(RQ);

describe("report SQL guardrails (Spec §15, §18; FINDINGS §6, §7)", () => {
  it("never references sensitive columns, the academic view, or linked servers", () => {
    for (const s of allSql) for (const f of FORBIDDEN) expect(executableSql(s), `contains ${f}`).not.toMatch(new RegExp(`\\b${f.replace(".", "\\.")}\\b`, "i"));
  });

  it("never queries the slow views VIEW_OURM_FCA / VIEW_OURM_STATS — that is the whole point of the rewrite", () => {
    for (const s of allSql) expect(executableSql(s)).not.toMatch(/VIEW_OURM_(FCA|STATS)\b/i);
  });

  it("is read-only except for its own #temp tables", () => {
    for (const raw of allSql) {
      const s = executableSql(raw);
      expect(s).not.toMatch(/\b(INSERT|UPDATE|DELETE|MERGE|ALTER|EXEC)\b/i);
      for (const m of s.matchAll(/\b(DROP TABLE|CREATE\s+(?:UNIQUE\s+)?CLUSTERED INDEX \w+ ON|INTO)\s+(\S+)/gi)) {
        expect(m[2].startsWith("#"), m[0]).toBe(true);
      }
    }
  });

  it("never switches database with USE — connections are pooled", () => {
    for (const s of allSql) expect(executableSql(s)).not.toMatch(/\bUSE\s+\[/i);
  });

  it("returns typed values: no FORMAT() anywhere (Spec §15)", () => {
    for (const s of allSql) expect(executableSql(s)).not.toMatch(/\bFORMAT\s*\(/i);
  });

  /**
   * The rule is about what the snapshot CARRIES, so the assertion has to look at the SELECT lists
   * rather than the whole batch. An earlier version matched the entire statement and flagged an
   * ORDER BY on lastname — a false positive that says nothing about the payload. Testing the
   * proxy instead of the property is how a guardrail ends up trusted and wrong.
   */
  it("does not select names, emails or balances — those are joined live from tblStudent (A-30)", () => {
    for (const [key, sql] of Object.entries(RQ)) {
      for (const list of selectLists(sql)) {
        expect(list, `${key} selects a name`).not.toMatch(/\b(lastname|firstname|midname)\b/i);
        expect(list, `${key} selects email`).not.toMatch(/\bemail\b/i);
        expect(list, `${key} selects a balance`).not.toMatch(/\bAccountBalance\b/i);
      }
    }
  });

  it("parameterises the balance range rather than interpolating it", () => {
    // R4's population is captured unfiltered and filtered in the service, so the SQL carries no
    // literal from the form at all — the strongest version of the rule.
    expect(RQ.enrolleeBalancePopulation).not.toMatch(/\?/);
  });

  it("applies the A-19 classification rule identically to the dashboard's query", () => {
    // CLASS_BUCKET is duplicated between sql.ts and report-sql.ts rather than imported. That is a
    // deliberate trade, and it is only safe if something fails when the two drift — so compare the
    // GENERATORS. An earlier version matched a hand-written regex against their output and failed
    // on a miscounted bracket, which would have been "fixed" by loosening the regex rather than by
    // checking anything real.
    expect(REPORT_CLASS_BUCKET("x")).toBe(DASHBOARD_CLASS_BUCKET("x"));
    expect(REPORT_CLASS_BUCKET("sm")).toContain("TEL_WEB_GRP_CDE");
    expect(REPORT_CLASS_BUCKET("sm")).toContain("'22'");

    const bucketOf = (alias: string) => REPORT_CLASS_BUCKET(alias);
    expect(Q.classificationCounts).toContain(bucketOf("student_master"));
    for (const key of ["unclassified", "clearedMoreThanOnce", "enrolleeBalancePopulation", "currentlyCleared"] as const) {
      expect(RQ[key], `${key} must use the A-19 bucket`).toContain(bucketOf("sm"));
    }
  });

  it("selects R1 on the RAW class code, not the A-19 bucket (R-D5)", () => {
    // Selecting on the bucket would hide the defect the report exists to find: a blank class code
    // resolved to Transfer Student by the web group code would silently drop off the list.
    // Built rather than hand-written, so a change to the expression cannot silently stop matching.
    const rawPredicate = `UPPER(LTRIM(RTRIM(ISNULL(sm.CURRENT_CLASS_CDE, '')))) NOT IN`;
    expect(RQ.unclassified).toContain(rawPredicate);
    // And the bucket must NOT be what the WHERE filters on.
    expect(RQ.unclassified).not.toContain(`${REPORT_CLASS_BUCKET("sm")} NOT IN`);
  });

  it("keeps the known-code list in one place", () => {
    for (const code of KNOWN_CLASS_CODES) expect(RQ.unclassified).toContain(`'${code}'`);
  });
});

describe("report catalog", () => {
  it("has a definition for every key, and no duplicates", () => {
    expect(REPORT_DEFINITIONS.map((r) => r.key).sort()).toEqual([...REPORT_KEYS].sort());
    expect(new Set(REPORT_DEFINITIONS.map((r) => r.ref)).size).toBe(REPORT_DEFINITIONS.length);
  });

  it("gives every snapshot-backed report a job, a family and a cron", () => {
    for (const r of snapshotReports()) {
      expect(r.jobKey, r.key).toBeTruthy();
      expect(r.family, r.key).toBeTruthy();
      expect(r.defaultCron, r.key).toBeTruthy();
      expect(r.capture, r.key).toBeTruthy();
    }
  });

  it("marks only R5 as live, and R2/R5 as covering the previous semester", () => {
    const live = REPORT_DEFINITIONS.filter((r) => r.family === null);
    expect(live.map((r) => r.ref)).toEqual(["R5"]);
    // R2 and R5 read tblStudent.LastCleared against tblOUSA directly, so they can span both terms.
    // R1, R3, R4 and R6 read VIEW_OURM_* views scoped to isCurrent = 1, so claiming otherwise on
    // screen would be a promise the data cannot keep (R-D2 / R-D2a).
    const both = REPORT_DEFINITIONS.filter((r) => r.termScope === "current+previous");
    expect(both.map((r) => r.ref)).toEqual(["R2", "R5"]);
    // The claim on R2 is only honest while its tblOUSA join actually admits the wasCurrent row.
    expect(RQ.freshmanAnalysis).toMatch(/o\.isCurrent\s*=\s*1\s+OR\s+o\.wasCurrent\s*=\s*1/i);
    expect(RQ.freshmanAnalysis).not.toMatch(/VIEW_OURM/i);
  });
});
