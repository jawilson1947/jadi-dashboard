import { formatCount, formatCurrency, formatIsoDateSafe } from "@/lib/format";

/**
 * The plain table body shared by R3, R4, R5 and R6 — the reports whose finding IS the list, with
 * no summary panel above it. R1 and R2 have their own components because their finding is not the
 * list: it is the code summary and the boundary distribution respectively.
 */

export interface SimpleColumn<T> {
  key: string;
  label: string;
  align?: "left" | "right";
  render?: (row: T) => React.ReactNode;
}

/**
 * Report tables are deliberately NOT paginated: Print has to capture the whole list, and a paged
 * table would print one page of it. The cost is that every row is in the DOM, so there is a cap —
 * and when it bites the page says so, because a silently truncated collection list is the kind of
 * error someone acts on without noticing.
 */
export const RENDER_ROW_CAP = 5000;

export function SimpleReportTable<T extends object>({
  rows,
  columns,
  rowKey,
  caption,
  emptyMessage = "No rows.",
  maxRender = RENDER_ROW_CAP,
}: {
  rows: T[];
  columns: SimpleColumn<T>[];
  rowKey: (row: T, index: number) => string;
  caption: string;
  emptyMessage?: string;
  maxRender?: number;
}) {
  const shown = rows.slice(0, maxRender);
  const truncated = rows.length > shown.length;
  return (
    <div className="card p-0 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead className="bg-surface-2 text-left">
            <tr>
              {columns.map((c) => (
                <th key={c.key} scope="col" className={`px-3 py-2 font-medium text-ink-2 whitespace-nowrap ${c.align === "right" ? "text-right" : ""}`}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((row, i) => (
              <tr key={rowKey(row, i)} className="border-t border-border">
                {columns.map((c) => (
                  <td key={c.key} className={`px-3 py-2 ${c.align === "right" ? "text-right tabular" : ""}`}>
                    {c.render ? c.render(row) : String((row as Record<string, unknown>)[c.key] ?? "")}
                  </td>
                ))}
              </tr>
            ))}
            {shown.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-3 py-6 text-center text-ink-2">
                  {emptyMessage}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {truncated ? (
        <p role="status" className="border-t border-warning px-3 py-2 text-sm">
          <span aria-hidden>⚠</span> Showing the first {shown.length.toLocaleString()} of {rows.length.toLocaleString()} rows.
          Narrow the report, or use the CSV or XLSX export, which carries the full set up to the export cap.
        </p>
      ) : null}
    </div>
  );
}

/** Shared cell renderers, so a date or a balance looks the same on every report. */
export const cell = {
  date: (d: Date | string | null | undefined) => (d ? formatIsoDateSafe(new Date(d).toISOString().slice(0, 10)) : "—"),
  money: (n: number | null | undefined) => formatCurrency(n ?? 0),
  count: (n: number | null | undefined) => formatCount(n ?? 0),
  text: (v: string | null | undefined) => v || "—",
};
