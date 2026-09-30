import Link from "next/link";
import { formatCount, formatCurrency } from "@/lib/format";
import type { UnclassifiedView } from "@/server/services/reports";

/**
 * R1 — Unclassified Students.
 *
 * The subject of this report is the unknown classification, not the student (J. Wilson,
 * 2026-09-29), so it leads with a summary by code. A code like PS on eleven students is one fix,
 * not eleven problems, and a student-by-student list buries that entirely.
 *
 * Selection is on the RAW class code (R-D5). "Resolvable as" carries the A-19 reading, which is
 * what splits the list into records already answerable from TEL_WEB_GRP_CDE and records that need
 * someone to go and look.
 */
export function UnclassifiedReport({ view, group }: { view: UnclassifiedView; group: "all" | "resolvable" | "no-signal" }) {
  const rows = group === "all" ? view.rows : view.rows.filter((r) => r.group === group);

  return (
    <>
      <section className="card" aria-labelledby="code-summary">
        <div className="flex items-baseline justify-between gap-4">
          <h2 id="code-summary" className="text-sm font-medium text-ink-2">
            Unrecognised class codes
          </h2>
          <p className="text-sm text-ink-2">
            {formatCount(view.totals.students)} student{view.totals.students === 1 ? "" : "s"} ·{" "}
            {formatCount(view.totals.codes)} code{view.totals.codes === 1 ? "" : "s"}
          </p>
        </div>
        <table className="w-full text-sm mt-3">
          <caption className="sr-only">Unrecognised class codes and how many students carry each</caption>
          <thead className="text-left text-ink-2">
            <tr>
              <th scope="col" className="py-1 font-medium">Code</th>
              <th scope="col" className="py-1 font-medium text-right">Students</th>
              <th scope="col" className="py-1 font-medium text-right">Resolvable</th>
              <th scope="col" className="py-1 font-medium">&nbsp;</th>
            </tr>
          </thead>
          <tbody>
            {view.summary.map((s) => (
              <tr key={s.code || "(blank)"} className="border-t border-border">
                <th scope="row" className="py-1 font-mono font-normal">
                  {s.code === "" ? <span className="text-ink-3">(blank)</span> : s.code}
                </th>
                <td className="py-1 text-right tabular">{formatCount(s.students)}</td>
                <td className="py-1 text-right tabular">{formatCount(s.resolvable)}</td>
                <td className="py-1 text-xs text-ink-2">
                  {s.unknownCode ? (
                    <>
                      <span aria-hidden>⚠</span> not in the classification mapping table
                    </>
                  ) : s.students - s.resolvable > 0 ? (
                    <>{formatCount(s.students - s.resolvable)} need a lookup</>
                  ) : (
                    "all resolvable from the web group code"
                  )}
                </td>
              </tr>
            ))}
            {view.summary.length === 0 ? (
              <tr>
                <td colSpan={4} className="py-3 text-ink-2">
                  Every enrolled and cleared student carries a recognised class code.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>

      <div className="flex flex-wrap items-center gap-2 no-print">
        <span className="text-sm text-ink-2">Show:</span>
        {(
          [
            ["all", `All (${formatCount(view.totals.students)})`],
            ["no-signal", `Needs a lookup (${formatCount(view.totals.noSignal)})`],
            ["resolvable", `Resolvable (${formatCount(view.totals.resolvable)})`],
          ] as const
        ).map(([value, label]) => (
          <Link
            key={value}
            href={`/reports/unclassified?group=${value}`}
            aria-current={group === value ? "true" : undefined}
            className={`rounded-md border px-3 py-1 text-sm ${group === value ? "border-brand text-brand" : "border-border hover:bg-surface-2"}`}
          >
            {label}
          </Link>
        ))}
      </div>

      <div className="card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Students whose class code is missing or unrecognised</caption>
            <thead className="bg-surface-2 text-left">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium text-ink-2">Class code</th>
                <th scope="col" className="px-3 py-2 font-medium text-ink-2">Student ID</th>
                <th scope="col" className="px-3 py-2 font-medium text-ink-2">Last name</th>
                <th scope="col" className="px-3 py-2 font-medium text-ink-2">First name</th>
                <th scope="col" className="px-3 py-2 font-medium text-ink-2">Resolvable as</th>
                <th scope="col" className="px-3 py-2 font-medium text-ink-2">Status</th>
                <th scope="col" className="px-3 py-2 font-medium text-ink-2 text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.source}-${r.idnumber}`} className="border-t border-border">
                  <td className="px-3 py-2 font-mono">{r.classCode === "" ? <span className="text-ink-3">(blank)</span> : r.classCode}</td>
                  <td className="px-3 py-2">{r.idnumber}</td>
                  <td className="px-3 py-2">{r.lastName}</td>
                  <td className="px-3 py-2">{r.firstName}</td>
                  <td className="px-3 py-2">
                    {r.resolvableName ? (
                      r.resolvableName
                    ) : (
                      <span className="text-ink-3">needs a lookup</span>
                    )}
                  </td>
                  {/* Status is context, not a figure to reconcile against the dashboard: the cleared
                      branch of the source query reports 'Cleared' by construction. */}
                  <td className="px-3 py-2 text-ink-2">{r.status}</td>
                  <td className="px-3 py-2 text-right tabular">{formatCurrency(r.accountBalance)}</td>
                </tr>
              ))}
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-ink-2">
                    Nothing in this group.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card space-y-2 text-sm">
        <p>
          <strong>{formatCount(view.totals.noSignal)}</strong> need a human lookup ·{" "}
          <strong>{formatCount(view.totals.resolvable)}</strong> can be resolved from the web group code ·{" "}
          total debit balance <span className="tabular">{formatCurrency(view.totals.debitBalance)}</span>.
        </p>
        <details>
          <summary className="cursor-pointer text-ink-2">How this report is built</summary>
          <div className="mt-2 space-y-2 text-xs text-ink-2">
            <p>
              Students are selected on the <strong>raw</strong> class code from Student Master — any value outside
              AD, AE, EM, FF, FR, GR, JR, SO, SR, DI. The A-19 transfer rule is deliberately <em>not</em> applied to
              the selection: a student with a blank class code but web group code 22 would drop off this list while
              their class code is still unset, which is the defect the report exists to find.
            </p>
            <p>
              &ldquo;Resolvable as&rdquo; shows what the dashboard reports for that student under A-19. Where it says
              something, the correct classification is already in the data and only needs setting on the source record.
            </p>
            <p>
              The population covers students enrolled or cleared this term, which is what the source views hold.
              Status is incidental — the cleared branch of the query reports &ldquo;Cleared&rdquo; by construction.
            </p>
          </div>
        </details>
      </div>
    </>
  );
}
