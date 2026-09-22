import { z } from "zod";
import { getPrincipal } from "@/server/auth/session";
import { hasPermission, requirePermission } from "@/server/authz/permissions";
import { audit } from "@/server/audit/audit";
import { getConfig } from "@/server/db/config";
import { getDnrDncView, type DnrDncTableRow } from "@/server/services/dnr-dnc";
import { formatCount, formatCurrency, formatDateTime } from "@/lib/format";
import { PageHeader } from "@/components/layout/PageHeader";
import { PrintButton } from "@/components/print/PrintButton";
import { PrintHeader } from "@/components/print/PrintHeader";
import { DataTable, type Column } from "@/components/tables/DataTable";
import { DnrDncFilters } from "@/components/dnr-dnc/DnrDncFilters";
import { ExportCsvButton } from "@/components/dnr-dnc/ExportCsvButton";
import { optionalFilter } from "@/server/api/query";

export const metadata = { title: "DNR / DNC Analysis" };
export const dynamic = "force-dynamic";

// The filter bar is a GET form: an untouched field arrives as "" (e.g. ?category=), which must mean "no filter".
const paramsSchema = z.object({
  category: optionalFilter(z.enum(["DNR", "DNC"])),
  classification: optionalFilter(z.string().max(10)),
  lastCleared: optionalFilter(z.string().max(50)),
  minBalance: optionalFilter(z.coerce.number().min(0)),
  maxBalance: optionalFilter(z.coerce.number().min(0)),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(10).max(200).default(50),
  sort: z.enum(["default", "category", "classification", "lastName", "firstName", "accountBalance", "idnumber", "lastCleared"]).default("default"),
  direction: z.enum(["asc", "desc"]).default("asc"),
});

const COLUMNS: Column<DnrDncTableRow>[] = [
  { key: "category", label: "Category", sortable: true },
  { key: "classificationCode", label: "Class", sortable: true, sortKey: "classification", render: (r) => `${r.classificationCode} — ${r.classification}` },
  { key: "idnumber", label: "Student ID", sortable: true },
  { key: "lastName", label: "Last name", sortable: true },
  { key: "firstName", label: "First name", sortable: true },
  { key: "accountBalance", label: "Balance", sortable: true, align: "right", render: (r) => formatCurrency(r.accountBalance) },
  { key: "email", label: "Email" },
  { key: "lastCleared", label: "Last cleared", sortable: true, render: (r) => r.lastCleared ?? "—" },
  { key: "enrolledCurrentTerm", label: "Enrolled now", render: (r) => (r.enrolledCurrentTerm ? "Yes" : "No") },
  { key: "clearedCurrentSession", label: "Cleared now", render: (r) => (r.clearedCurrentSession ? "Yes" : "No") },
];

/**
 * DNR/DNC Analysis (Spec §8). Student-level, so it requires student.view and every view is audited.
 * Definitions are A-1's; the rule is documented on the page itself rather than only in the repo.
 */
export default async function DnrDncPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const principal = requirePermission(await getPrincipal(), "student.view");
  const q = paramsSchema.parse(await searchParams);
  const filter = { category: q.category, classification: q.classification, lastCleared: q.lastCleared, minBalance: q.minBalance, maxBalance: q.maxBalance };
  const view = await getDnrDncView({ filter, page: q.page, pageSize: q.pageSize, sort: q.sort, direction: q.direction });
  const tz = getConfig().APP_TIMEZONE;
  const canExport = hasPermission(principal, "export.create");

  await audit(principal, "student.list_view", {
    targetType: "dnrDnc",
    targetId: view.term.current,
    metadata: { rowsReturned: view.rows.length, totalRows: view.totalRows, page: q.page, category: q.category ?? "all", classification: q.classification ?? "all", via: "page" },
  });

  const query = new URLSearchParams();
  for (const [k, v] of Object.entries({ category: q.category, classification: q.classification, lastCleared: q.lastCleared, minBalance: q.minBalance, maxBalance: q.maxBalance })) {
    if (v !== undefined && v !== "") query.set(k, String(v));
  }
  const filtersApplied = [...query.keys()].length > 0;

  return (
    <>
      <PageHeader
        title="DNR / DNC Analysis"
        description={`Current semester ${view.term.label}; DNR looks at the previous one · live read at ${formatDateTime(view.source.readAt, tz)}`}
        actions={
          <span className="flex items-center gap-3">
            {canExport ? <ExportCsvButton query={query.toString()} sort={q.sort} direction={q.direction} rowCount={view.totalRows} /> : null}
            <PrintButton />
          </span>
        }
      />
      <PrintHeader
        title="DNR / DNC Analysis"
        subtitle={filtersApplied ? `Filtered: ${[...query.entries()].map(([k, v]) => `${k}=${v}`).join(", ")}` : "All DNR and DNC students carrying a debit balance"}
        semester={view.term.label}
        capturedAt={view.source.readAt}
        printedBy={principal.displayName}
        timeZone={tz}
        rows={`${formatCount(view.totalRows)} students · ${formatCurrency(view.filteredReceivable)}`}
      />

      {view.capped ? (
        <div role="status" className="rounded-md border border-warning bg-surface-1 px-4 py-2 text-sm">
          <span aria-hidden>⚠</span> The population hit the {formatCount(5000)}-row safety cap, so these totals are incomplete. Tell an administrator — the DNR/DNC rule is meant to return
          hundreds of rows, not thousands.
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 print-stack">
        {(["DNC", "DNR"] as const).map((key) => (
          <section key={key} className="card" aria-labelledby={`card-${key}`}>
            <h2 id={`card-${key}`} className="text-sm font-medium text-ink-2">
              {key === "DNC" ? "Did Not Clear (DNC)" : "Did Not Return (DNR)"}
            </h2>
            <p className="text-2xl font-semibold tabular mt-1">{formatCount(view.summary[key].count)}</p>
            <p className="text-sm text-ink-2">{formatCurrency(view.summary[key].positiveBalance)} owed</p>
            <p className="text-xs text-ink-3 mt-2">
              {key === "DNC"
                ? "Rolled to the current term, clearance flag still 0, debit balance owing."
                : "Left on the previous term with the flag still 1, absent from current enrollment, debit balance owing."}
            </p>
          </section>
        ))}
      </div>

      <DnrDncFilters options={view.filterOptions} current={{ ...filter, sort: q.sort, direction: q.direction, pageSize: q.pageSize }} />

      <DataTable
        rows={view.rows}
        columns={COLUMNS}
        rowKey={(r) => `${r.category}-${r.idnumber}`}
        page={view.page}
        pageSize={view.pageSize}
        totalRows={view.totalRows}
        sort={{ field: q.sort, direction: q.direction }}
        baseHref={`/dnr-dnc?${query.toString()}`}
        caption={`DNR/DNC students — page ${view.page}`}
        emptyMessage="No students match these filters."
      />

      <div className="card space-y-2">
        <p className="text-sm">
          <strong>Total debit balances for the filtered population:</strong>{" "}
          <span className="tabular">{formatCurrency(view.filteredReceivable)}</span> across {formatCount(view.totalRows)} student{view.totalRows === 1 ? "" : "s"}
          {filtersApplied ? " (filtered)" : ""}.
        </p>
        <details className="text-sm">
          <summary className="cursor-pointer text-ink-2">How these two populations are defined, and why nobody is counted twice</summary>
          <div className="mt-2 space-y-2 text-ink-2 text-xs">
            <p>
              Both come from one row per student in the student table, keyed on the student ID — a student appears once, in one category, so the two cards never double-count and the
              receivable total never adds the same balance twice.
            </p>
            <p>
              <strong>DNC</strong>: last cleared in the current semester ({view.term.label}) with the current-session clearance flag still 0.{" "}
              <strong>DNR</strong>: last cleared in the previous semester, the flag is 1, and the student is <em>not</em> present in current enrollment — that absence is verified against
              the enrollment view rather than inferred from the flag. A semester means both its Traditional and LEAP identifiers; the two are never counted separately here.
            </p>
            <p>
              Both require a debit balance: money owed is the only indicator of interest (A-1, 2026-09-17). The unfiltered populations without that condition are larger
              and appear nowhere in this application.
            </p>
            <p>Student profiles arrive in Phase 5; until then these rows are the detail.</p>
          </div>
        </details>
      </div>
    </>
  );
}
