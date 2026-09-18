import { formatCount, formatDateTime, formatPercent } from "@/lib/format";
import type { CurrentDashboard } from "@/server/services/dashboard";
import { RefreshBreakdownButton } from "./RefreshBreakdownButton";
import { PrintButton } from "@/components/print/PrintButton";
import { PrintHeader } from "@/components/print/PrintHeader";

/**
 * Clearance Breakdown (Spec §7.3): enrolled / cleared / not cleared / % cleared per classification,
 * with a Total row — the same rows as docs/validation-sql/clearance_by_classification.sql.
 * Runs on screen load (snapshot refreshed when older than the page-load threshold) and on "Refresh".
 */
export function ClearanceBreakdownCard({ metric, timeZone, className = "", semester, printedBy }: { metric: CurrentDashboard["clearanceBreakdown"]; timeZone: string; className?: string; semester: string; printedBy: string }) {
  const rows = metric.value;
  const badge =
    metric.status === "stale"
      ? { cls: "border-warning text-warning", icon: "⚠", text: "Stale data" }
      : metric.status === "failed"
        ? { cls: "border-critical text-critical", icon: "✕", text: "Unavailable" }
        : metric.status === "pending"
          ? { cls: "border-border text-ink-2", icon: "…", text: "No snapshot yet" }
          : null;

  return (
    <section className={`card flex flex-col gap-3 ${className}`} aria-labelledby="card-clearance-breakdown" data-print-id="clearance-breakdown">
      <PrintHeader scoped title="Clearance Breakdown" subtitle="Enrolled vs. financially cleared by classification" semester={semester} capturedAt={metric.capturedAt} printedBy={printedBy} timeZone={timeZone} />
      <div className="flex items-center gap-2 flex-wrap">
        <h2 id="card-clearance-breakdown" className="text-sm font-medium text-ink-2">
          Clearance Breakdown
        </h2>
        {badge ? (
          <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${badge.cls}`}>
            <span aria-hidden>{badge.icon}</span> {badge.text}
          </span>
        ) : null}
        <RefreshBreakdownButton />
        <PrintButton scopeId="clearance-breakdown" className="!px-2 !py-1 !text-xs" />
      </div>

      {rows && metric.status !== "failed" && metric.status !== "pending" ? (
        <div>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-xs text-ink-3 border-b border-border align-bottom">
                <th scope="col" className="py-1.5 pr-1 font-medium">cCode</th>
                <th scope="col" className="py-1.5 pr-1 font-medium">Class</th>
                <th scope="col" className="py-1.5 pr-1 font-medium text-right">Enrolled</th>
                <th scope="col" className="py-1.5 pr-1 font-medium text-right">Cleared</th>
                <th scope="col" className="py-1.5 pr-1 font-medium text-right">Not Cleared</th>
                <th scope="col" className="py-1.5 font-medium text-right">Cleared %</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.isTotal ? "total" : r.cCode} className={r.isTotal ? "border-t-2 border-border font-semibold" : "border-b border-border/60"}>
                  <td className="py-1.5 pr-1 font-mono">{r.cCode}</td>
                  <td className="py-1.5 pr-1">{r.className}</td>
                  <td className="py-1.5 pr-1 text-right tabular">{formatCount(r.enrolled)}</td>
                  <td className="py-1.5 pr-1 text-right tabular">{formatCount(r.cleared)}</td>
                  <td className={`py-1.5 pr-1 text-right tabular ${r.notCleared > 0 && !r.isTotal ? "text-warning" : ""}`}>{formatCount(r.notCleared)}</td>
                  <td className="py-1.5 text-right tabular whitespace-nowrap">{r.clearedPercent === null ? "0%" : formatPercent(r.clearedPercent)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p role="status" className="text-sm text-ink-2">
          {metric.error ?? "This metric could not be loaded."}
        </p>
      )}

      <div className="text-xs text-ink-3 mt-auto space-y-1">
        <div>Enrolled = current registrations; Cleared = students with a clearance action; Incoming Transfer → TR, FF → FR, blank → XX. Refreshes on load when the snapshot is older than 15 minutes.</div>
        {metric.capturedAt ? <div>Captured {formatDateTime(metric.capturedAt, timeZone)}</div> : null}
      </div>
    </section>
  );
}
