import { formatCount } from "@/lib/format";

/**
 * CSV and XLSX export for a report (A-11, A-31). POST forms rather than links: each export writes
 * an audit row, so it is state-changing in the sense that matters, and POST keeps the parameters
 * out of browser history and out of prefetch.
 *
 * Either export.create or mailmerge.create admits the caller (R-D3); the route enforces that, and
 * the page only decides whether to draw the buttons.
 */
export function ExportReportButtons({ reportKey, query, rowCount }: { reportKey: string; query: string; rowCount: number }) {
  const params = new URLSearchParams(query);
  const action = `/api/v1/reports/${encodeURIComponent(reportKey)}/export`;
  return (
    <span className="inline-flex items-center gap-2 no-print">
      {(["csv", "xlsx"] as const).map((format) => (
        <form key={format} method="post" action={action} className="inline">
          {[...params.entries()].map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}
          <input type="hidden" name="format" value={format} />
          <button
            type="submit"
            className="rounded-md border border-border px-3 py-2 text-sm hover:bg-surface-2"
            title={`Download ${formatCount(rowCount)} rows as ${format.toUpperCase()} for mail merge`}
          >
            {format.toUpperCase()}
          </button>
        </form>
      ))}
    </span>
  );
}
