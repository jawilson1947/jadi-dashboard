import { formatDateTime } from "@/lib/format";
import type { MetricStatus } from "@/server/services/dashboard";

/**
 * Card frame with the states required by Spec §5: ok, stale, pending (no snapshot yet),
 * failed. A failed or pending metric shows "Unavailable"/"Pending" and a reason — never a zero.
 * Every card shows when its data was captured (Spec §5 "data timestamp").
 */
export function MetricCard({
  title,
  status,
  error,
  capturedAt,
  timeZone,
  footer,
  children,
  className = "",
}: {
  title: string;
  status: MetricStatus;
  error?: string;
  capturedAt?: string | null;
  timeZone?: string;
  footer?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  const badge =
    status === "stale"
      ? { cls: "border-warning text-warning", icon: "⚠", text: "Stale data" }
      : status === "failed"
        ? { cls: "border-critical text-critical", icon: "✕", text: "Unavailable" }
        : status === "pending"
          ? { cls: "border-border text-ink-2", icon: "…", text: "No snapshot yet" }
          : null;
  return (
    <section className={`card flex flex-col gap-3 ${className}`} aria-labelledby={slug(title)}>
      <div className="flex items-center gap-2">
        <h2 id={slug(title)} className="text-sm font-medium text-ink-2">
          {title}
        </h2>
        {badge ? (
          <span className={`ml-auto inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${badge.cls}`}>
            <span aria-hidden>{badge.icon}</span> {badge.text}
          </span>
        ) : null}
      </div>
      {status === "failed" || status === "pending" ? (
        <p role="status" className="text-sm text-ink-2">
          {error ?? "This metric could not be loaded."}
        </p>
      ) : (
        children
      )}
      <div className="text-xs text-ink-3 mt-auto space-y-1">
        {footer ? <div>{footer}</div> : null}
        {capturedAt ? <div>Captured {formatDateTime(capturedAt, timeZone)}</div> : null}
      </div>
    </section>
  );
}

function slug(s: string) {
  return "card-" + s.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}
