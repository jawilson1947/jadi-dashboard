import { notFound } from "next/navigation";
import { getPrincipal } from "@/server/auth/session";
import { requirePermission, hasPermission } from "@/server/authz/permissions";
import { getConfig } from "@/server/db/config";
import { newCorrelationId } from "@/server/audit/audit";
import { getAppStore } from "@/server/store";
import { getDataProvider } from "@/server/repositories";
import { getCurrentTerms } from "@/server/metadata/terms";
import { getReportDefinition, REPORT_KEYS, type ReportKey } from "@/server/reports/definitions";
import { reportParamsSchema } from "@/server/reports/views";
import {
  getUnclassifiedView,
  getFreshmanView,
  getClearedMoreThanOnceView,
  getEnrolleeBalanceView,
  getCurrentlyClearedView,
  auditReportView,
} from "@/server/services/reports";
import { getDnrDncView } from "@/server/services/dnr-dnc";
import { ReportShell } from "@/components/reports/ReportShell";
import { UnclassifiedReport } from "@/components/reports/UnclassifiedReport";
import { FreshmanReport } from "@/components/reports/FreshmanReport";
import { ClearedMoreThanOnceReport } from "@/components/reports/ClearedMoreThanOnceReport";
import { EnrolleeBalanceReport } from "@/components/reports/EnrolleeBalanceReport";
import { CollectionReport } from "@/components/reports/CollectionReport";
import { CurrentlyClearedReport } from "@/components/reports/CurrentlyClearedReport";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  return { title: getReportDefinition(key)?.title ?? "Report" };
}

/**
 * One route for all six reports (docs/REPORTS-PLAN.md §4.2). The shell — header, the two
 * timestamps, Refresh, Print, CSV, XLSX, the scope note and the stale banner — is shared; only the
 * body differs, because only the body IS the report.
 *
 * Student-level, so student.view is required and every view is audited with the report key and the
 * row count, never the rows (A-30).
 */
export default async function ReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ key: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { key } = await params;
  if (!(REPORT_KEYS as readonly string[]).includes(key)) notFound();
  const definition = getReportDefinition(key)!;

  const principal = requirePermission(await getPrincipal(), "student.view");
  const q = reportParamsSchema.parse(await searchParams);
  const tz = getConfig().APP_TIMEZONE;
  const correlationId = newCorrelationId();
  const terms = await getCurrentTerms(getAppStore(), getDataProvider());
  const canExport = hasPermission(principal, "export.create") || hasPermission(principal, "mailmerge.create");

  const shell = (node: React.ReactNode, meta: Parameters<typeof ReportShell>[0]["meta"], readAt: Date, rowCount: number, query: string) => (
    <ReportShell
      definition={definition}
      meta={meta}
      contactsReadAt={readAt}
      timeZone={tz}
      printedBy={principal.displayName}
      semesterLabel={terms.label}
      rowCount={rowCount}
      canExport={canExport}
      query={query}
    >
      {node}
    </ReportShell>
  );

  switch (key as ReportKey) {
    case "unclassified": {
      const view = await getUnclassifiedView();
      await auditReportView(principal, definition, view.rows.length, correlationId);
      return shell(
        <UnclassifiedReport view={view} group={q.group} />,
        view.meta,
        view.contactsReadAt,
        view.totals.students,
        q.group === "all" ? "" : `group=${q.group}`,
      );
    }
    case "freshman-analysis": {
      const view = await getFreshmanView();
      await auditReportView(principal, definition, view.rows.length, correlationId);
      return shell(
        <FreshmanReport view={view} mismatchesOnly={Boolean(q.mismatchesOnly)} />,
        view.meta,
        view.contactsReadAt,
        q.mismatchesOnly ? view.mismatches : view.rows.length,
        q.mismatchesOnly ? "mismatchesOnly=1" : "",
      );
    }
    case "cleared-more-than-once": {
      const view = await getClearedMoreThanOnceView();
      await auditReportView(principal, definition, view.totals.actions, correlationId);
      return shell(<ClearedMoreThanOnceReport view={view} />, view.meta, view.contactsReadAt, view.totals.actions, "");
    }
    case "enrollee-balance": {
      // The range is the report's only parameter. Defaults to every debit balance, so the page is
      // useful before anything is typed; min defaults above zero because a zero balance is not a
      // debt and this report is a collection tool.
      const min = q.minBalance ?? 0.01;
      const max = q.maxBalance ?? Number.MAX_SAFE_INTEGER;
      const view = await getEnrolleeBalanceView({ min, max });
      await auditReportView(principal, definition, view.rows.length, correlationId);
      const query = new URLSearchParams();
      if (q.minBalance !== undefined) query.set("minBalance", String(q.minBalance));
      if (q.maxBalance !== undefined) query.set("maxBalance", String(q.maxBalance));
      return shell(<EnrolleeBalanceReport view={view} />, view.meta, view.contactsReadAt, view.totals.students, query.toString());
    }
    case "dnc-dnr-collection": {
      // R-D6: the shipped DNR/DNC population, so this report and the dashboard card can never
      // disagree about who owes money. Live — no snapshot, no Refresh button.
      const view = await getDnrDncView({ page: 1, pageSize: 5000 });
      await auditReportView(principal, definition, view.rows.length, correlationId);
      return shell(
        <CollectionReport view={view} />,
        { capturedAt: null, rowCount: view.totalRows, sourceProvider: view.source.provider, missing: false, ageMinutes: 0, stale: false },
        new Date(view.source.readAt),
        view.totalRows,
        "",
      );
    }
    case "currently-cleared": {
      const view = await getCurrentlyClearedView();
      await auditReportView(principal, definition, view.rows.length, correlationId);
      return shell(<CurrentlyClearedReport view={view} />, view.meta, view.contactsReadAt, view.totals.students, "");
    }
  }
}
