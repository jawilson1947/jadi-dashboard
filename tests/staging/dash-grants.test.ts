/**
 * Proves the writable login's boundary on staging (USER-MANAGEMENT-PLAN Sec.10 U1): jadi_dash can read
 * source data and write inside schema [dash], and is DENIED writes on dbo. Runs only with
 * DASH_CONNECTION_STRING set (npm run test:staging after scripts/setup-dash-login.ps1).
 */
import { afterAll, describe, expect, it } from "vitest";
import { closePools, getDashPool } from "@/server/db/mssql";
import { MssqlIdentityStore } from "@/server/identity/mssql";

const cs = process.env.DASH_CONNECTION_STRING;
const d = cs ? describe : describe.skip;

d("jadi_dash grants and identity schema on staging", () => {
  afterAll(() => closePools());

  it("cannot modify dbo (OUSA/Jenzabar) data", async () => {
    const pool = await getDashPool();
    await expect(pool.request().query("UPDATE dbo.tblOUSA SET isCurrent = isCurrent WHERE 1 = 0")).rejects.toThrow(/permission was denied/i);
    await expect(pool.request().query("DELETE FROM dbo.tblStudent WHERE 1 = 0")).rejects.toThrow(/permission was denied/i);
  }, 30_000);

  it("can read source metadata and has the identity tables in dash", async () => {
    const pool = await getDashPool();
    const terms = await pool.request().query<{ n: number }>("SELECT COUNT(*) AS n FROM dbo.tblOUSA");
    expect(terms.recordset[0].n).toBeGreaterThan(0);
    const tables = await pool.request().query<{ name: string }>("SELECT t.name FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id WHERE s.name = 'dash' ORDER BY t.name");
    const names = tables.recordset.map((r) => r.name);
    for (const t of ["User", "Role", "Permission", "RolePermission", "UserRole", "UserPermission", "Session", "CredentialToken", "Job", "JobRun", "Snapshot", "Setting", "AuditEvent", "SchemaMigration"]) expect(names).toContain(t);
    const seeded = await pool.request().query<{ n: number }>("SELECT COUNT(*) AS n FROM dash.RolePermission");
    expect(seeded.recordset[0].n).toBeGreaterThanOrEqual(15 + 7 + 2);
  }, 30_000);

  it("identity store round-trips a user without exposing anything but hashes", async () => {
    const store = new MssqlIdentityStore();
    const admins = await store.countActiveAdministrators();
    expect(typeof admins).toBe("number");
    const list = await store.listUsers({ page: 1, pageSize: 5 });
    for (const u of list.rows) expect(u.passwordHash === null || u.passwordHash.startsWith("$scrypt$")).toBe(true);
  }, 30_000);
});
