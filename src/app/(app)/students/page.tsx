import Link from "next/link";
import { z } from "zod";
import { getPrincipal } from "@/server/auth/session";
import { requirePermission } from "@/server/authz/permissions";
import { audit } from "@/server/audit/audit";
import { optionalFilter } from "@/server/api/query";
import { NAME_MIN_LENGTH, SearchInputError, searchStudents, type StudentSearchResult } from "@/server/services/students";
import { formatCurrency } from "@/lib/format";
import { PageHeader } from "@/components/layout/PageHeader";
import { StudentSearchForm } from "@/components/students/StudentSearchForm";
import { StateIcon } from "@/components/students/StateIcon";

export const metadata = { title: "Student Lookup" };
export const dynamic = "force-dynamic";

const paramsSchema = z.object({
  by: z.enum(["name", "id"]).default("name"),
  last: optionalFilter(z.string().max(60)),
  first: optionalFilter(z.string().max(60)),
  id: optionalFilter(z.string().max(20)),
});

/**
 * Student Lookup (Spec §10.1, Bio Spec 1.1–1.3).
 *
 * The search bar is a GET form, so a result set is a link someone can send to a colleague. Guards
 * live in the service, not here: this page renders whatever the service refuses as a message next to
 * the field rather than as an error page.
 */
export default async function StudentLookupPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const principal = requirePermission(await getPrincipal(), "student.view");
  const q = paramsSchema.parse(await searchParams);
  const searched = q.by === "id" ? Boolean(q.id) : Boolean(q.last);

  let result: StudentSearchResult | null = null;
  let error: string | null = null;
  if (searched) {
    try {
      result = await searchStudents({ by: q.by, lastName: q.last, firstName: q.first, idnumber: q.id });
      await audit(principal, "student.search", {
        targetType: "studentSearch",
        metadata: { by: q.by, resultCount: result.rows.length, truncated: result.truncated, via: "page" },
      });
    } catch (err) {
      if (err instanceof SearchInputError) error = err.message;
      else throw err;
    }
  }

  return (
    <>
      <PageHeader title="Student Lookup" description="Search by name or student ID. Selecting a result opens the student's profile." />

      <StudentSearchForm current={{ by: q.by, last: q.last ?? "", first: q.first ?? "", id: q.id ?? "" }} minNameLength={NAME_MIN_LENGTH} error={error} />

      {result === null ? (
        <p className="text-sm text-ink-3">Enter a search above to begin. Nothing is loaded until you do.</p>
      ) : result.rows.length === 0 ? (
        <div className="card">
          <p className="text-sm">No students match that search.</p>
          <p className="text-xs text-ink-3 mt-1">Names are matched anywhere in the field, so a partial spelling is fine; IDs are matched from the start.</p>
        </div>
      ) : (
        <>
          {result.truncated ? (
            <div role="status" className="rounded-md border border-warning bg-surface-1 px-4 py-2 text-sm">
              <span aria-hidden>⚠</span> Showing the first {result.limit} matches. Narrow the search to see the rest.
            </div>
          ) : null}
          <div className="card p-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">Student search results</caption>
                <thead className="bg-surface-2 text-left">
                  <tr>
                    <th scope="col" className="px-3 py-2 font-medium text-ink-2">Status</th>
                    <th scope="col" className="px-3 py-2 font-medium text-ink-2">Student ID</th>
                    <th scope="col" className="px-3 py-2 font-medium text-ink-2">Last name</th>
                    <th scope="col" className="px-3 py-2 font-medium text-ink-2">First name</th>
                    <th scope="col" className="px-3 py-2 font-medium text-ink-2">Class</th>
                    <th scope="col" className="px-3 py-2 font-medium text-ink-2">Email</th>
                    <th scope="col" className="px-3 py-2 font-medium text-ink-2">Phone</th>
                    <th scope="col" className="px-3 py-2 font-medium text-ink-2">Last cleared</th>
                    <th scope="col" className="px-3 py-2 font-medium text-ink-2 text-right">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((r) => (
                    <tr key={r.idnumber} className="border-t border-border hover:bg-surface-2">
                      <td className="px-3 py-2"><StateIcon state={r.state} /></td>
                      <td className="px-3 py-2">
                        <Link href={`/students/${encodeURIComponent(r.idnumber)}`} className="underline hover:no-underline">
                          {r.idnumber}
                        </Link>
                      </td>
                      <td className="px-3 py-2">{r.lastName}</td>
                      <td className="px-3 py-2">{r.firstName}</td>
                      <td className="px-3 py-2">{r.classification}</td>
                      <td className="px-3 py-2">{r.email || "—"}</td>
                      <td className="px-3 py-2">{r.phone || "—"}</td>
                      <td className="px-3 py-2">{r.lastClearedLabel}</td>
                      <td className="px-3 py-2 text-right tabular">{formatCurrency(r.accountBalance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <p className="text-xs text-ink-3">
            A debit balance is money owed; a credit balance is money in the student&apos;s favour. Every profile opened from here is recorded in the audit log.
          </p>
        </>
      )}
    </>
  );
}
