import { formatCount, formatCurrency } from "@/lib/format";
import { SimpleReportTable, cell, type SimpleColumn } from "./SimpleReportTable";
import type { EnrolleeBalanceTableRow, EnrolleeBalanceView } from "@/server/services/reports";

const COLUMNS: SimpleColumn<EnrolleeBalanceTableRow>[] = [
  { key: "idnumber", label: "Student ID" },
  { key: "classification", label: "Class" },
  { key: "lastName", label: "Last name" },
  { key: "firstName", label: "First name" },
  { key: "accountBalance", label: "Balance", align: "right", render: (r) => cell.money(r.accountBalance) },
  { key: "email", label: "Email", render: (r) => cell.text(r.email) },
];

/**
 * R4 — Enrollee Account Balance.
 *
 * The supplied script's `between ? and ?` becomes this form. The captured population is every
 * not-cleared enrollee carrying a debit balance; the range filters it here, so one nightly capture
 * serves whatever range is typed and the count under the form always matches the table below it.
 *
 * The balance being filtered is LIVE (A-30), so the range selects what a student owes now, not
 * what they owed when the population was captured. On a collection tool that is the behaviour you
 * want, and it means a student can leave the range between two page loads.
 */
export function EnrolleeBalanceReport({ view }: { view: EnrolleeBalanceView }) {
  const unbounded = view.range.max === Number.MAX_SAFE_INTEGER;
  return (
    <>
      <form method="get" className="card flex flex-wrap items-end gap-4 no-print">
        <div>
          <label htmlFor="minBalance" className="block text-sm text-ink-2">
            Balance from
          </label>
          <input
            id="minBalance"
            name="minBalance"
            type="number"
            step="0.01"
            min="0"
            defaultValue={view.range.min}
            className="mt-1 rounded-md border border-border bg-surface-1 px-3 py-2 text-sm w-40"
          />
        </div>
        <div>
          <label htmlFor="maxBalance" className="block text-sm text-ink-2">
            to
          </label>
          <input
            id="maxBalance"
            name="maxBalance"
            type="number"
            step="0.01"
            min="0"
            defaultValue={unbounded ? "" : view.range.max}
            placeholder="no upper limit"
            className="mt-1 rounded-md border border-border bg-surface-1 px-3 py-2 text-sm w-40"
          />
        </div>
        <button type="submit" className="rounded-md border border-brand text-brand px-4 py-2 text-sm hover:bg-brand-track">
          Apply
        </button>
        <p className="text-sm text-ink-2">
          {formatCount(view.totals.students)} of {formatCount(view.populationSize)} not-cleared enrollees with a debit balance
          {view.bounds ? (
            <>
              {" "}
              · population runs {formatCurrency(view.bounds.min)}–{formatCurrency(view.bounds.max)}
            </>
          ) : null}
        </p>
      </form>

      <SimpleReportTable
        rows={view.rows}
        columns={COLUMNS}
        rowKey={(r) => r.idnumber}
        caption="Not-cleared enrollees within the selected balance range"
        emptyMessage="No students owe a balance in this range."
      />

      <div className="card text-sm">
        <strong>Total for this range:</strong>{" "}
        <span className="tabular">{formatCurrency(view.totals.debitBalance)}</span> across{" "}
        {formatCount(view.totals.students)} student{view.totals.students === 1 ? "" : "s"}. Balances are read live; the
        population of not-cleared enrollees is as of the capture time above.
      </div>
    </>
  );
}
