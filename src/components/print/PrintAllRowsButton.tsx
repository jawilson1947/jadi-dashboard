"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { formatCurrency } from "@/lib/format";

export interface PrintColumn {
  key: string;
  label: string;
  align?: "left" | "right";
  format?: "currency" | "text";
}

const PAGE_SIZE = 200;
export const PRINT_ROW_CAP = 2000;

/**
 * Drill-down print: fetches EVERY row of the population (up to PRINT_ROW_CAP, 200 per request through the
 * same audited endpoint the table uses), renders them into a print-only table, and opens the print dialog.
 * The on-screen paginated table is hidden while printing so the printout is the full report.
 */
export function PrintAllRowsButton({ population, sort, direction, columns, totalRows }: { population: string; sort: string; direction: string; columns: PrintColumn[]; totalRows: number }) {
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const clear = () => {
      document.body.classList.remove("print-all-rows");
      setRows(null);
    };
    window.addEventListener("afterprint", clear);
    return () => window.removeEventListener("afterprint", clear);
  }, []);

  useEffect(() => {
    if (!rows) return;
    document.body.classList.add("print-all-rows");
    const id = requestAnimationFrame(() => window.print());
    return () => cancelAnimationFrame(id);
  }, [rows]);

  async function print() {
    setBusy(true);
    setError(null);
    try {
      const all: Record<string, unknown>[] = [];
      const pages = Math.min(Math.ceil(totalRows / PAGE_SIZE), Math.ceil(PRINT_ROW_CAP / PAGE_SIZE));
      for (let p = 1; p <= Math.max(1, pages); p++) {
        const res = await fetch(`/api/v1/dashboard/current/students?population=${encodeURIComponent(population)}&page=${p}&pageSize=${PAGE_SIZE}&sort=${encodeURIComponent(sort)}&direction=${encodeURIComponent(direction)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = await res.json();
        all.push(...(body.data.rows as Record<string, unknown>[]));
        if (all.length >= PRINT_ROW_CAP || body.data.rows.length < PAGE_SIZE) break;
      }
      setRows(all.slice(0, PRINT_ROW_CAP));
    } catch {
      setError("Could not load all rows for printing.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <span className="no-print inline-flex items-center gap-2">
        {error ? <span role="alert" className="text-xs text-critical">{error}</span> : null}
        <button type="button" onClick={print} disabled={busy} className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-surface-2 disabled:opacity-50" aria-label="Print all rows of this report">
          <span aria-hidden>🖨</span> {busy ? "Preparing…" : totalRows > PRINT_ROW_CAP ? `Print first ${PRINT_ROW_CAP.toLocaleString()} rows` : "Print all rows"}
        </button>
      </span>
      {rows && typeof document !== "undefined"
        ? createPortal(
        <div className="print-all-rows-table" data-print-id="all-rows">
          <table className="w-full text-xs">
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c.key} className={`px-2 py-1 text-left font-medium ${c.align === "right" ? "text-right" : ""}`}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={String(r.idnumber ?? i)}>
                  {columns.map((c) => (
                    <td key={c.key} className={`px-2 py-0.5 whitespace-nowrap ${c.align === "right" ? "text-right tabular" : ""}`}>
                      {c.format === "currency" ? formatCurrency(r[c.key] as number) : String(r[c.key] ?? "—")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr><td colSpan={columns.length} /></tr>
            </tfoot>
          </table>
          {totalRows > rows.length ? <p className="text-xs mt-2">Showing the first {rows.length.toLocaleString()} of {totalRows.toLocaleString()} rows (print cap).</p> : null}
        </div>,
            document.getElementById("main") ?? document.body,
          )
        : null}
    </>
  );
}
