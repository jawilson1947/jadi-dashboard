import type { ClearanceAnalysis } from "@/server/services/clearance-analysis";
import { formatCurrency, formatIsoDateSafe } from "@/lib/format";

/**
 * Bio Spec card 5 — Student Financial Clearance Status.
 *
 * One figure answers "what must this student pay to clear", and it comes from the institution's own
 * `fn_CostAnalysis` (D-2). The Bio Spec's inline 80% formula is deliberately not shown alongside it:
 * two competing answers on one screen is worse than one with a stated source. When the function has
 * no row, the card says so rather than printing a zero that reads as "nothing to pay".
 */
export function ClearanceCard({ analysis }: { analysis: ClearanceAnalysis }) {
  return (
    <section className="card space-y-4" aria-label="Financial clearance status">
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Account balance" value={formatCurrency(analysis.accountBalance)} hint="tblStudent.AccountBalance (authoritative, A-18)" />
        <Stat label="Worksheet net amount" value={formatCurrency(analysis.worksheetNetAmount)} hint={`${analysis.items.length} item${analysis.items.length === 1 ? "" : "s"} on the worksheet`} />
        <Stat label="Total monies due" value={formatCurrency(analysis.totalMoniesDue)} hint="Balance plus the worksheet net" />
      </div>

      <div className="rounded-md border border-border p-4">
        <p className="text-xs text-ink-3">Amount needed to clear financially</p>
        {analysis.status === "ok" && analysis.amountNeededToClear !== null ? (
          <>
            <p className="text-2xl font-semibold tabular">{formatCurrency(analysis.amountNeededToClear)}</p>
            <p className="text-xs text-ink-3 mt-1">
              Computed by the institution&apos;s cost analysis (the 80% rule), not by this application.
              {analysis.costAnalysis ? ` Payment plan: ${formatCurrency(analysis.costAnalysis.payment)} · loan ${formatCurrency(analysis.costAnalysis.loan)}.` : ""}
            </p>
          </>
        ) : analysis.status === "no-amount-outstanding" ? (
          <p className="text-sm mt-1">No amount outstanding for clearance — the worksheet nets to a credit.</p>
        ) : (
          <p className="text-sm mt-1">
            The cost analysis returned no row for this student, so the amount cannot be stated. This is not the same as owing nothing — ask an administrator to check the student&apos;s
            payment-plan record.
          </p>
        )}
      </div>

      {analysis.items.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Financial clearance worksheet items</caption>
            <thead className="bg-surface-2 text-left">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium text-ink-2">Date</th>
                <th scope="col" className="px-3 py-2 font-medium text-ink-2">Item</th>
                <th scope="col" className="px-3 py-2 font-medium text-ink-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {analysis.items.map((r, i) => (
                <tr key={`${r.description}-${i}`} className="border-t border-border">
                  <td className="px-3 py-2 whitespace-nowrap">{formatIsoDateSafe(r.postedOn)}</td>
                  <td className="px-3 py-2">{r.description || "—"}</td>
                  <td className={`px-3 py-2 text-right tabular ${r.amount < 0 ? "text-good" : ""}`}>{formatCurrency(r.amount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-border font-medium">
                <td className="px-3 py-2" colSpan={2}>Net</td>
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
