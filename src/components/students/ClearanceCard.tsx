import { itemDirection, itemTypeLabel, type ClearanceAnalysis } from "@/server/services/clearance-analysis";
import { formatCurrency, formatIsoDateSafe } from "@/lib/format";

/**
 * Bio Spec card 5 — Student Financial Clearance Status.
 *
 * ONE figure answers "what must this student pay to clear", and it is the header stat computed from
 * the worksheet itself: AccountBalance + 80% of the net (debits − credits), floored at zero
 * (D-4, 2026-09-24, Jim). The `fn_CostAnalysis` panel that used to sit below it was removed on the
 * same decision — two answers to that question on one screen is worse than one whose arithmetic the
 * reader can check against the table beneath it. `costAnalysis` is still carried on the API
 * response for reconciliation work; it is simply not rendered here.
 */
export function ClearanceCard({ analysis }: { analysis: ClearanceAnalysis }) {
  return (
    <section className="card space-y-4" aria-label="Financial clearance status">
      <div className="grid gap-4 sm:grid-cols-3 xl:grid-cols-5">
        <Stat label="Account balance" value={formatCurrency(analysis.accountBalance)} hint="tblStudent.AccountBalance (authoritative, A-18)" />
        <Stat label="Worksheet net amount" value={formatCurrency(analysis.worksheetNetAmount)} hint={`${analysis.items.length} item${analysis.items.length === 1 ? "" : "s"} on the worksheet`} />
        <Stat label="Total monies due" value={formatCurrency(analysis.totalMoniesDue)} hint="Balance plus the worksheet net" />
        <Stat
          label="80% of current charges"
          value={formatCurrency(analysis.eightyPercentOfCharges)}
          hint={`80% of the net ${formatCurrency(analysis.worksheetNetAmount)} (debits less credits)`}
        />
        <Stat
          label="Amount needed to Clear"
          value={formatCurrency(analysis.amountNeededToClearComputed)}
          hint="Account balance plus 80% of current charges; zero when that comes out negative"
        />
      </div>

      {analysis.items.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Financial clearance worksheet items</caption>
            <thead className="bg-surface-2 text-left">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium text-ink-2">Date</th>
                <th scope="col" className="px-3 py-2 font-medium text-ink-2">Item</th>
                <th scope="col" className="px-3 py-2 font-medium text-ink-2">Type</th>
                <th scope="col" className="px-3 py-2 font-medium text-ink-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {analysis.items.map((r, i) => {
                const credit = itemDirection(r) === "credit";
                return (
                  <tr key={`${r.description}-${i}`} className="border-t border-border">
                    <td className="px-3 py-2 whitespace-nowrap">{formatIsoDateSafe(r.postedOn)}</td>
                    <td className="px-3 py-2">{r.description || "—"}</td>
                    <td className={`px-3 py-2 whitespace-nowrap ${credit ? "text-good" : "text-ink-2"}`}>{itemTypeLabel(r)}</td>
                    <td className={`px-3 py-2 text-right tabular ${credit ? "text-good" : ""}`}>{formatCurrency(Math.abs(r.amount))}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-border text-ink-2">
                <td className="px-3 py-2" colSpan={3}>
                  Total debits ({analysis.totals.debitCount} item{analysis.totals.debitCount === 1 ? "" : "s"})
                </td>
                <td className="px-3 py-2 text-right tabular">{formatCurrency(analysis.totals.debits)}</td>
              </tr>
              <tr className="text-ink-2">
                <td className="px-3 py-2" colSpan={3}>
                  Total credits ({analysis.totals.creditCount} item{analysis.totals.creditCount === 1 ? "" : "s"})
                </td>
                <td className="px-3 py-2 text-right tabular text-good">−{formatCurrency(analysis.totals.credits)}</td>
              </tr>
              <tr className="border-t border-border font-medium">
                <td className="px-3 py-2" colSpan={3}>Net amount</td>
                <td className="px-3 py-2 text-right tabular">{formatCurrency(analysis.worksheetNetAmount)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      ) : (
        <p className="text-sm text-ink-3">The worksheet procedure returned no items for this student.</p>
      )}

      <p className="text-xs text-ink-3">
        Worksheet items are read live from the institution&apos;s procedure, using the current semester&apos;s drop date
        {analysis.dropClassesDate ? ` (${formatIsoDateSafe(analysis.dropClassesDate)})` : ""}. This is the live recomputation, not the filed worksheet PDF.
      </p>
    </section>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <p className="text-xs text-ink-3">{label}</p>
      <p className="text-lg font-semibold tabular">{value}</p>
      {hint ? <p className="text-xs text-ink-3">{hint}</p> : null}
    </div>
  );
}
