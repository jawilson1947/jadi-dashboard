import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { QS, SAFE_BIO_COLUMNS } from "@/server/repositories/mssql/student-sql";
import { escapeLike } from "@/lib/search";

/**
 * The Student subsystem is the one place allowed to read `dob`, to EXEC a procedure, and to name a
 * linked server (docs/STUDENT-PLAN.md D-1, A-24). These tests are what keeps that exception narrow:
 * one student at a time, every value bound, and nothing else widened.
 */
const LINKED = "[SERVER].[DB]";
const all = [QS.searchByName, QS.searchById, QS.bio, QS.currentTermTransactions, QS.globalTransactions(LINKED), QS.worksheetItems, QS.costAnalysis];

describe("student SQL guardrails (Spec §15, §18)", () => {
  it("never reads the columns that are off limits whatever the card asks for", () => {
    for (const s of all) for (const forbidden of ["SSN", "gender", "BankAccount", "PIN"]) {
      expect(s, `contains ${forbidden}`).not.toMatch(new RegExp(`\\b${forbidden}\\b`, "i"));
    }
  });

  it("reads only whitelisted tblStudent columns on the bio card", () => {
    const selected = [...QS.bio.matchAll(/\bS\.([A-Za-z_]+)/g)].map((m) => m[1]);
    for (const col of selected) expect(SAFE_BIO_COLUMNS as readonly string[], col).toContain(col);
    // dob is deliberately in the whitelist — the Bio Spec needs it — and is masked in the service (A-29).
    expect(SAFE_BIO_COLUMNS as readonly string[]).toContain("dob");
  });

  it("is read-only apart from the institution's own worksheet procedure", () => {
    for (const s of all) {
      expect(s).not.toMatch(/\b(INSERT|UPDATE|DELETE|MERGE|ALTER|DROP)\b/i);
      const execs = [...s.matchAll(/\bEXEC\s+([\w.\[\]]+)/gi)].map((m) => m[1]);
      for (const proc of execs) expect(proc).toBe("dbo.Sp_GetFCWorksheetItems");
    }
  });

  it("binds every value — no student ID, name or date is interpolated", () => {
    for (const s of all) {
      // The Bio Spec's sample literals (id 176941, a hard-coded date) must not survive into the code.
      expect(s).not.toMatch(/\b176941\b/);
      expect(s).not.toMatch(/id_num\s*=\s*\d/i);
      expect(s).not.toMatch(/ID_NUM\s*=\s*'/);
    }
    expect(QS.bio).toMatch(/S\.idnumber = @id/);
    expect(QS.currentTermTransactions).toMatch(/id_num = @id/);
    expect(QS.globalTransactions(LINKED)).toMatch(/ID_NUM = @id/);
    expect(QS.worksheetItems).toMatch(/@ID_NUM = @id/);
    expect(QS.worksheetItems).toMatch(/@DropClassesDate = @dropDate/);
    // fn_CostAnalysis is SCALAR — (@what, @balance, @charges, @credits) — and is called the way
    // VIEW_OURM_FCA itself calls it. Calling it as a table-valued function keyed on an id is the
    // mistake this assertion exists to catch (SQL Server reports "Invalid object name").
    expect(QS.costAnalysis).not.toMatch(/FROM\s+dbo\.fn_CostAnalysis/i);
    expect(QS.costAnalysis).toMatch(/S\.idnumber = @id/);
    for (const what of ["S", "T", "D", "L", "P"]) {
      expect(QS.costAnalysis, `missing fn_CostAnalysis('${what}', ...)`).toContain(`dbo.fn_CostAnalysis('${what}', S.AccountBalance`);
    }
  });

  it("pairs every LIKE with an ESCAPE clause so a wildcard in a name is literal", () => {
    for (const s of [QS.searchByName, QS.searchById]) {
      const likes = (s.match(/\bLIKE\b/gi) ?? []).length;
      const escapes = (s.match(/ESCAPE\s+'\\'/g) ?? []).length;
      expect(escapes, "every LIKE needs an ESCAPE").toBe(likes);
    }
    expect(escapeLike("%")).toBe("\\%");
  });

  it("bounds every result set", () => {
    expect(QS.searchByName).toMatch(/TOP \(@limit\)/);
    expect(QS.searchById).toMatch(/TOP \(@limit\)/);
    expect(QS.bio).toMatch(/TOP \(1\)/);
  });

  it("names the linked server only in the global-history statement, and only from configuration", () => {
    for (const s of all) {
      if (s === QS.globalTransactions(LINKED)) continue;
      expect(s).not.toMatch(/TMSEPRD|172\.18|JICSSQL/i);
    }
    // The server name is substituted, never written into the file — A-24 has not confirmed the target.
    expect(readFileSync("src/server/repositories/mssql/student-sql.ts", "utf8")).not.toMatch(/FROM \[172\.18/);
  });

  it("keeps the source-code labels out of SQL so they stay admin-editable (A-28)", () => {
    for (const s of all) expect(s).not.toMatch(/Financial Aid|Payroll Deduction|Tuition Related Charge/);
  });
});

describe("the global-history path is gated until A-24 is signed", () => {
  it("the provider refuses to send it unless it has been deliberately enabled", () => {
    const source = readFileSync("src/server/repositories/mssql/provider.ts", "utf8");
    expect(source).toMatch(/TRANS_HIST_GLOBAL_ENABLED/);
    expect(source).toMatch(/DataSourceUnavailableError\(/);
  });
});
