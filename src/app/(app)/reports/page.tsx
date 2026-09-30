import Link from "next/link";
import { getPrincipal } from "@/server/auth/session";
import { requirePermission, hasPermission } from "@/server/authz/permissions";
import { getConfig } from "@/server/db/config";
import { getAppStore } from "@/server/store";
import { REPORT_DEFINITIONS } from "@/server/reports/definitions";
import { describeSnapshot } from "@/server/reports/snapshot";
import { formatCount, formatDateTime } from "@/lib/format";
import { PageHeader } from "@/components/layout/PageHeader";

export const metadata = { title: "Reports & Analyses" };
export const dynamic = "force-dynamic";

/**
 * Report catalog (docs/REPORTS-PLAN.md §4.1).
 *
 * Counts come from the snapshot header rows, so the catalog costs one cheap query per report and
 * never touches the slow source views. A viewer without student.view sees the cards and the counts
 * — which are aggregates — but cannot open a report.
 */
export default async function ReportsPage() {
  const principal = requirePermission(await getPrincipal(), "dashboard.view");
  const tz = getConfig().APP_TIMEZONE;
  const store = getAppStore();
  const now = new Date();
  const canOpen = hasPermission(principal, "student.view");

  const cards = await Promise.all(
    REPORT_DEFINITIONS.map(async (def) => {
      if (!def.family) return { def, meta: null };
      return { def, meta: describeSnapshot(await store.latestSnapshot(def.family), now) };
    }),
  );

  return (
    <>
      <PageHeader
        title="Reports & Analyses"
        description="The Report Spec's six semester reports. Every one prints and exports for mail merge."
      />

      {canOpen ? null : (
        <div role="status" className="rounded-md border border-border bg-surface-1 px-4 py-2 text-sm">
          These reports list individual students, so opening one needs the <strong>student data</strong> permission. An
          administrator can grant it.
        </div>
      )}

      <section aria-labelledby="current-prev">
        <h2 id="current-prev" className="text-sm font-medium text-ink-2 mb-3">
          Current &amp; Previous Semester Reports
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map(({ def, meta }) => {
            const body = (
              <>
                <div className="flex items-baseline gap-2">
                  <h3 className="font-medium">{def.title}</h3>
                  <span className="text-xs text-ink-3">{def.ref}</span>
                </div>
                <p className="text-sm text-ink-2 mt-1">{def.blurb}</p>
                <p className="text-xs text-ink-3 mt-3">
                  {meta === null ? (
                    <>Live · no capture needed</>
                  ) : meta.missing ? (
                    <>Not yet captured</>
                  ) : (
                    <>
                      {formatCount(meta.rowCount ?? 0)} row{meta.rowCount === 1 ? "" : "s"} · as of{" "}
                      {formatDateTime(meta.capturedAt!.toISOString(), tz)}
                    </>
                  )}
                </p>
                <p className="text-xs text-ink-3">
                  {def.termScope === "current" ? "Current semester only" : "Current + previous semester"}
                </p>
              </>
            );
            return canOpen ? (
              <Link
                key={def.key}
                href={`/reports/${def.key}`}
                className="card block hover:border-brand focus-visible:border-brand"
              >
                {body}
              </Link>
            ) : (
              <div key={def.key} className="card opacity-70">
                {body}
              </div>
            );
          })}
        </div>
      </section>

      <section aria-labelledby="data-analysis">
        <h2 id="data-analysis" className="text-sm font-medium text-ink-2 mb-3">
          Data Analysis
        </h2>
        <p className="text-sm text-ink-3">
          Current vs previous semester, a specific semester, and all receivables — Phase 7b, scoped in
          <code className="mx-1">docs/REPORTS-PLAN.md §6</code>.
        </p>
      </section>
    </>
  );
}
