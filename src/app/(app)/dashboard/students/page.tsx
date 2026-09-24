import Link from "next/link";
import { z } from "zod";
import { getPrincipal } from "@/server/auth/session";
import { requirePermission } from "@/server/authz/permissions";
import { audit } from "@/server/audit/audit";
import { getDrillDown } from "@/server/services/dashboard";
import { formatCount, formatCurrency } from "@/lib/format";
import { PageHeader } from "@/components/layout/PageHeader";
import { DataTable, type Column } from "@/components/tables/DataTable";
import type { DrillDownRow } from "@/server/services/dashboard";
import { getCurrentTerms } from "@/server/metadata/terms";
import { getConfig } from "@/server/db/config";
import { PrintAllRowsButton, type PrintColumn } from "@/components/print/PrintAllRowsButton";
import { PrintHeader } from "@/components/print/PrintHeader";

export const metadata = { title: "Student detail" };
export const dynamic = "force-dynamic";

const paramsSchema = z.object({
  population: z.enum(["enrolled", "cleared", "notCleared", "receivable", "dnc", "dnr"]).default("enrolled"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(10).max(200).default(50),
  sort: z.enum(["lastName", "firstName", "accountBalance", "classificationCode", "status", "idnumber"]).default("lastName"),
  direction: z.enum(["asc", "desc"]).default("asc"),
});

const TITLES: Record<string, string> = {
  enrolled: "Enrolled students",
  cleared: "Financially cleared students",
  notCleared: "Students not financially cleared",
  receivable: "Students with debit balances (current terms)",
  dnc: "Did Not Clear (DNC)",
  dnr: "Did Not Return (DNR)",
};

const COLUMNS: Column<DrillDownRow>[] = [
  { key: "idnumber", label: "Student ID", sortable: true },
  { key: "lastName", label: "Last name", sortable: true },
  { key: "firstName", label: "First name", sortable: true },
  { key: "classification", label: "Classification", sortable: true, sortKey: "classificationCode" },
  { key: "status", label: "Clearance", sortable: true },
  { key: "accountBalance", label: "Balance", sortable: true, align: "right", render: (r) => formatCurrency(r.accountBalance) },
  { key: "lastCleared", label: "Last Semester", render: (r) => r.lastCleared ?? "—" },
  { key: "clearedBy", label: "Cleared by", render: (r) => r.clearedBy ?? "—" },
  { key: "email", label: "Email" },
];

/** Serializable column spec for the print-all-rows table (formatting happens client-side). */
const PRINT_COLUMNS: PrintColumn[] = [
  { key: "idnumber", label: "Student ID" },
  { key: "lastName", label: "Last name" },
  { key: "firstName", label: "First name" },
  { key: "classification", label: "Classification" },
  { key: "status", label: "Clearance" },
  { key: "accountBalance", label: "Balance", align: "right", format: "currency" },
  { key: "lastCleared", label: "Last Semester" },
  { key: "clearedBy", label: "Cleared by" },
  { key: "email", label: "Email" },
];

/** Drill-down table behind every hero number (Spec §5, §6.1). Requires student.view. */
export default async function DrillDownPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const principal = requirePermission(await getPrincipal(), "student.view");
  const q = paramsSchema.parse(await searchParams);
  const page = await getDrillDown(q.population, { page: q.page, pageSize: q.pageSize, sort: { field: q.sort, direction: q.direction } });
  const terms = await getCurrentTerms().catch(() => null);
  const tz = getConfig().APP_TIMEZONE;
  await audit(principal, "student.list_view", {
    targetType: "population",
    targetId: q.population,
    metadata: { page: q.page, pageSize: q.pageSize, rowsReturned: page.rows.length, totalRows: page.totalRows, via: "page" },
  });

  return (
    <>
      <PageHeader
        title={TITLES[q.population]}
        description={`${formatCount(page.totalRows)} students · filter: population = ${q.population}`}
        actions={
          <span className="flex items-center gap-3">
            <PrintAllRowsButton population={q.population} sort={q.sort} direction={q.direction} columns={PRINT_COLUMNS} totalRows={page.totalRows} />
            <Link href="/dashboard" className="text-sm text-brand no-print">
              ← Back to dashboard
            </Link>
          </span>
        }
      />
      <PrintHeader title={TITLES[q.population]} subtitle={`Population: ${q.population} · sorted by ${q.sort} ${q.direction}`} semester={terms?.label ?? "—"} printedBy={principal.displayName} timeZone={tz} rows={`${formatCount(page.totalRows)} students (live read at print time)`} />
      <DataTable
        rows={page.rows}
        columns={COLUMNS}
        rowKey={(r) => r.idnumber}
        page={page.page}
        pageSize={page.pageSize}
        totalRows={page.totalRows}
        sort={{ field: q.sort, direction: q.direction }}
        baseHref={`/dashboard/students?population=${q.population}`}
        caption={`${TITLES[q.population]} — page ${page.page}`}
        emptyMessage="No students match this population."
      />
    </>
  );
}
