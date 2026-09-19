import { formatCount } from "@/lib/format";

/**
 * Export the filtered population (Spec §11, A-11). A POST form rather than a link: exports are
 * state-changing in the audit sense — each one writes an audit row — and POST keeps them out of
 * browser history and prefetch.
 */
export function ExportCsvButton({ query, sort, direction, rowCount }: { query: string; sort: string; direction: string; rowCount: number }) {
  const params = new URLSearchParams(query);
  return (
    <form method="post" action="/api/v1/dnr-dnc/export" className="inline-flex items-center gap-2 no-print">
      {[...params.entries()].map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <input type="hidden" name="sort" value={sort} />
      <input type="hidden" name="direction" value={direction} />
      <button type="submit" className="rounded-md border border-border px-3 py-2 text-sm hover:bg-surface-2" title="Download the filtered rows as CSV">
        Export CSV ({formatCount(rowCount)})
      </button>
    </form>
  );
}
