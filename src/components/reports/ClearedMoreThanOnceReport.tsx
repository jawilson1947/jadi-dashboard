import { formatCount } from "@/lib/format";
import { cell } from "./SimpleReportTable";
import type { ClearedMoreThanOnceView } from "@/server/services/reports";

/**
 * R3 — Students Cleared More Than Once.
 *
 * Grouped by student rather than a flat list of actions: the finding is "this person was cleared
 * twice", and the actions are the evidence. Each action keeps its own date AND its own operator,
 * because on this report the pairing is the whole point — which is why the population is built
 * from every VIEW_OURM_CLEARED row for these students rather than from a MIN(date), MIN(user).
 */
export function ClearedMoreThanOnceReport({ view }: { view: ClearedMoreThanOnceView }) {
  return (
    <>
      <div className="card">
        <p className="text-sm">
          <strong>{formatCount(view.totals.students)}</strong> student{view.totals.students === 1 ? "" : "s"} with more than one
          clearance action this term, <strong>{formatCount(view.totals.actions)}</strong> actions in total.
        </p>
      </div>

      {view.groups.map((g) => (
        <section key={g.idnumber} className="card" aria-labelledby={`s-${g.idnumber}`}>
          <div className="flex flex-wrap items-baseline gap-x-3">
            <h2 id={`s-${g.idnumber}`} className="font-medium">
              {g.lastName}, {g.firstName}
            </h2>
            <span className="text-sm text-ink-2">{g.idnumber}</span>
            <span className="text-sm text-ink-2">{g.classification}</span>
            <span className="ml-auto text-sm text-ink-2">{formatCount(g.actionCount)} clearance actions</span>
          </div>
          <table className="w-full text-sm mt-2">
            <caption className="sr-only">Clearance actions for {g.idnumber}</caption>
            <thead className="text-left text-ink-2">
              <tr>
                <th scope="col" className="py-1 font-medium w-16">#</th>
                <th scope="col" className="py-1 font-medium">Date cleared</th>
                <th scope="col" className="py-1 font-medium">Cleared by</th>
              </tr>
            </thead>
            <tbody>
              {g.actions.map((a) => (
                <tr key={`${a.idnumber}-${a.actionNo}`} className="border-t border-border">
                  <td className="py-1 tabular">{a.actionNo}</td>
                  <td className="py-1">{cell.date(a.dateCleared)}</td>
                  <td className="py-1">{cell.text(a.clearedBy)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}

      {view.groups.length === 0 ? (
        <div className="card text-sm text-ink-2">No student has more than one clearance action this term.</div>
      ) : null}
    </>
  );
}
