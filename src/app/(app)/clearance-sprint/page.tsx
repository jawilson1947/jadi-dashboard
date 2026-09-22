import Link from "next/link";
import { z } from "zod";
import { getPrincipal } from "@/server/auth/session";
import { hasPermission, requirePermission } from "@/server/authz/permissions";
import { audit } from "@/server/audit/audit";
import { getConfig } from "@/server/db/config";
import { getSprintView, type SprintDayRow } from "@/server/services/sprint";
import { formatCount, formatDateTime, formatPercent } from "@/lib/format";
import { formatIsoDate } from "@/lib/dates";
import { PageHeader } from "@/components/layout/PageHeader";
import { PrintButton } from "@/components/print/PrintButton";
import { PrintHeader } from "@/components/print/PrintHeader";
import { BarChart, ColumnChart, LineChart } from "@/components/charts/Charts";

export const metadata = { title: "Clearance Sprint" };
export const dynamic = "force-dynamic";

const TABS = [
  { key: "date", label: "By date", spec: "§7.1" },
  { key: "operator", label: "By operator", spec: "§7.2" },
  { key: "classification", label: "By classification", spec: "§7.3" },
  { key: "compare", label: "Compare semesters", spec: "§7.4" },
] as const;

const paramsSchema = z.object({ tab: z.enum(["date", "operator", "classification", "compare"]).default("date") });

/**
 * Clearance Sprint (Spec §7). Snapshot-backed like the dashboard: the page refreshes the
 * `sprint.daily` snapshot through the job pipeline when it is missing, stale or describes a
 * different window, then reads it. Sprint dates are admin-entered (A-10) — without them the page
 * says so instead of inventing a range.
 */
export default async function ClearanceSprintPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const principal = requirePermission(await getPrincipal(), "dashboard.view");
  const { tab } = paramsSchema.parse(await searchParams);
  const view = await getSprintView({ autoRefreshAfterMinutes: 15 });
  const tz = getConfig().APP_TIMEZONE;
  const canDrillDown = hasPermission(principal, "student.view");
  const canManage = hasPermission(principal, "metadata.manage");
  await audit(principal, "dashboard.view", { targetType: "module", targetId: "clearance-sprint", metadata: { term: view.term.key, tab, configured: view.window !== null } });

  if (!view.window) {
    return (
      <>
        <PageHeader title={`Clearance Sprint — ${view.term.label}`} />
        <div className="card space-y-2">
          <h2 className="font-medium">Sprint dates have not been set for this semester</h2>
          <p className="text-sm text-ink-2">
            The sprint start and end dates are entered per semester by an administrator (ASSUMPTIONS A-10); the application does not assume a range, because clearance activity does not line up
            with the published term calendar. Once the dates are set, this page shows daily counts, operators, classifications and prior-semester comparisons.
          </p>
          {canManage ? (
            <Link href="/admin/metadata" className="inline-block text-sm text-brand">
              Set sprint dates for {view.term.key} →
            </Link>
          ) : (
            <p className="text-sm text-ink-3">Ask an administrator to set them under Administration → Semester metadata.</p>
          )}
        </div>
      </>
    );
  }

  const w = view.window;
  const badge =
    view.metric.status === "stale"
      ? { cls: "border-warning text-warning", icon: "⚠", text: "Stale data" }
      : view.metric.status === "pending"
        ? { cls: "border-border text-ink-2", icon: "…", text: "No snapshot yet" }
        : view.metric.status === "failed"
          ? { cls: "border-critical text-critical", icon: "✕", text: "Unavailable" }
          : null;

  return (
    <>
      <PageHeader
        title={`Clearance Sprint — ${view.term.label}`}
        description={`${formatIsoDate(w.start)} → ${formatIsoDate(w.end)} · day ${formatCount(view.totals.elapsedDays)} of ${formatCount(view.totals.days)} · ${formatCount(view.totals.cleared)} cleared in window${view.metric.capturedAt ? ` · captured ${formatDateTime(view.metric.capturedAt, tz)}` : ""}`}
        actions={<PrintButton />}
      />
      <PrintHeader title="Clearance Sprint" subtitle={`${formatIsoDate(w.start)} → ${formatIsoDate(w.end)} · ${TABS.find((t) => t.key === tab)?.label}`} semester={view.term.label} capturedAt={view.metric.capturedAt} printedBy={principal.displayName} timeZone={tz} />

      {badge ? (
        <div role="status" className={`rounded-md border bg-surface-1 px-4 py-2 text-sm inline-flex items-center gap-2 ${badge.cls}`}>
          <span aria-hidden>{badge.icon}</span>
          {badge.text}
          {view.metric.error ? <span className="text-ink-2">— {view.metric.error}</span> : null}
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3 print-stack">
        <Stat label="Cleared in window" value={formatCount(view.totals.cleared)} note={`${formatCount(view.totals.days)}-day window`} />
        <Stat label="Average per elapsed day" value={view.totals.averagePerElapsedDay === null ? "N/A" : formatCount(Math.round(view.totals.averagePerElapsedDay))} note={`${formatCount(view.totals.elapsedDays)} days elapsed`} />
        <Stat label="Peak day" value={view.totals.peak ? formatCount(view.totals.peak.cleared) : "N/A"} note={view.totals.peak ? formatIsoDate(view.totals.peak.date) : "no clearance actions yet"} />
      </div>

      <nav className="flex flex-wrap gap-1 border-b border-border no-print" aria-label="Sprint views">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/clearance-sprint?tab=${t.key}`}
            aria-current={t.key === tab ? "page" : undefined}
            className={`rounded-t-md px-3 py-2 text-sm border-b-2 ${t.key === tab ? "border-brand text-ink font-medium" : "border-transparent text-ink-2 hover:text-ink"}`}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === "date" ? <ByDate rows={view.byDate} canDrillDown={canDrillDown} /> : null}
      {tab === "operator" ? <ByOperator view={view} canDrillDown={canDrillDown} canManage={canManage} tz={tz} /> : null}
      {tab === "classification" ? <ByClassification view={view} canDrillDown={canDrillDown} /> : null}
      {tab === "compare" ? <Compare view={view} /> : null}
    </>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <section className="card">
      <h2 className="text-sm font-medium text-ink-2">{label}</h2>
      <p className="text-2xl font-semibold tabular mt-1">{value}</p>
      <p className="text-xs text-ink-3 mt-1">{note}</p>
    </section>
  );
}

/**
 * §7.1 — daily counts with a running total; each day links to the students cleared that day.
 *
 * Days with no clearance actions are omitted from BOTH the chart and the table: over a full
 * sprint most of the zero days are weekends and they crowded out the days that carry activity.
 * Two consequences a reader should know, and the caption says so:
 *   - the x-axis is no longer evenly spaced in time — it is the sequence of days that had
 *     activity, so a wide gap in the calendar looks the same as a one-day gap;
 *   - "Total to date" still comes from the full window (`cumulative` is computed upstream over
 *     every day), so the running total stays truthful and its jumps show where days were skipped.
 * Today is always kept even at zero, so the dashed rule still has a bar to sit on.
 */
function ByDate({ rows, canDrillDown }: { rows: SprintDayRow[]; canDrillDown: boolean }) {
  const active = rows.filter((r) => !r.isFuture);
  const shown = rows.filter((r) => r.cleared > 0 || r.isToday);
  const omitted = rows.length - shown.length;
  return (
    <section className="card space-y-3">
      <h2 className="text-sm font-medium text-ink-2">Cleared by date</h2>
      <ColumnChart
        points={shown.map((r) => ({ label: formatIsoDate(r.date, "short").replace(/\/\d{2,4}$/, ""), value: r.cleared, muted: r.isFuture, marked: r.isToday }))}
        title="Students financially cleared per day"
        description={`${formatCount(active.reduce((s, r) => s + r.cleared, 0))} students cleared across ${formatCount(active.length)} elapsed days of the sprint.${omitted > 0 ? ` ${formatCount(omitted)} day${omitted === 1 ? "" : "s"} with no clearance actions are omitted, so the axis is not evenly spaced in time.` : ""} The dashed rule marks today; the table below carries the same numbers.`}
      />
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">Students cleared per day with running total</caption>
          <thead className="bg-surface-2 text-left">
            <tr>
              {["Date", "Day", "Cleared", "Total to date"].map((h, i) => (
                <th key={h} scope="col" className={`px-3 py-2 font-medium text-ink-2 ${i > 1 ? "text-right" : ""}`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.date} className={`border-t border-border ${r.isToday ? "bg-brand-track/40" : ""}`}>
                <td className="px-3 py-1.5 whitespace-nowrap">
                  {canDrillDown && r.cleared > 0 ? (
                    <Link href={`/clearance-sprint/students?date=${r.date}`} className="text-brand">
                      {formatIsoDate(r.date)}
                    </Link>
                  ) : (
                    formatIsoDate(r.date)
                  )}
                  {r.isToday ? <span className="ml-2 text-xs text-ink-3">today</span> : null}
                </td>
                <td className="px-3 py-1.5 text-ink-2">{r.dayOfSprint}</td>
                <td className="px-3 py-1.5 text-right tabular">{formatCount(r.cleared)}</td>
                <td className="px-3 py-1.5 text-right tabular text-ink-2">{formatCount(r.cumulative)}</td>
              </tr>
            ))}
            {shown.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-8 text-center text-ink-3">
                  No clearance actions in this window yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {omitted > 0 ? (
        <p className="text-xs text-ink-3">
          {formatCount(omitted)} day{omitted === 1 ? "" : "s"} of the sprint window had no clearance actions and {omitted === 1 ? "is" : "are"} not
          listed. “Total to date” is still calculated across every day of the window.
        </p>
      ) : null}
    </section>
  );
}

/** §7.2 — counts per ClearedBy code, resolved through Operator Profiles, Unknown/Unmapped kept visible. */
function ByOperator({ view, canDrillDown, canManage, tz }: { view: Awaited<ReturnType<typeof getSprintView>>; canDrillDown: boolean; canManage: boolean; tz: string }) {
  const rows = view.byOperator;
  const unmapped = rows.filter((r) => !r.mapped);
  const total = rows.reduce((s, r) => s + r.cleared, 0);
  return (
    <section className="card space-y-3">
      <h2 className="text-sm font-medium text-ink-2">Cleared by operator</h2>
      <BarChart
        rows={rows.map((r) => ({ label: r.displayName, value: r.cleared, muted: !r.mapped || r.isSystem }))}
        title="Clearance actions by operator"
        description={`${formatCount(total)} clearance actions across ${formatCount(rows.length)} source codes. Automatic clearances and unmapped codes are shown in a muted bar and labelled in the table.`}
      />
      {unmapped.length > 0 ? (
        <p className="text-xs text-ink-2">
          {formatCount(unmapped.length)} code{unmapped.length === 1 ? "" : "s"} have no operator profile and are shown as “Unmapped”.
          {canManage ? (
            <>
              {" "}
              <Link href="/admin/operators" className="text-brand">
                Name them under Administration → Operators
              </Link>
              .
            </>
          ) : null}
        </p>
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">Clearance actions per operator</caption>
          <thead className="bg-surface-2 text-left">
            <tr>
              {["Operator", "Source code", "Cleared", "Share", "First action", "Last action"].map((h, i) => (
                <th key={h} scope="col" className={`px-3 py-2 font-medium text-ink-2 whitespace-nowrap ${i === 2 || i === 3 ? "text-right" : ""}`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.code || "(blank)"} className="border-t border-border">
                <td className="px-3 py-1.5">
                  {canDrillDown ? (
                    <Link href={`/clearance-sprint/students?operator=${encodeURIComponent(r.code)}`} className="text-brand">
                      {r.displayName}
                    </Link>
                  ) : (
                    r.displayName
                  )}
                  {r.isSystem ? <span className="ml-2 text-xs text-ink-3">automatic</span> : null}
                  {!r.mapped && !r.isSystem ? <span className="ml-2 text-xs text-warning">unmapped</span> : null}
                </td>
                <td className="px-3 py-1.5 font-mono text-xs">{r.code || "(blank)"}</td>
                <td className="px-3 py-1.5 text-right tabular">{formatCount(r.cleared)}</td>
                <td className="px-3 py-1.5 text-right tabular text-ink-2">{formatPercent(r.sharePct)}</td>
                <td className="px-3 py-1.5 whitespace-nowrap text-ink-2">{formatDateTime(r.firstAt, tz)}</td>
                <td className="px-3 py-1.5 whitespace-nowrap text-ink-2">{formatDateTime(r.lastAt, tz)}</td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-ink-3">
                  No clearance actions in this window yet.
                </td>
              </tr>
            ) : null}
          </tbody>
          {rows.length > 0 ? (
            <tfoot>
              <tr className="border-t-2 border-border font-semibold">
                <td className="px-3 py-1.5">Total</td>
                <td />
                <td className="px-3 py-1.5 text-right tabular">{formatCount(total)}</td>
                <td className="px-3 py-1.5 text-right tabular">{formatPercent(total > 0 ? 100 : null)}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
    </section>
  );
}

/** §7.3 — enrolled / cleared / not cleared / % per classification, scoped to the sprint window. */
function ByClassification({ view, canDrillDown }: { view: Awaited<ReturnType<typeof getSprintView>>; canDrillDown: boolean }) {
  const rows = view.byClassification;
  return (
    <section className="card space-y-3">
      <h2 className="text-sm font-medium text-ink-2">Cleared by classification</h2>
      <p className="text-xs text-ink-3">
        Enrolled is current registration; Cleared counts clearance actions inside the sprint window only, so a student cleared before the window opened is not counted here. Incoming Transfer
        (web group 22) overrides the class code, then FF/FR combine as Freshmen and blank becomes Unclassified (A-19).
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">Enrolled and cleared per classification inside the sprint window</caption>
          <thead className="bg-surface-2 text-left">
            <tr>
              {["cCode", "Class", "Enrolled", "Cleared", "Not cleared", "Cleared %"].map((h, i) => (
                <th key={h} scope="col" className={`px-3 py-2 font-medium text-ink-2 whitespace-nowrap ${i > 1 ? "text-right" : ""}`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.isTotal ? "total" : r.cCode} className={`border-t border-border ${r.isTotal ? "border-t-2 font-semibold" : ""}`}>
                <td className="px-3 py-1.5 font-mono text-xs">{r.cCode}</td>
                <td className="px-3 py-1.5">
                  {canDrillDown && !r.isTotal && r.cleared > 0 ? (
                    <Link href={`/clearance-sprint/students?classification=${r.cCode}`} className="text-brand">
                      {r.className}
                    </Link>
                  ) : (
                    r.className
                  )}
                </td>
                <td className="px-3 py-1.5 text-right tabular">{formatCount(r.enrolled)}</td>
                <td className="px-3 py-1.5 text-right tabular">{formatCount(r.cleared)}</td>
                <td className={`px-3 py-1.5 text-right tabular ${r.notCleared > 0 && !r.isTotal ? "text-warning" : ""}`}>{formatCount(r.notCleared)}</td>
                <td className="px-3 py-1.5 text-right tabular">{r.clearedPercent === null ? "0%" : formatPercent(r.clearedPercent)}</td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-ink-3">
                  No snapshot for this window yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** §7.4 — prior semesters aligned on day-of-sprint. Only sprints this application captured can appear. */
function Compare({ view }: { view: Awaited<ReturnType<typeof getSprintView>> }) {
  const series = [
    ...(view.currentSeries ? [{ key: view.currentSeries.termKey, label: `${view.term.key} (current)`, emphasis: "primary" as const, points: view.currentSeries.points.map((p) => ({ x: p.dayOfSprint, y: p.cumulative })) }] : []),
    ...view.comparison.map((s) => ({ key: s.termKey, label: s.termKey, emphasis: "secondary" as const, points: s.points.map((p) => ({ x: p.dayOfSprint, y: p.cumulative })) })),
  ];

  const references = view.benchmarks.map((b) => ({ label: b.label, value: b.financiallyCleared }));

  return (
    <section className="card space-y-3">
      <h2 className="text-sm font-medium text-ink-2">Compare to prior semesters</h2>
      {view.comparison.length === 0 ? (
        <p className="text-xs text-ink-3">
          Prior sprints have no daily shape to overlay: the source records a term for each student’s last clearance but not a date, so an earlier sprint cannot be reconstructed after the
          fact (open question 8 in ASSUMPTIONS.md). Each captured sprint is archived from this semester on, and prior semesters appear below as their official end-of-term totals — the
          nightly figures the institution already keeps (A-2).
        </p>
      ) : null}
      {series.length > 0 ? (
        <LineChart
          series={series}
          references={references}
          title="Cumulative students cleared by day of sprint"
          description={`Running total of students cleared, aligned on day of sprint. Current term ${view.term.key} is the solid line; prior captured sprints are dashed; dotted rules mark prior semesters' official nightly cleared totals${references.length ? ` (${references.map((r) => `${r.label} ${formatCount(r.value)}`).join(", ")})` : ""}.`}
        />
      ) : null}

      {view.benchmarks.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Prior same-season semesters: official nightly cleared totals</caption>
            <thead className="bg-surface-2 text-left">
              <tr>
                {["Semester", "Census", "Financially cleared", "Cleared % of census", "This sprint vs. that total"].map((h, i) => (
                  <th key={h} scope="col" className={`px-3 py-2 font-medium text-ink-2 whitespace-nowrap ${i > 0 ? "text-right" : ""}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {view.benchmarks.map((b) => (
                <tr key={b.termKey} className="border-t border-border">
                  <td className="px-3 py-1.5">
                    {b.label} <span className="font-mono text-xs text-ink-3">{b.termKey}</span>
                  </td>
                  <td className="px-3 py-1.5 text-right tabular">{formatCount(b.census)}</td>
                  <td className="px-3 py-1.5 text-right tabular">{formatCount(b.financiallyCleared)}</td>
                  <td className="px-3 py-1.5 text-right tabular text-ink-2">{formatPercent(b.clearedPctOfCensus)}</td>
                  <td className="px-3 py-1.5 text-right tabular">{formatPercent(b.currentVsBenchmarkPct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-ink-3 mt-2">
            Official nightly figures from the institution’s own semester table (A-2), captured at 9 pm and never written by this application. They are end-of-term totals, so early in a
            sprint this term will sit well below them; the sprint figure counts clearance actions inside the window only.
          </p>
        </div>
      ) : (
        <p className="text-xs text-ink-3">No prior same-season semester carries a nightly cleared figure, so there is no benchmark to draw.</p>
      )}
      {view.comparison.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Prior semester sprint totals</caption>
            <thead className="bg-surface-2 text-left">
              <tr>
                {["Semester", "Sprint days", "Total cleared", "Captured"].map((h, i) => (
                  <th key={h} scope="col" className={`px-3 py-2 font-medium text-ink-2 ${i > 0 ? "text-right" : ""}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...(view.currentSeries ? [{ ...view.currentSeries, isCurrent: true }] : []), ...view.comparison.map((s) => ({ ...s, isCurrent: false }))].map((s) => (
                <tr key={s.termKey} className="border-t border-border">
                  <td className="px-3 py-1.5 font-mono text-xs">
                    {s.termKey}
                    {s.isCurrent ? <span className="ml-2 font-sans text-ink-3">current</span> : null}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular">{formatCount(s.windowDays)}</td>
                  <td className="px-3 py-1.5 text-right tabular">{formatCount(s.total)}</td>
                  <td className="px-3 py-1.5 text-right text-ink-2">{formatDateTime(s.capturedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
