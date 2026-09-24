import Link from "next/link";
import { z } from "zod";
import { getPrincipal } from "@/server/auth/session";
import { hasPermission, requirePermission } from "@/server/authz/permissions";
import { audit } from "@/server/audit/audit";
import { getConfig } from "@/server/db/config";
import { getHistoryView, type AcademicYearRow, type HistoryView, type TermSeriesPoint } from "@/server/services/history";
import { formatCount, formatCurrency, formatDateTime, formatPercent } from "@/lib/format";
import { PageHeader } from "@/components/layout/PageHeader";
import { PrintButton } from "@/components/print/PrintButton";
import { PrintHeader } from "@/components/print/PrintHeader";
import { GroupedColumnChart, LineChart } from "@/components/charts/Charts";

export const metadata = { title: "Historical Analysis" };
export const dynamic = "force-dynamic";

const paramsSchema = z.object({
  from: z.string().max(20).optional(),
  to: z.string().max(20).optional(),
  groupBy: z.enum(["semester", "schoolYear"]).default("semester"),
  chart: z.enum(["column", "line"]).default("column"),
});

/**
 * Historical Analysis (Spec §9). Snapshot-backed like every other screen (§19, §9.4): the trends read
 * captured figures, so a chart cannot quietly change shape between two viewings.
 * Decisions on this page: summer omitted (A-23), negative balances secondary and never netted (A-5),
 * tblStudent.AccountBalance authoritative (A-18), nightly tblOUSA figures official (A-2).
 */
export default async function HistoricalPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const principal = requirePermission(await getPrincipal(), "history.view");
  const q = paramsSchema.parse(await searchParams);
  const view = await getHistoryView({ from: q.from, to: q.to, groupBy: q.groupBy });
  const tz = getConfig().APP_TIMEZONE;
  const canExport = hasPermission(principal, "export.create");
  await audit(principal, "dashboard.view", { targetType: "module", targetId: "historical", metadata: { from: view.range.from, to: view.range.to, groupBy: q.groupBy } });

  const captured = [view.enrollment.capturedAt, view.balances.capturedAt, view.receivables.capturedAt].filter((c): c is string => !!c).sort();

  return (
    <>
      <PageHeader
        title="Historical Analysis"
        description={`${view.series.length} semesters on record${view.series.length ? ` · ${view.series[0].label} → ${view.series.at(-1)!.label}` : ""}${captured.length ? ` · captured ${formatDateTime(captured.at(-1)!, tz)}` : ""}`}
        actions={<PrintButton />}
      />
      <PrintHeader title="Historical Analysis" subtitle={`Academic years ${view.range.from} → ${view.range.to}`} semester="All semesters on record" capturedAt={captured.at(-1) ?? null} printedBy={principal.displayName} timeZone={tz} />

      <TrendCharts series={view.series} />
      <EnrollmentSection view={view} chart={q.chart} groupBy={q.groupBy} />
      <BalancesSection view={view} />
      <ReceivablesSection view={view} groupBy={q.groupBy} from={view.range.from} to={view.range.to} chart={q.chart} canExport={canExport} />
    </>
  );
}

/**
 * Axis form of a semester name: "Fall 2015" → "Fall 15". Two dozen names share one axis, so the
 * century digits are dropped — the year is still unambiguous and the season, which is what
 * distinguishes adjacent points, stays spelled out.
 */
function shortSemester(label: string): string {
  return label.replace(/\b(\d{2})(\d{2})\b/, "$2").trim();
}

/**
 * The two full-record trends (census, financially cleared) — the whole history, not the picked range.
 * Each gets its own full-width card, stacked with Census first (2026-09-24, Jim): side by side, each
 * chart had half the horizontal room for every semester on record, which is exactly the axis that
 * needs the space.
 */
function TrendCharts({ series }: { series: TermSeriesPoint[] }) {
  if (series.length === 0) {
    return (
      <section className="card">
        <h2 className="text-sm font-medium text-ink-2">Census and clearance trends</h2>
        <p className="text-sm text-ink-2 mt-2">No semester has a captured census or cleared figure yet.</p>
      </section>
    );
  }
  const first = series[0].label;
  const last = series.at(-1)!.label;
  const points = (pick: (p: TermSeriesPoint) => number | null) => series.map((p, i) => ({ x: i + 1, y: pick(p) ?? 0 })).filter((_, i) => pick(series[i]) !== null);

  const charts = [
    { key: "census", heading: "Census", label: "Students enrolled at census", get: (p: TermSeriesPoint) => p.census },
    { key: "cleared", heading: "Financially cleared", label: "Students financially cleared", get: (p: TermSeriesPoint) => p.cleared },
  ] as const;

  return (
    <div className="space-y-4 print-stack">
      {charts.map((c) => (
        <section key={c.key} className="card space-y-2">
          <h2 className="text-sm font-medium text-ink-2">{c.heading} — every semester on record</h2>
          <LineChart
            series={[{ key: c.key, label: c.label, emphasis: "primary", points: points(c.get) }]}
            pointLabels={series.filter((p) => c.get(p) !== null).map((p) => shortSemester(p.label))}
            title={`${c.heading} by semester, ${first} to ${last}`}
            description={`${c.label} for each of the ${series.length} semesters with a captured figure, oldest first, each point named with its semester. Summer terms are omitted; semesters with no captured figure are left out rather than drawn as zero.`}
            height={300}
          />
          <details className="text-xs">
            <summary className="cursor-pointer text-ink-2">Figures behind this chart</summary>
            <table className="w-full mt-2">
              <caption className="sr-only">{c.heading} per semester</caption>
              <thead className="text-left text-ink-3">
                <tr>
                  <th scope="col" className="py-1 font-medium">Semester</th>
                  <th scope="col" className="py-1 font-medium text-right">{c.heading}</th>
                </tr>
              </thead>
              <tbody>
                {series.map((p) => (
                  <tr key={p.termKey} className="border-t border-border/60">
                    <td className="py-1">{p.label}</td>
                    <td className="py-1 text-right tabular">{c.get(p) === null ? "—" : formatCount(c.get(p))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </section>
      ))}
    </div>
  );
}

/** §9.1 — Fall + following Spring, with a grouped-column or line view over one table. */
function EnrollmentSection({ view, chart, groupBy }: { view: HistoryView; chart: "column" | "line"; groupBy: string }) {
  const rows = view.enrollment.value ?? [];
  const href = (patch: Record<string, string>) => {
    const p = new URLSearchParams({ from: view.range.from, to: view.range.to, groupBy, chart, ...patch });
    return `/historical?${p.toString()}`;
  };

  return (
    <section className="card space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-sm font-medium text-ink-2">Enrolled vs. financially cleared, by academic year</h2>
        <form method="get" action="/historical" className="flex flex-wrap items-end gap-2 ml-auto no-print">
          <input type="hidden" name="groupBy" value={groupBy} />
          <input type="hidden" name="chart" value={chart} />
          {(["from", "to"] as const).map((k) => (
            <span key={k} className="flex flex-col gap-1">
              <label htmlFor={`range-${k}`} className="text-xs text-ink-2">
                {k === "from" ? "From" : "To"}
              </label>
              <select id={`range-${k}`} name={k} defaultValue={view.range[k]} className="rounded-md border border-border bg-surface-1 px-2 py-1 text-sm">
                {view.range.available.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </span>
          ))}
          <button type="submit" className="rounded-md bg-brand text-brand-ink px-3 py-1.5 text-sm">
            Apply
          </button>
        </form>
        <span className="text-xs no-print">
          <Link href={href({ chart: chart === "column" ? "line" : "column" })} className="text-brand">
            {chart === "column" ? "Switch to line view" : "Switch to column view"}
          </Link>
        </span>
      </div>

      {rows.length === 0 ? (
        <p role="status" className="text-sm text-ink-2">
          {view.enrollment.error ?? "No captured figures for this range."}
        </p>
      ) : chart === "column" ? (
        <GroupedColumnChart
          groups={rows.map((r) => ({ label: r.academicYear, values: [r.totalCensus, r.totalCleared] }))}
          seriesNames={["Census (Fall + Spring)", "Financially cleared (Fall + Spring)"]}
          title="Census and financially cleared by academic year"
          description={`Academic years ${view.range.from} to ${view.range.to}. Each year pairs Fall with the following Spring; summer terms are omitted. The table below carries the same numbers.`}
        />
      ) : (
        <LineChart
          series={[
            { key: "census", label: "Census (Fall + Spring)", emphasis: "primary", points: rows.map((r, i) => ({ x: i + 1, y: r.totalCensus ?? 0 })) },
            { key: "cleared", label: "Financially cleared (Fall + Spring)", emphasis: "secondary", points: rows.map((r, i) => ({ x: i + 1, y: r.totalCleared ?? 0 })) },
          ]}
          pointLabels={rows.map((r) => r.academicYear)}
          title="Census and financially cleared by academic year"
          description={`Academic years ${view.range.from} to ${view.range.to}, census against financially cleared, each point named with its academic year.`}
          height={300}
        />
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">Census and financially cleared per academic year</caption>
          <thead className="bg-surface-2 text-left">
            <tr>
              {["Academic year", "Fall census", "Fall cleared", "Fall %", "Spring census", "Spring cleared", "Spring %", "Year %"].map((h, i) => (
                <th key={h} scope="col" className={`px-3 py-2 font-medium text-ink-2 whitespace-nowrap ${i > 0 ? "text-right" : ""}`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r: AcademicYearRow) => (
              <tr key={r.academicYear} className="border-t border-border">
                <td className="px-3 py-1.5 whitespace-nowrap">{r.academicYear}</td>
                <td className="px-3 py-1.5 text-right tabular">{r.fall?.census === undefined || r.fall?.census === null ? "—" : formatCount(r.fall.census)}</td>
                <td className="px-3 py-1.5 text-right tabular">{r.fall?.cleared === undefined || r.fall?.cleared === null ? "—" : formatCount(r.fall.cleared)}</td>
                <td className="px-3 py-1.5 text-right tabular text-ink-2">{formatPercent(r.fall?.clearedPct ?? null)}</td>
                <td className="px-3 py-1.5 text-right tabular">{r.spring?.census === undefined || r.spring?.census === null ? "—" : formatCount(r.spring.census)}</td>
                <td className="px-3 py-1.5 text-right tabular">{r.spring?.cleared === undefined || r.spring?.cleared === null ? "—" : formatCount(r.spring.cleared)}</td>
                <td className="px-3 py-1.5 text-right tabular text-ink-2">{formatPercent(r.spring?.clearedPct ?? null)}</td>
                <td className="px-3 py-1.5 text-right tabular font-medium">{formatPercent(r.clearedPct)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-ink-3">
        Figures are the institution’s own nightly captures (A-2), never recomputed here. A dash means no figure was captured for that term — not zero students. Summer terms are omitted
        (A-23).
      </p>
    </section>
  );
}

/** §9.2 — global receivables, with credit balances demoted to a secondary line (A-5). */
function BalancesSection({ view }: { view: HistoryView }) {
  const b = view.balances.value;
  return (
    <section className="card space-y-2">
      <h2 className="text-sm font-medium text-ink-2">Global receivables</h2>
      {b ? (
        <>
          <p className="text-3xl font-semibold tabular">{formatCurrency(b.positiveTotal)}</p>
          <p className="text-sm text-ink-2">
            owed across {formatCount(b.positiveCount)} students carrying a debit balance · {formatCount(b.zeroCount)} at zero
          </p>
          <p className="text-xs text-ink-3">
            {view.labels.credits}: {formatCurrency(b.negativeTotal)} across {formatCount(b.negativeCount)} students. Shown for completeness only — credit balances are not treated as
            payments and are never netted against what is owed (A-5).
          </p>
          <p className="text-xs text-ink-3">Source: the authoritative account-balance column (A-18, decided 2026-09-18).</p>
        </>
      ) : (
        <p role="status" className="text-sm text-ink-2">
          {view.balances.error ?? "This metric could not be loaded."}
        </p>
      )}
    </section>
  );
}

/** §9.3 — receivables by semester, with the two reconciliation lines that keep the total honest. */
function ReceivablesSection({
  view,
  groupBy,
  from,
  to,
  chart,
  canExport,
}: {
  view: HistoryView;
  groupBy: "semester" | "schoolYear";
  from: string;
  to: string;
  chart: string;
  canExport: boolean;
}) {
  const r = view.receivables.value;
  const href = (patch: Record<string, string>) => `/historical?${new URLSearchParams({ from, to, groupBy, chart, ...patch }).toString()}`;

  return (
    <section className="card space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-sm font-medium text-ink-2">Receivables by {groupBy === "semester" ? "semester" : "school year"}</h2>
        <span className="text-xs no-print">
          <Link href={href({ groupBy: groupBy === "semester" ? "schoolYear" : "semester" })} className="text-brand">
            {groupBy === "semester" ? "Group by school year" : "Group by semester"}
          </Link>
        </span>
        {canExport && r ? (
          <form method="post" action="/api/v1/history/receivables/export" className="ml-auto no-print">
            <input type="hidden" name="groupBy" value={groupBy} />
            <button type="submit" className="rounded-md border border-border px-3 py-2 text-sm hover:bg-surface-2">
              Export CSV ({formatCount(r.rows.length)})
            </button>
          </form>
        ) : null}
      </div>

      {!r ? (
        <p role="status" className="text-sm text-ink-2">
          {view.receivables.error ?? "This metric could not be loaded."}
        </p>
      ) : (
        <>
          <LineChart
            series={[{ key: "receivable", label: "Debit balances", emphasis: "primary", points: r.rows.map((row, i) => ({ x: i + 1, y: row.positiveBalance })) }]}
            pointLabels={r.rows.map((row) => shortSemester(row.label))}
            title={`Debit balances by ${groupBy === "semester" ? "semester" : "school year"}`}
            description={`Total owed by students whose last semester of record falls in each ${groupBy === "semester" ? "semester" : "school year"}, oldest first, each point named. This groups by the term a student's record sits in, not by whether they were cleared for it. Summer terms and unmatched codes are listed below the table rather than plotted.`}
            height={300}
          />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Debit balances grouped by last semester of record</caption>
              <thead className="bg-surface-2 text-left">
                <tr>
                  {[groupBy === "semester" ? "Semester" : "School year", "Accounts", "Debit balance"].map((h, i) => (
                    <th key={h} scope="col" className={`px-3 py-2 font-medium text-ink-2 whitespace-nowrap ${i > 0 ? "text-right" : ""}`}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {r.rows.map((row) => (
                  <tr key={row.key} className={`border-t border-border ${row.isCurrent ? "bg-brand-track/40" : ""}`}>
                    <td className="px-3 py-1.5 whitespace-nowrap">
                      {row.label}
                      {row.isCurrent ? <span className="ml-2 text-xs text-ink-3">current</span> : null}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular">{formatCount(row.students)}</td>
                    <td className="px-3 py-1.5 text-right tabular">{formatCurrency(row.positiveBalance)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="text-ink-2">
                <tr className="border-t border-border">
                  <td className="px-3 py-1.5">Excluded terms (summer)</td>
                  <td className="px-3 py-1.5 text-right tabular">{formatCount(r.excluded.students)}</td>
                  <td className="px-3 py-1.5 text-right tabular">{formatCurrency(r.excluded.positiveBalance)}</td>
                </tr>
                <tr>
                  <td className="px-3 py-1.5">No semester on record</td>
                  <td className="px-3 py-1.5 text-right tabular">{formatCount(r.neverCleared.students)}</td>
                  <td className="px-3 py-1.5 text-right tabular">{formatCurrency(r.neverCleared.positiveBalance)}</td>
                </tr>
                {r.unknown.students > 0 ? (
                  <tr>
                    <td className="px-3 py-1.5 text-warning">Unmatched term codes ({r.unknown.terms.slice(0, 5).join(", ")})</td>
                    <td className="px-3 py-1.5 text-right tabular">{formatCount(r.unknown.students)}</td>
                    <td className="px-3 py-1.5 text-right tabular">{formatCurrency(r.unknown.positiveBalance)}</td>
                  </tr>
                ) : null}
                <tr className="border-t-2 border-border font-semibold">
                  <td className="px-3 py-1.5">Total</td>
                  <td className="px-3 py-1.5 text-right tabular">{formatCount(r.totalStudents)}</td>
                  <td className="px-3 py-1.5 text-right tabular">{formatCurrency(r.total)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className={`text-xs ${view.reconciles === false ? "text-warning" : "text-ink-3"}`}>
            {view.reconciles === null
              ? "Reconciliation against global receivables is unavailable until both metrics have been captured."
              : view.reconciles
                ? "This total reconciles exactly with Global receivables above — every dollar owed is accounted for in one of these lines."
                : "⚠ This total does not match Global receivables above. Report it: the two figures come from the same column and must agree."}
          </p>
        </>
      )}
    </section>
  );
}
