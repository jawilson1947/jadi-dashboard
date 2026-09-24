import type { PaymentAnalysis } from "@/server/services/payment-analysis";
import { formatCurrency, formatIsoDateSafe, formatPercent } from "@/lib/format";
import { CollectionNoticeButton } from "./CollectionNoticeButton";

/**
 * Bio Spec card 3 — payment analysis on a debit-balance account.
 *
 * Every ratio carries the number of transactions behind it: "100% financial aid" over two
 * transactions is a different claim from the same figure over forty, and the card says which.
 * The aging bars have a companion table by construction — the bar IS the table row — so the
 * information is never only in the geometry (Spec §5).
 */
export function PaymentAnalysisCard({ analysis, studentId }: { analysis: PaymentAnalysis; studentId: string }) {
  const max = Math.max(...analysis.aging.map((b) => b.amount), 1);
  return (
    <section className="card space-y-4" aria-label="Payment analysis">
      {analysis.collectionsRecommended ? (
        <div role="status" className="rounded-md border border-warning bg-surface-1 px-4 py-3 text-sm space-y-1">
          <p>
            <span aria-hidden>⚠</span> <strong>Collections cue:</strong> the last payment was {analysis.daysSinceLastCredit} days ago
            {analysis.lastCreditOn ? ` (${formatIsoDateSafe(analysis.lastCreditOn)})` : ""} and {formatCurrency(analysis.balance)} is still owed.
          </p>
          <p className="text-xs text-ink-2">
            This is an analyst cue, not an eligibility or collections determination — a person decides what happens next.
          </p>
          <CollectionNoticeButton studentId={studentId} />
        </div>
      ) : analysis.noCreditsOnFile ? (
        <p className="text-sm text-ink-2">No payments or credits have ever been recorded on this account.</p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Total charges (debits)" value={formatCurrency(analysis.totalDebits)} />
        <Stat label="Total credits" value={formatCurrency(analysis.totalCredits)} hint={`${analysis.creditCount} of ${analysis.transactionCount} transactions`} />
        <Stat
          label="Last payment or credit"
          value={analysis.lastCreditOn ? formatIsoDateSafe(analysis.lastCreditOn) : "None on file"}
          hint={analysis.daysSinceLastCredit !== null ? `${analysis.daysSinceLastCredit} days ago` : undefined}
        />
        <Stat label="Paid by cash or card" value={formatPercent(analysis.cashRatio)} hint={`of ${formatCurrency(analysis.totalCredits)} in credits`} />
        <Stat label="Covered by financial aid" value={formatPercent(analysis.financialAidRatio)} hint={`of ${formatCurrency(analysis.totalCredits)} in credits`} />
        <Stat label="Unpaid after credits applied" value={formatCurrency(analysis.outstanding)} hint="Credits applied to the oldest charges first" />
      </div>

      <div>
        <h3 className="text-sm font-medium text-ink-2 mb-2">Age of the unpaid balance</h3>
        <table className="w-full text-sm">
          <caption className="sr-only">Unpaid balance by age bucket</caption>
          <thead className="sr-only">
            <tr><th scope="col">Bucket</th><th scope="col">Amount</th><th scope="col">Transactions</th></tr>
          </thead>
          <tbody>
            {analysis.aging.map((b) => (
              <tr key={b.label} className="border-t border-border">
                <th scope="row" className="py-2 pr-3 text-left font-normal whitespace-nowrap">{b.label}</th>
                <td className="py-2 w-full">
                  <span className="block h-2 rounded bg-brand" style={{ width: `${Math.round((b.amount / max) * 100)}%` }} aria-hidden />
                </td>
                <td className="py-2 pl-3 text-right tabular whitespace-nowrap">{formatCurrency(b.amount)}</td>
                <td className="py-2 pl-3 text-right tabular text-ink-3 whitespace-nowrap">{b.transactions}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-ink-3">
        Balance on record: {formatCurrency(analysis.balance)}.{" "}
        {Math.abs(analysis.reconciliationDifference) < 0.01
          ? "The transaction history adds up to exactly that figure."
          : `The transaction history adds up to ${formatCurrency(analysis.totalDebits - analysis.totalCredits)}, a difference of ${formatCurrency(
              analysis.reconciliationDifference,
            )}. The balance column is authoritative (A-18); the difference is shown rather than hidden, because a collection notice should never quote a figure nobody has reconciled.`}
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
