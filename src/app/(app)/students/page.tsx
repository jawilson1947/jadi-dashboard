import Link from "next/link";
import { z } from "zod";
import { getPrincipal } from "@/server/auth/session";
import { requirePermission } from "@/server/authz/permissions";
import { audit } from "@/server/audit/audit";
import { optionalFilter } from "@/server/api/query";
import {
  NAME_MIN_LENGTH,
  PAGE_SIZE_DEFAULT,
  PAGE_SIZE_OPTIONS,
  SearchInputError,
  searchStudents,
  type StudentSearchResult,
  type StudentSearchResultRow,
} from "@/server/services/students";
import { formatCurrency } from "@/lib/format";
import { PageHeader } from "@/components/layout/PageHeader";
import { StudentSearchForm } from "@/components/students/StudentSearchForm";
import { StateIcon, STATE_LEGEND } from "@/components/students/StateIcon";
import { DataTable, type Column } from "@/components/tables/DataTable";

export const metadata = { title: "Student Lookup" };
export const dynamic = "force-dynamic";

const paramsSchema = z.object({
  by: z.enum(["name", "id"]).default("name"),
  last: optionalFilter(z.string().max(60)),
  first: optionalFilter(z.string().max(60)),
  id: optionalFilter(z.string().max(20)),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce
    .number()
    .int()
    .refine((n): n is (typeof PAGE_SIZE_OPTIONS)[number] => (PAGE_SIZE_OPTIONS as readonly number[]).includes(n))
    .catch(PAGE_SIZE_DEFAULT),
});

/**
 * Columns are deliberately not sortable. The provider already returns last name, first name, ID
 * order, and a sort control here would have to sort the fetched page set rather than the whole
 * match — an affordance that lies about its scope is worse than none.
 */
const COLUMNS: Column<StudentSearchResultRow>[] = [
  { key: "state", label: "Status", render: (r) => <StateIcon state={r.state} /> },
  {
    key: "idnumber",
    label: "Student ID",
    render: (r) => (
      <Link href={`/students/${encodeURIComponent(r.idnumber)}`} className="underline hover:no-underline">
        {r.idnumber}
      </Link>
    ),
  },
  { key: "lastName", label: "Last name" },
  { key: "firstName", label: "First name" },
  { key: "classification", label: "Class" },
  { key: "email", label: "Email", render: (r) => r.email || "—" },
  { key: "phone", label: "Phone", render: (r) => r.phone || "—" },
  { key: "lastClearedLabel", label: "Last Semester" },
  { key: "accountBalance", label: "Balance", align: "right", render: (r) => formatCurrency(r.accountBalance) },
];

/**
 * Student Lookup (Spec §10.1, Bio Spec 1.1–1.3).
 *
 * The search bar is a GET form, so a result set — and now a particular page of it — is a link
 * someone can send to a colleague. Guards live in the service, not here: this page renders whatever
 * the service refuses as a message next to the field rather than as an error page.
 */
export default async function StudentLookupPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const principal = requirePermission(await getPrincipal(), "student.view");
  const q = paramsSchema.parse(await searchParams);
  const searched = q.by === "id" ? Boolean(q.id) : Boolean(q.last);

  let result: StudentSearchResult | null = null;
  let error: string | null = null;
  if (searched) {
    try {
      result = await searchStudents({ by: q.by, lastName: q.last, firstName: q.first, idnumber: q.id, page: q.page, pageSize: q.pageSize });
      await audit(principal, "student.search", {
        targetType: "studentSearch",
        // The page number is part of the search's shape; the rows themselves are never recorded.
        metadata: { by: q.by, resultCount: result.totalRows, truncated: result.truncated, page: result.page, pageSize: result.pageSize, via: "page" },
      });
    } catch (err) {
      if (err instanceof SearchInputError) error = err.message;
      else throw err;
    }
  }

  // The pager appends its own page/pageSize, so the base href carries only the search terms.
  const query = new URLSearchParams({ by: q.by });
  for (const [k, v] of Object.entries({ last: q.last, first: q.first, id: q.id })) {
    if (v !== undefined && v !== "") query.set(k, String(v));
  }

  return (
    <>
      <PageHeader title="Student Lookup" description="Search by name or student ID. Selecting a result opens the student's profile." />

      <StudentSearchForm
        current={{ by: q.by, last: q.last ?? "", first: q.first ?? "", id: q.id ?? "", pageSize: q.pageSize }}
        minNameLength={NAME_MIN_LENGTH}
        pageSizeOptions={PAGE_SIZE_OPTIONS}
        error={error}
      />

      {result === null ? (
        <p className="text-sm text-ink-3">Enter a search above to begin. Nothing is loaded until you do.</p>
      ) : result.totalRows === 0 ? (
        <div className="card">
          <p className="text-sm">No students match that search.</p>
          <p className="text-xs text-ink-3 mt-1">Names are matched anywhere in the field, so a partial spelling is fine; IDs are matched from the start.</p>
        </div>
      ) : (
        <>
          {result.truncated ? (
            <div role="status" className="rounded-md border border-warning bg-surface-1 px-4 py-2 text-sm">
              <span aria-hidden>⚠</span> This search hit the {result.limit}-match ceiling, so the pages below are the first {result.limit} matches, not every one. Narrow the search to
              see the rest.
            </div>
          ) : null}

          <DataTable
            rows={result.rows}
            columns={COLUMNS}
            rowKey={(r) => r.idnumber}
            page={result.page}
            pageSize={result.pageSize}
            totalRows={result.totalRows}
            baseHref={`/students?${query.toString()}`}
            caption={`Student search results — page ${result.page} of ${result.pageCount}`}
            emptyMessage="No students match that search."
          />

          <p className="text-xs text-ink-3">{STATE_LEGEND}</p>
          <p className="text-xs text-ink-3">
            A debit balance is money owed; a credit balance is money in the student&apos;s favour. Every profile opened from here is recorded in the audit log.
          </p>
        </>
      )}
    </>
  );
}
