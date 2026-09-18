/**
 * Equivalence test: the supplied report query (docs/validation-sql/clearance_by_classification.sql, run
 * verbatim — slow, uses VIEW_OURM_FCA / VIEW_OURM_STATS) must produce exactly the rows the fast
 * application path produces. Runs only with OUSADB_CONNECTION_STRING (staging). npm run test:staging
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { MssqlDataProvider } from "@/server/repositories/mssql/provider";
import { closePools, getSourcePool } from "@/server/db/mssql";
import { buildBreakdown } from "@/server/metadata/clearance-breakdown";

const cs = process.env.OUSADB_CONNECTION_STRING;
const d = cs ? describe : describe.skip;

type SourceRow = { cCode: string; ClassName: string; Enrolled: number; Cleared: number; NotCleared: number; ClearedPercent: string };

d("Clearance Breakdown: fast path ≡ supplied query", () => {
  afterAll(() => closePools());

  it("returns identical rows, in the same order, including the Total row", async () => {
    const supplied = readFileSync(join(process.cwd(), "docs/validation-sql/clearance_by_classification.sql"), "utf8").replace(/^﻿/, "");
    const pool = await getSourcePool();
    const ref = (await pool.request().query<SourceRow>(supplied)).recordset;

    const counts = await new MssqlDataProvider().getClassificationCounts();
    const fast = buildBreakdown(counts.enrolled, counts.cleared);

    expect(fast).toHaveLength(ref.length);
    ref.forEach((r, i) => {
      const f = fast[i];
      expect(f.cCode, `row ${i}`).toBe(r.cCode.trim());
      expect(f.className).toBe(r.ClassName);
      expect(f.isTotal).toBe(r.ClassName === "Total");
      expect(f.enrolled, `${r.ClassName} enrolled`).toBe(Number(r.Enrolled));
      expect(f.cleared, `${r.ClassName} cleared`).toBe(Number(r.Cleared));
      expect(f.notCleared).toBe(Number(r.NotCleared));
      expect(f.clearedPercent === null ? "0%" : `${f.clearedPercent.toFixed(2)}%`).toBe(String(r.ClearedPercent).trim());
    });
  }, 300_000);
});
