import Link from "next/link";
import { formatCount, formatCurrency, formatIsoDateSafe } from "@/lib/format";
import { GroupedColumnChart } from "@/components/charts/Charts";
import type { FreshmanTermGroup, FreshmanView } from "@/server/services/reports";

/**
 * R2 — Freshman Classification Analysis.
 *
 * The anomaly is cCode ≠ the derived cClass, and it is a WARNING rather than a defect: one remedy
 * is changing SemesterBegins in tblOUSA (R-D7). A bare mismatch count cannot tell those two apart,
 * so the page leads with the distribution of record creation around the boundary. Mismatches
 * bunched against the line mean the date is wrong; mismatches scattered across the range mean the
 * records are.
 *
 * The what-if is arithmetic over data already on the page — DateCreated is in the captured
 * population — so pricing a candidate boundary costs a loop rather than another query.
 *
 * The report covers the current AND previous semester (R-D2a), and each has its own SemesterBegins
 * in tblOUSA. So there is one boundary panel per term rather than one for the report: a combined
 * chart would need a single line, and no single date is the boundary for both populations.
 */
export function FreshmanReport({ view, mismatchesOnly }: { view: FreshmanView; mismatchesOnly: boolean }) {
  const rows = mismatchesOnly ? view.rows.filter((r) => r.mismatch) : view.rows;

  return (
    <>
      {view.terms.map((term) => (
        <TermBoundary key={term.semesterName} term={term} />
      ))}

      <div className="flex flex-wrap items-center gap-2 no-print">
        <Link
          href="/reports/freshman-analysis"
          aria-current={mismatchesOnly ? undefined : "true"}
          className={`rounded-md border px-3 py-1 text-sm ${mismatchesOnly ? "border-border hover:bg-surface-2" : "border-brand text-brand"}`}
        >
          All ({formatCount(view.rows.length)})
        </Link>
        <Link
          href="/reports/freshman-analysis?mismatchesOnly=1"
          aria-current={mismatchesOnly ? "true" : undefined}
          className={`rounded-md border px-3 py-1 text-sm ${mismatchesOnly ? "border-brand text-brand" : "border-border hover:bg-surface-2"}`}
        >
          Mismatches only ({formatCount(view.mismatches)})
        </Link>
      </div>

      <div className="card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Freshman records with class code, web group code and derived class</caption>
            <thead className="bg-surface-2 text-left">
              <tr>
                {["Semester", "Class", "Student ID", "Last name", "First name", "Web code", "Most recent year", "Created", "Derived", "Mismatch"].map((h) => (
                  <th key={h} scope="col" className="px-3 py-2 font-medium text-ink-2 whitespace-nowrap">
                    {h}
                  </th>
                ))}
                <th scope="col" className="px-3 py-2 font-medium text-ink-2 text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.semesterName}:${r.idnumber}`} className="border-t border-border">
                  <td className="px-3 py-2 whitespace-nowrap">{r.semesterName}</td>
                  <td className="px-3 py-2 font-mono">{r.classCode}</td>
                  <td className="px-3 py-2">{r.idnumber}</td>
                  <td className="px-3 py-2">{r.lastName}</td>
                  <td className="px-3 py-2">{r.firstName}</td>
                  <td className="px-3 py-2">{r.webCode ?? "—"}</td>
                  <td className="px-3 py-2">{r.mostRecentYearEnrolled ?? "—"}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{r.dateCreated ? formatIsoDateSafe(r.dateCreated.toISOString().slice(0, 10)) : "—"}</td>
                  <td className="px-3 py-2 font-mono">{r.derivedClass}</td>
                  <td className="px-3 py-2">
                    {r.mismatch ? (
                      <span className="text-warning">
                        <span aria-hidden>⚠</span> Warning
                      </span>
                    ) : (
                      <span className="text-ink-3">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular">{formatCurrency(r.accountBalance)}</td>
                </tr>
              ))}
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-3 py-6 text-center text-ink-2">
                    No records.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

/**
 * One semester's boundary panel. Rendered once per term because SemesterBegins is a per-term
 * column: the remedy R-D7 describes ("change the SemesterBeginDate in tblOUSA") is a change to ONE
 * of these rows, so the what-if has to say which term it is pricing.
 */
function TermBoundary({ term }: { term: FreshmanTermGroup }) {
  const beginsIso = term.semesterBegins ? term.semesterBegins.toISOString().slice(0, 10) : null;
  const current = term.whatIf.find((w) => w.date === beginsIso);

  return (
    <section className="card" aria-labelledby={`boundary-${slug(term.semesterName)}`}>
      <h2 id={`boundary-${slug(term.semesterName)}`} className="text-sm font-medium text-ink-2">
        Record creation around the semester start — {term.semesterName}
        <span className="ml-2 inline-flex rounded-full border border-border px-2 py-0.5 text-xs text-ink-2">
          {term.isCurrentTerm ? "current" : "previous"}
        </span>
      </h2>
      <p className="text-sm mt-1">
        <strong>{formatCount(term.mismatches)}</strong> of {formatCount(term.students)} freshman records disagree with the
        class derived from{" "}
        {beginsIso ? (
          <strong>SemesterBegins {formatIsoDateSafe(beginsIso)}</strong>
        ) : (
          <>the semester start, which is not set</>
        )}
        .
      </p>

      {term.buckets.length > 0 ? (
        <div className="mt-3">
          <GroupedColumnChart
            groups={term.buckets.map((b) => ({
              label: b.containsBoundary ? `${b.weekOf} ◂ start` : b.weekOf,
              values: [b.created - b.mismatches, b.mismatches],
            }))}
            seriesNames={["Agrees", "Mismatch"]}
            title={`Freshman records created per week, mismatches shaded — ${term.semesterName}`}
            description={`Records created each week in ${term.semesterName}, split into those whose class code agrees with the derived class and those that do not. The week containing that semester's start is marked. Mismatches clustered at the start date suggest the date is wrong; mismatches spread across the range suggest individual records are.`}
          />
        </div>
      ) : null}

      {term.whatIf.length > 0 ? (
        <div className="mt-4">
          <h3 className="text-sm font-medium text-ink-2">If {term.semesterName}&apos;s semester start moved</h3>
          <table className="text-sm mt-2">
            <caption className="sr-only">Mismatch count at candidate semester start dates for {term.semesterName}</caption>
            <thead className="text-left text-ink-2">
              <tr>
                <th scope="col" className="pr-6 py-1 font-medium">Semester start</th>
                <th scope="col" className="py-1 font-medium text-right">Mismatches</th>
              </tr>
            </thead>
            <tbody>
              {term.whatIf.map((w) => (
                <tr key={w.date} className="border-t border-border">
                  <th scope="row" className="pr-6 py-1 font-normal">
                    {w.date}
                    {current && w.date === current.date ? <span className="text-ink-3"> · current</span> : null}
                  </th>
                  <td className="py-1 text-right tabular">{formatCount(w.mismatches)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-ink-3 mt-3 max-w-3xl">
            <span aria-hidden>⚠</span> <strong>SemesterBegins is not this report&apos;s setting.</strong> It lives on{" "}
            <code>tblOUSA</code>&apos;s {term.semesterName} row, is edited in the legacy JADI setup site rather than here
            (A-20), and is read by term metadata and the historical academic-year pairing. Changing it to quiet this
            report will move those too — and only for this semester; the other term&apos;s figures above are unaffected.
          </p>
        </div>
      ) : null}
    </section>
  );
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "term";
}
