import Link from "next/link";
import { z } from "zod";
import { getPrincipal } from "@/server/auth/session";
import { requirePermission } from "@/server/authz/permissions";
import { audit } from "@/server/audit/audit";
import { getConfig } from "@/server/db/config";
import { getCurrentSprintWindow, getSprintDrillDown, type SprintStudentRow } from "@/server/services/sprint";
import { classificationDisplayName } from "@/server/metadata/classifications";
import { formatCount, formatCurrency, formatDateTime } from "@/lib/format";
import { formatIsoDate, isIsoDate } from "@/lib/dates";
import { PageHeader } from "@/components/layout/PageHeader";
import { PrintHeader } from "@/components/print/PrintHeader";
import { DataTable, type Column } from "@/components/tables/DataTable";

export const metadata = { title: "Sprint detail" };
export const dynamic = "force-dynamic";

const paramsSchema = z.object({
  date: z.string().refine(isIsoDate, "expected YYYY-MM-DD").optional(),
  operator: z.string().max(100).optional(),
  classification: z.string().max(10).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(10).max(200).default(50),
  sort: z.enum(["lastName", "firstName", "accountBalance", "classificationCode", "idnumber", "clearedAt"]).default("lastName"),
  direction: z.enum(["asc", "desc"]).default("asc"),
});

const COLUMNS: Column<SprintStudentRow>[] = [
  { key: "idnumber", label: "Student ID", sortable: true },
  { key: "lastName", label: "Last name", sortable: true },
  { key: "firstName", label: "First name", sortable: true },
  { key: "classification", label: "Classification", sortable: true, sortKey: "classificationCode" },
  { key: "clearedOn", label: "Cleared on", sortable: true, sortKey: "clearedAt", render: (r) => formatIsoDate(r.clearedOn) },
  { key: "operator", label: "Cleared by" },
  { key: "accountBalance", label: "Balance", sortable: true, align: "right", render: (r) => formatCurrency(r.accountBalance) },
  { key: "enrolledCurrentTerm", label: "Enrolled", render: (r) => (r.enrolledCurrentTerm ? "Yes" : "No") },
  { key: "email", label: "Email" },
];

/**
 * Students behind a sprint cell (Spec §7.1–7.3 drill-downs): a day, an operator, or a classification.
 * Student-level, so it requires student.view and is audited like every other student list.
 */
export default async function SprintStudentsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const principal = requirePermission(await getPrincipal(), "student.view");
  const q = paramsSchema.parse(await searchParams);
  const tz = getConfig().APP_TIMEZONE;
  const { termKey, label, window } = await getCurrentSprintWindow();

  if (!window) {
    return (
      <>
        <PageHeader title="Sprint detail" />
        <div className="card text-sm text-ink-2">
          Sprint dates have not been set for {termKey}, so there is no window to list students for.{" "}
          <Link href="/clearance-sprint" className="text-brand">
            Back to Clearance Sprint
          </Link>
        </div>
      </>
    );
  }

  const filter = {
    range: { start: window.start, end: window.end },
    date: q.date,
    operatorCode: q.operator,
    classificationCode: q.classification,
  };
  const page = await getSprintDrillDown(filter, { page: q.page, pageSize: q.pageSize, sort: { field: q.sort, direction: q.direction } });

  const scope = q.date
    ? `cleared on ${formatIsoDate(q.date)}`
    : q.operator !== undefined
      ? `cleared by source code ${q.operator || "(blank)"}`
      : q.classification
        ? `classification ${classificationDisplayName(q.classification).displayName}`
        : "cleared during the sprint";

  await audit(principal, "student.list_view", {
    targetType: "sprint",
    targetId: q.date ?? q.operator ?? q.classification ?? "window",
    metadata: { term: termKey, start: window.start, end: window.end, rowsReturned: page.rows.length, totalRows: page.totalRows, page: q.page, via: "page" },
  });

  const query = new URLSearchParams();
  if (q.date) query.set("date", q.date);
  if (q.operator !== undefined) query.set("operator", q.operator);
  if (q.classification) query.set("classification", q.classification);

  return (
    <>
      <PageHeader
        title={`Sprint detail — ${scope}`}
        description={`${formatCount(page.totalRows)} students · window ${formatIsoDate(window.start)} → ${formatIsoDate(window.end)} · ${label}`}
        actions={
          <Link href="/clearance-sprint" className="text-sm text-brand no-print">
            ← Back to Clearance Sprint
          </Link>
        }
      />
      <PrintHeader title="Clearance Sprint detail" subtitle={scope} semester={label} printedBy={principal.displayName} timeZone={tz} rows={`${formatCount(page.totalRows)} students`} />
      <DataTable
        rows={page.rows}
        columns={COLUMNS}
        rowKey={(r) => r.idnumber}
        page={page.page}
        pageSize={page.pageSize}
        totalRows={page.totalRows}
        sort={{ field: q.sort, direction: q.direction }}
        baseHref={`/clearance-sprint/students?${query.toString()}`}
        caption={`Students ${scope} — page ${page.page}`}
        emptyMessage="No students match this selection."
      />
      <p className="text-xs text-ink-3">
        A student appears once, on the day of their first clearance action in the window — the same de-duplication the dashboard uses, so these rows add up to the Cleared figure.
        Last refreshed {formatDateTime(new Date(), tz)}.
      </p>
    </>
  );
}
