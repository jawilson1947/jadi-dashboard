import { formatCount } from "@/lib/format";
import { SimpleReportTable, cell, type SimpleColumn } from "./SimpleReportTable";
import type { CurrentlyClearedTableRow, CurrentlyClearedView } from "@/server/services/reports";

const COLUMNS: SimpleColumn<CurrentlyClearedTableRow>[] = [
  { key: "classification", label: "Class" },
  // The raw code sits beside the bucket so anyone tracing a figure back to VIEW_OURM_STATS can see
  // both readings (R-D5). The displayed Class is the A-19 bucket, because this roster is read
  // alongside the dashboard and must agree with it.
  { key: "rawClassCode", label: "Code" },
  { key: "idnumber", label: "Student ID" },
  { key: "lastName", label: "Last name" },
  { key: "firstName", label: "First name" },
  { key: "dateCleared", label: "Date cleared", render: (r) => cell.date(r.dateCleared) },
  { key: "email", label: "Email", render: (r) => cell.text(r.email) },
];

/**
 * R6 — Currently Cleared.
 *
 * One row per student. The source script's `[rows] = 1` returns a single instance, which is all
 * that is required; the rewrite additionally orders by clearance date when choosing that instance,
 * so the date shown does not change between two refreshes for no visible reason.
 */
export function CurrentlyClearedReport({ view }: { view: CurrentlyClearedView }) {
  return (
    <>
      <section className="card" aria-labelledby="by-class">
        <h2 id="by-class" className="text-sm font-medium text-ink-2">
          Cleared by classification
        </h2>
        <ul className="flex flex-wrap gap-x-6 gap-y-1 mt-2 text-sm">
          {view.byClassification.map((c) => (
            <li key={c.code}>
              {c.name} <span className="tabular font-medium">{formatCount(c.students)}</span>
            </li>
          ))}
          <li className="ml-auto">
            Total <span className="tabular font-medium">{formatCount(view.totals.students)}</span>
          </li>
        </ul>
      </section>

      <SimpleReportTable
        rows={view.rows}
        columns={COLUMNS}
        rowKey={(r) => r.idnumber}
        caption="Financially cleared students for the current semester"
        emptyMessage="No clearance actions recorded for this term."
      />
    </>
  );
}
