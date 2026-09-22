import Link from "next/link";
import { formatCount, formatCurrency, formatPercent } from "@/lib/format";
import type { CurrentDashboard } from "@/server/services/dashboard";
import { MetricCard } from "./MetricCard";

type Common = { timeZone: string };

export function ReceivableCard({ metric, canDrillDown, timeZone }: { metric: CurrentDashboard["receivable"]; canDrillDown: boolean } & Common) {
  const v = metric.value;
  return (
    <MetricCard
      title="Current receivable"
      status={metric.status}
      error={metric.error}
      capturedAt={metric.capturedAt}
      timeZone={timeZone}
      footer={v ? `Debit balances where LastCleared ∈ {${v.terms.join(", ")}}` : undefined}
    >
      {v ? (
        <>
          <p className="text-3xl font-semibold tabular">{formatCurrency(v.total)}</p>
          <p className="text-sm text-ink-2">
            {formatCount(v.studentCount)} Students with debit balances
            {canDrillDown ? (
              <span className="no-print">
                {" · "}
                <Link href="/dashboard/students?population=receivable" className="text-brand">
                  View students →
                </Link>
              </span>
            ) : null}
          </p>
        </>
      ) : null}
    </MetricCard>
  );
}

const TREATMENT = {
  positive: { icon: "✓", label: "Credits cover charges", cls: "text-good border-good" },
  neutral: { icon: "•", label: "Within expected range", cls: "text-ink-2 border-border" },
  warning: { icon: "⚠", label: "Delta exceeds warning threshold", cls: "text-warning border-warning" },
} as const;

export function ChargesCreditsCard({ metric, timeZone }: { metric: CurrentDashboard["chargesCredits"] } & Common) {
  const v = metric.value;
  const t = v ? TREATMENT[v.treatment] : null;
  return (
    <MetricCard
      title="Charges vs. expected credits"
      status={metric.status}
      error={metric.error}
      capturedAt={metric.capturedAt}
      timeZone={timeZone}
      footer={
        v
          ? `${v.afterDropDate ? "After the drop date: figures come from the frozen tblFCA_TRANS_HIST copy." : "Before the drop date: figures come from live Jenzabar transactions."} Warning rule: delta greater than ${formatPercent(v.warningRatio * 100)} of charges (administrator-configurable).`
          : undefined
      }
    >
      {v && t ? (
        <dl className="space-y-2 text-sm">
          <Row label="Total charges (SOURCE_CDE @C)" value={formatCurrency(v.charges)} />
          <Row label="Expected financial aid / credits (@F)" value={formatCurrency(v.credits)} />
          <div className="border-t border-border pt-2">
            <div className="flex items-center justify-between">
              <dt className="font-medium">Delta (charges − credits)</dt>
              <dd className="text-lg font-semibold tabular">{formatCurrency(v.delta)}</dd>
            </div>
            <dd className="mt-1">
              <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs whitespace-nowrap ${t.cls}`}>
                <span aria-hidden>{t.icon}</span> {t.label}
              </span>
            </dd>
          </div>
        </dl>
      ) : null}
    </MetricCard>
  );
}

export function DnrDncCard({ metric, canDrillDown, timeZone }: { metric: CurrentDashboard["dnrDnc"]; canDrillDown: boolean } & Common) {
  const v = metric.value;
  return (
    <MetricCard
      title="Did Not Clear / Did Not Return"
      status={metric.status}
      error={metric.error}
      capturedAt={metric.capturedAt}
      timeZone={timeZone}
      footer={
        v ? (
          v.dnrGuardViolations > 0 ? (
            <span className="text-warning">⚠ {formatCount(v.dnrGuardViolations)} DNR candidates are enrolled this semester and were excluded (enrollment guard).</span>
          ) : (
            "Students with debit balances only (A-1). DNR excludes anyone registered this semester (guard: 0 exclusions)."
          )
        ) : undefined
      }
    >
      {v ? (
        <div className="grid grid-cols-2 gap-3">
          <Category code="DNC" name="Did Not Clear" hint="Rolled to this semester, not cleared, owes a balance" count={v.dnc.count} balance={v.dnc.positiveBalance} href={canDrillDown ? "/dashboard/students?population=dnc" : null} />
          <Category code="DNR" name="Did Not Return" hint="Cleared last semester, not registered this semester, owes a balance" count={v.dnr.count} balance={v.dnr.positiveBalance} href={canDrillDown ? "/dashboard/students?population=dnr" : null} />
        </div>
      ) : null}
    </MetricCard>
  );
}

function Category({ code, name, hint, count, balance, href }: { code: string; name: string; hint: string; count: number; balance: number; href: string | null }) {
  const body = (
    <>
      <div className="text-xs text-ink-3">
        <span className="font-semibold text-ink">{code}</span> · {name}
      </div>
      <div className="text-2xl font-semibold tabular">{formatCount(count)}</div>
      <div className="text-sm text-ink-2 tabular">{formatCurrency(balance)} owed</div>
      <div className="text-xs text-ink-3 mt-1">{hint}</div>
    </>
  );
  return href ? (
    <Link href={href} className="rounded-md border border-border p-3 hover:bg-surface-2 block">
      {body}
      <span className="text-xs text-brand no-print">View students →</span>
    </Link>
  ) : (
    <div className="rounded-md border border-border p-3">{body}</div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-ink-2">{label}</dt>
      <dd className="tabular font-medium">{value}</dd>
    </div>
  );
}
