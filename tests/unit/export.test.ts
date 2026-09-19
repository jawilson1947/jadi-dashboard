import { describe, expect, it } from "vitest";
import { csvCell, exportFilename, toCsv } from "@/server/services/export";

describe("CSV export core (Spec §11, §18)", () => {
  it("neutralises cells a spreadsheet would execute as a formula", () => {
    for (const payload of ["=1+1", "+1", "-1", "@SUM(A1)", "\tcmd", "\rcmd"]) {
      // The guard apostrophe comes first; a carriage return additionally forces the cell to be quoted.
      expect(csvCell(payload).replace(/^"/, "").startsWith("'"), payload).toBe(true);
    }
    expect(csvCell("=HYPERLINK(\"http://evil\",\"click\")")).toContain("'=HYPERLINK");
  });

  it("leaves ordinary values alone and quotes only what needs quoting", () => {
    expect(csvCell("Smith")).toBe("Smith");
    expect(csvCell(1234.5)).toBe("1234.5");
    expect(csvCell("Smith, Jr.")).toBe('"Smith, Jr."');
    expect(csvCell('He said "hi"')).toBe('"He said ""hi"""');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
    expect(csvCell(null)).toBe("");
  });

  it("writes a BOM and CRLF line endings so Excel reads it correctly", () => {
    const csv = toCsv([{ a: "x" }], [{ header: "A", value: (r) => r.a }], "t.csv");
    expect(csv.body.startsWith("﻿")).toBe(true);
    expect(csv.body).toBe("﻿A\r\nx\r\n");
    expect(csv.rowCount).toBe(1);
    expect(csv.truncated).toBe(false);
  });

  it("caps rows and says so rather than truncating silently", () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ a: String(i) }));
    const csv = toCsv(rows, [{ header: "A", value: (r) => r.a }], "t.csv", 3);
    expect(csv.rowCount).toBe(3);
    expect(csv.truncated).toBe(true);
  });

  it("names files by kind, term and local capture time", () => {
    const name = exportFilename("dnr-dnc", "FA2026", new Date("2026-09-18T19:32:00Z"), "America/Chicago");
    expect(name).toBe("dnr-dnc-FA2026-20260918-1432.csv");
  });
});
