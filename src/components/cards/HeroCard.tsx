import Link from "next/link";
import { formatCount, formatDateTime, formatPercent, formatSignedCount } from "@/lib/format";
import type { CurrentDashboard } from "@/server/services/dashboard";
import { MetricCard } from "./MetricCard";

/**
 * Cleared vs Enrolled hero card (Spec §6.1) using the A-2 definitions:
 *   Enrolled = VIEW_OURM_FCA rows · Cleared = distinct VIEW_OURM_STATS · Not cleared = FCA Status <> 'Cleared'
 * plus the reconciliation line for students with a clearance action but no current registration,
 * and the nightly tblOUSA figures for comparison.
 */
export function HeroCard({ metric, canDrillDown, timeZone }: { metric: CurrentDashboard["heroCard"]; canDrillDown: boolean; timeZone: string }) {
  const v = metric.value;
  const pct = v?.clearedPct ?? null;
  const width = pct === null ? 0 : Math.max(0, Math.min(100, pct));

  return (
    <MetricCard
      title="Financially cleared vs. enrolled"
      status={metric.status}
      error={metric.error}
      capturedAt={metric.capturedAt}
      timeZone={timeZone}
      className="lg:col-span-2"
      footer={
        v?.nightly && (v.nightly.census !== null || v.nightly.financiallyCleared !== null) ? (
          <span>
            Nightly figures (tblOUSA, 9:00 pm): census {formatCount(v.nightly.census)} · financially cleared {formatCount(v.nightly.financiallyCleared)}
          </span>
        ) : (
          "Enrolled = VIEW_OURM_FCA · Cleared = distinct VIEW_OURM_STATS · Not cleared = FCA Status ≠ Cleared"
        )
      }
    >
      {v ? (
        <>
          <div className="flex items-end gap-4">
            <p className="text-5xl font-semibold leading-none">{formatPercent(pct)}</p>
            <p className="text-sm text-ink-2 pb-1">
              of enrolled students financially cleared
              {v.changeSincePrior ? (
                <span className="block text-xs text-ink-3">
                  {formatSignedCount(v.changeSincePrior.cleared)} cleared, {formatSignedCount(v.changeSincePrior.enrolled)} enrolled since {formatDateTime(v.changeSincePrior.priorCapturedAt, timeZone)}
                </span>
              ) : (
                <span className="block text-xs text-ink-3">Change since the prior snapshot appears after the second scheduled refresh</span>
              )}
            </p>
          </div>

          <div role="meter" aria-label="Clearance progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct === null ? undefined : Math.round(pct * 100) / 100} aria-valuetext={formatPercent(pct)} className="h-3 w-full rounded-full bg-brand-track overflow-hidden">
            <div className="h-full rounded-full bg-brand" style={{ width: `${width}%` }} />
          </div>

          <dl className="grid grid-cols-3 gap-3">
            <Stat label="Enrolled" value={v.enrolled} href={canDrillDown ? "/dashboard/students?population=enrolled" : null} />
            <Stat label="Financially cleared" value={v.cleared} href={canDrillDown ? "/dashboard/students?population=cleared" : null} />
            <Stat label="Not cleared" value={v.notCleared} href={canDrillDown ? "/dashboard/students?population=notCleared" : null} />
          </dl>

          {v.clearedNotEnrolled > 0 ? (
            <p className="text-xs text-ink-2">
              <span aria-hidden>ℹ</span> {formatCount(v.clearedNotEnrolled)} cleared {v.clearedNotEnrolled === 1 ? "student is" : "students are"} not currently enrolled, so Cleared + Not cleared exceeds Enrolled by that amount.
            </p>
          ) : null}
        </>
      ) : null}
    </MetricCard>
  );
}

function Stat({ label, value, href }: { label: string; value: number; href: string | null }) {
  const inner = (
    <>
      <dt className="text-xs text-ink-3">{label}</dt>
      <dd className="text-2xl font-semibold tabular">{formatCount(value)}</dd>
    </>
  );
  return href ? (
    <Link href={href} className="rounded-md border border-border p-3 hover:bg-surface-2 block" aria-label={`${label}: ${formatCount(value)} — view students`}>
      {inner}
      <span className="text-xs text-brand no-print">View students →</span>
    </Link>
  ) : (
    <div className="rounded-md border border-border p-3">{inner}</div>
  );
}
