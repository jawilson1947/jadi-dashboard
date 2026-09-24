import Link from "next/link";
import type { TransactionsView } from "@/server/services/transactions";
import { formatCurrency, formatIsoDateSafe } from "@/lib/format";

/**
 * Bio Spec card 2 — current-semester and global transactions.
 *
 * Pagination is per year (Bio Spec 2.1): a fifteen-year history is navigable by year rather than by
 * an endless page counter, and each year carries its own debit and credit totals so the shape of an
 * account is visible before opening it.
 */
export function TransactionsCard({
  view,
  base,
  currentTermAvailable,
  note,
}: {
  view: TransactionsView;
  base: string;
  currentTermAvailable: boolean;
  note: string;
}) {
  const scopeHref = (scope: "current" | "global") => `${base}?tab=transactions&scope=${scope}`;
  const yearHref = (year: string) => `${base}?tab=transactions&scope=${view.scope}&year=${year}`;
  const pageHref = (page: number) => `${base}?tab=transactions&scope=${view.scope}${view.year ? `&year=${view.year}` : ""}&page=${page}`;
  const pageCount = Math.max(1, Math.ceil(view.totalRows / view.pageSize));

  return (
    <section className="card space-y-3" aria-label="Transactions">
      <div className="flex flex-wrap items-center gap-2">
        {currentTermAvailable ? (
          <Link href={scopeHref("current")} aria-current={view.scope === "current" ? "true" : undefined} className={tabClass(view.scope === "current")}>
            Current semester
          </Link>
        ) : null}
        <Link href={scopeHref("global")} aria-current={view.scope === "global" ? "true" : undefined} className={tabClass(view.scope === "global")}>
          Global history
        </Link>
        <span className="ml-auto text-xs text-ink-3">{note}</span>
      </div>

      {view.years.length > 1 ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-ink-3 text-xs">Year</span>
          {view.years.map((y) => (
            <Link key={y.year} href={yearHref(y.year)} aria-current={view.year === y.year ? "true" : undefined} className={tabClass(view.year === y.year)}>
              {y.year}
              <span className="text-xs text-ink-3"> ({y.rows})</span>
            </Link>
          ))}
        </div>
      ) : null}

      {view.rows.length === 0 ? (
        <p className="text-sm text-ink-3">No transactions on file for this period.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Transactions, newest first</caption>
            <thead className="bg-surface-2 text-left">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium text-ink-2">Date posted</th>
                <th scope="col" className="px-3 py-2 font-medium text-ink-2">Description</th>
                <th scope="col" className="px-3 py-2 font-medium text-ink-2">Type</th>
                <th scope="col" className="px-3 py-2 font-medium text-ink-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {view.rows.map((r, i) => (
                <tr key={`${r.postedOn}-${i}`} className="border-t border-border">
                  <td className="px-3 py-2 whitespace-nowrap">{formatIsoDateSafe(r.postedOn)}</td>
                  <td className="px-3 py-2">{r.description || "—"}</td>
                  <td className="px-3 py-2">
                    {r.sourceLabel}
                    {r.unmapped ? <span className="text-xs text-warning"> (unmapped code)</span> : null}
                  </td>
                  <td className={`px-3 py-2 text-right tabular ${r.amount < 0 ? "text-good" : ""}`}>{formatCurrency(r.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <nav aria-label="Transaction pages" className="flex items-center gap-3 text-sm">
        <span className="text-ink-2">
          {view.totalRows} transaction{view.totalRows === 1 ? "" : "s"}
          {view.year ? ` in ${view.year}` : ""} · {view.allRows} on file
        </span>
        <div className="ml-auto flex items-center gap-2">
          {view.page > 1 ? <Link href={pageHref(view.page - 1)} className="rounded-md border border-border px-3 py-1">Previous</Link> : null}
          <span className="text-ink-2">Page {view.page} of {pageCount}</span>
          {view.page < pageCount ? <Link href={pageHref(view.page + 1)} className="rounded-md border border-border px-3 py-1">Next</Link> : null}
        </div>
      </nav>

      {view.unmappedCodes.length > 0 ? (
        <p className="text-xs text-ink-3">
          Unmapped transaction codes in this history: {view.unmappedCodes.join(", ")}. An administrator can name them under Administration — until then they are shown as themselves
          rather than folded into another category.
        </p>
      ) : null}
    </section>
  );
}

function tabClass(active: boolean): string {
  return `rounded-md px-3 py-1 text-sm ${active ? "bg-surface-2 font-medium" : "text-ink-2 hover:bg-surface-2 border border-border"}`;
}
