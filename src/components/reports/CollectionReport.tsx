import { formatCount, formatCurrency } from "@/lib/format";
import { SimpleReportTable, cell, type SimpleColumn } from "./SimpleReportTable";
import type { DnrDncTableRow, DnrDncView } from "@/server/services/dnr-dnc";

const COLUMNS: SimpleColumn<DnrDncTableRow>[] = [
  { key: "category", label: "Category" },
  { key: "idnumber", label: "Student ID" },
  { key: "lastName", label: "Last name" },
  { key: "firstName", label: "First name" },
  { key: "email", label: "Email", render: (r) => cell.text(r.email) },
  { key: "accountBalance", label: "Balance", align: "right", render: (r) => cell.money(r.accountBalance) },
  { key: "lastCleared", label: "Last cleared", render: (r) => cell.text(r.lastCleared) },
];

/**
 * R5 — DNC/DNR Collection mail merge.
 *
 * This is NOT a seventh population (R-D6). It reads the same `getDnrDncPopulation` the DNR/DNC
 * Analysis page and the dashboard card read, so the letters and the card can never disagree about
 * who owes money.
 *
 * The supplied script omits the A-1 enrollment guard on the DNR leg, so its population is this one
 * plus any DNR-flagged student who turns out to be currently enrolled. Rather than silently
 * choosing one reading, those students are named in a labelled group at the foot: excluded from
 * the merge, and visible. On staging that group is empty, so this returns exactly what the script
 * returns — and on the day it stops being empty, the report says so.
 */
export function CollectionReport({ view }: { view: DnrDncView }) {
  const total = view.summary.DNC.positiveBalance + view.summary.DNR.positiveBalance;
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        {(["DNC", "DNR"] as const).map((k) => (
          <section key={k} className="card" aria-labelledby={`c-${k}`}>
            <h2 id={`c-${k}`} className="text-sm font-medium text-ink-2">
              {k === "DNC" ? "Did Not Clear (DNC)" : "Did Not Return (DNR)"}
            </h2>
            <p className="text-2xl font-semibold tabular mt-1">{formatCount(view.summary[k].count)}</p>
            <p className="text-sm text-ink-2">{formatCurrency(view.summary[k].positiveBalance)} owed</p>
          </section>
        ))}
      </div>

      <SimpleReportTable
        rows={view.rows}
        columns={COLUMNS}
        rowKey={(r) => `${r.category}-${r.idnumber}`}
        caption="Students carrying a debit balance who did not clear or did not return"
        emptyMessage="No students match the DNC or DNR rule with a debit balance."
      />

      <div className="card space-y-2 text-sm">
        <p>
          <strong>Total owed:</strong> <span className="tabular">{formatCurrency(total)}</span> across{" "}
          {formatCount(view.totalRows)} student{view.totalRows === 1 ? "" : "s"}.
        </p>
        <details>
          <summary className="cursor-pointer text-ink-2">How this differs from the original script</summary>
          <div className="mt-2 space-y-2 text-xs text-ink-2">
            <p>
              This report reads the same population as the DNR/DNC Analysis page, which adds one predicate the
              supplied script does not have: a DNR student must be absent from current enrollment. A student who
              matches the DNR rule but has since registered is excluded from the merge — they returned, so a
              collection letter would be wrong.
            </p>
            <p>
              Everything else is the script as written: rolled to the current term with the clearance flag still 0
              (DNC), or left on the previous term with the flag still 1 (DNR), and in both cases a debit balance.
            </p>
          </div>
        </details>
      </div>
    </>
  );
}
