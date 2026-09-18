import { getPrincipal } from "@/server/auth/session";
import { hasPermission, requirePermission } from "@/server/authz/permissions";
import { audit } from "@/server/audit/audit";
import { getCurrentDashboard } from "@/server/services/dashboard";
import { getConfig } from "@/server/db/config";
import { formatDateTime } from "@/lib/format";
import { PageHeader } from "@/components/layout/PageHeader";
import { HeroCard } from "@/components/cards/HeroCard";
import { ChargesCreditsCard, DnrDncCard, ReceivableCard } from "@/components/cards/SummaryCards";
import { ClearanceBreakdownCard } from "@/components/cards/ClearanceBreakdownCard";
import { PrintButton } from "@/components/print/PrintButton";
import { PrintHeader } from "@/components/print/PrintHeader";

export const metadata = { title: "Current Semester" };
export const dynamic = "force-dynamic";

/**
 * Current Semester Dashboard (Spec §6). Reads snapshots (Spec §19); the same service backs
 * /api/v1/dashboard/current. The view is audited.
 */
export default async function DashboardPage() {
  const principal = requirePermission(await getPrincipal(), "dashboard.view");
  // Clearance Breakdown runs on screen load (Spec §7.3): the snapshot is refreshed through the job
  // pipeline when it is missing or older than 15 minutes, then every card reads its snapshot.
  const dashboard = await getCurrentDashboard({ autoRefresh: ["clearanceBreakdown"], autoRefreshAfterMinutes: 15 });
  await audit(principal, "dashboard.view", { metadata: { term: dashboard.term.current, via: "page" } });
  const canDrillDown = hasPermission(principal, "student.view");
  const tz = getConfig().APP_TIMEZONE;
  const src = dashboard.source;

  return (
    <>
      <PageHeader
        title={`Current Semester — ${dashboard.term.label}`}
        description={`Terms ${dashboard.term.currentKeys.join(" / ")} · previous ${dashboard.term.previousKeys.join(" / ")} · source: ${src.provider} via ${src.store} snapshots${src.latestCapturedAt ? ` · latest capture ${formatDateTime(src.latestCapturedAt, tz)}` : ""}`}
        actions={<PrintButton />}
      />
      <PrintHeader title="Current Semester Dashboard" subtitle={`Terms ${dashboard.term.currentKeys.join(" / ")} · previous ${dashboard.term.previousKeys.join(" / ")}`} semester={dashboard.term.label} capturedAt={src.latestCapturedAt} printedBy={principal.displayName} timeZone={tz} />

      {src.anyStale ? (
        <div role="status" className="rounded-md border border-warning bg-surface-1 px-4 py-3 text-sm flex items-center gap-2">
          <span aria-hidden>⚠</span>
          One or more snapshots are older than {src.staleAfterMinutes} minutes. Values may not reflect current data. Administrators can trigger a refresh under Administration → Jobs.
        </div>
      ) : null}

      {!canDrillDown ? <p className="text-xs text-ink-3">Student-level drill-down is hidden for your role. Ask an administrator for the “student.view” permission.</p> : null}

      {/* Row 1: hero (2 cols) + Current receivable; row 2: charges, DNC/DNR, and Clearance Breakdown directly under Current receivable. */}
      <div className="grid gap-4 lg:grid-cols-3 lg:items-start print-stack">
        <HeroCard metric={dashboard.heroCard} canDrillDown={canDrillDown} timeZone={tz} />
        <ReceivableCard metric={dashboard.receivable} canDrillDown={canDrillDown} timeZone={tz} />
        <ChargesCreditsCard metric={dashboard.chargesCredits} timeZone={tz} />
        <DnrDncCard metric={dashboard.dnrDnc} canDrillDown={canDrillDown} timeZone={tz} />
        <ClearanceBreakdownCard metric={dashboard.clearanceBreakdown} timeZone={tz} className="lg:col-start-3" semester={dashboard.term.label} printedBy={principal.displayName} />
      </div>
    </>
  );
}
