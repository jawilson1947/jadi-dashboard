import Link from "next/link";
import { formatCount, formatDateTime } from "@/lib/format";
import { PageHeader } from "@/components/layout/PageHeader";
import { PrintButton } from "@/components/print/PrintButton";
import { PrintHeader } from "@/components/print/PrintHeader";
import { RefreshReportButton } from "./RefreshReportButton";
import { ExportReportButtons } from "./ExportReportButtons";
import type { ReportDefinition } from "@/server/reports/definitions";
import type { ReportSnapshotMeta } from "@/server/reports/snapshot";

/**
 * The shared shell every report page renders inside (docs/REPORTS-PLAN.md §4.2). Header, the two
 * timestamps, the four actions, the scope note, the stale banner and the print header live here,
 * so a new report is a definition and a body rather than another page of chrome.
 */

export interface ReportShellProps {
  definition: ReportDefinition;
  meta: ReportSnapshotMeta;
  /** When the live half (names, balances) was read — always now, and never the same fact as `meta`. */
  contactsReadAt: Date;
  timeZone: string;
  printedBy: string;
  semesterLabel: string;
  /** Row count for the print header and the export buttons. */
  rowCount: number;
  canExport: boolean;
  /** Query string carrying the page's parameters into export and print. */
  query?: string;
  children: React.ReactNode;
}

/**
 * Two timestamps, not one. The population is as old as the snapshot; the names and balances beside
 * it were read just now (A-30). Printing a single date at the top of the page would be a lie about
 * one of them, and on a collection report that is the lie that matters.
 */
function Freshness({ meta, contactsReadAt, timeZone }: { meta: ReportSnapshotMeta; contactsReadAt: Date; timeZone: string }) {
  return (
    <span className="text-sm text-ink-2">
      {meta.missing ? (
        <>Population not yet captured</>
      ) : (
        <>Population as of {formatDateTime(meta.capturedAt!.toISOString(), timeZone)}</>
      )}
      {" · "}
      Names and balances live at {formatDateTime(contactsReadAt.toISOString(), timeZone)}
    </span>
  );
}

export function ReportShell({
  definition,
  meta,
  contactsReadAt,
  timeZone,
  printedBy,
  semesterLabel,
  rowCount,
  canExport,
  query = "",
  children,
}: ReportShellProps) {
  const live = definition.family === null;

  return (
    <>
      <PageHeader
        title={definition.title}
        description={definition.blurb}
        actions={
          <span className="flex items-center gap-3">
            {live ? null : <RefreshReportButton reportKey={definition.key} />}
            {canExport ? <ExportReportButtons reportKey={definition.key} query={query} rowCount={rowCount} /> : null}
            <PrintButton />
            {/* Same shape and position as the other detail pages (dashboard/students,
                clearance-sprint/students): a link to the parent, not history.back(), so it lands
                on the catalog whether the user arrived from there, a bookmark or an export mail. */}
            <Link href="/reports" className="text-sm text-brand no-print">
              ← Back to reports
            </Link>
          </span>
        }
      />

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 no-print">
        {live ? (
          <span className="text-sm text-ink-2">Read live at {formatDateTime(contactsReadAt.toISOString(), timeZone)}</span>
        ) : (
          <Freshness meta={meta} contactsReadAt={contactsReadAt} timeZone={timeZone} />
        )}
        <span className="text-xs text-ink-3">
          {definition.termScope === "current"
            ? "Current semester only — the clearance views hold current-term registrations"
            : "Current and previous semester"}
        </span>
      </div>

      {definition.termScope === "current" ? (
        <details className="text-xs text-ink-3 no-print">
          <summary className="cursor-pointer">Why there is no previous-semester option</summary>
          <p className="mt-1 max-w-3xl">
            Every <code>VIEW_OURM_*</code> view is scoped to the <code>tblOUSA.isCurrent = 1</code> row, so dated clearance and
            registration rows exist for the current term only. An earlier term would need term-filtered access to the underlying
            Jenzabar rows — open question 8 for the DBA. A selector that silently returned current-term data would be worse than
            none, so there is none.
          </p>
        </details>
      ) : null}

      {meta.missing && !live ? (
        <div role="status" className="rounded-md border border-warning bg-surface-1 px-4 py-2 text-sm no-print">
          <span aria-hidden>⚠</span> This report has not been captured yet. Use <strong>Refresh</strong> to run it now, or wait for
          the scheduled run.
        </div>
      ) : null}

      {meta.stale && !meta.missing && !live ? (
        <div role="status" className="rounded-md border border-warning bg-surface-1 px-4 py-2 text-sm no-print">
          <span aria-hidden>⚠</span> The population is {formatCount(Math.floor((meta.ageMinutes ?? 0) / 60))} hours old. Balances
          shown beside it are current.
        </div>
      ) : null}

      <PrintHeader
        title={definition.title}
        subtitle={definition.blurb}
        semester={semesterLabel}
        capturedAt={(meta.capturedAt ?? contactsReadAt).toISOString()}
        printedBy={printedBy}
        timeZone={timeZone}
        rows={`${formatCount(rowCount)} row${rowCount === 1 ? "" : "s"}`}
      />

      {children}
    </>
  );
}
