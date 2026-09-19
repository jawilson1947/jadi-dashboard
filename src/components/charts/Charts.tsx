import { formatCount } from "@/lib/format";

/**
 * Server-rendered SVG charts (Spec §5). Deliberately dependency-free and static:
 *   - every chart is announced as an image with a title and a text description;
 *   - the numbers themselves always appear in a companion table next to the chart, so nothing
 *     is conveyed by the picture alone (or by colour alone — series are labelled);
 *   - no client JavaScript, so charts render in print and with scripting disabled.
 * Colours come from the theme tokens in globals.css — never hard-coded brand values.
 */

const AXIS = "var(--color-ink-3, #6b7280)";
const GRID = "var(--color-border, #d8dee6)";

/**
 * Value labels sit on every plotted point. Where points are dense the label rotates to vertical
 * rather than being dropped or overlapped — a number that cannot be read is worse than a tick mark.
 */
const LABEL = "var(--color-ink-2, #3f4754)";

function labelText(value: number): string {
  return formatCount(value);
}

function niceMax(value: number): number {
  if (value <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(value)));
  for (const step of [1, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10]) if (value <= step * pow) return step * pow;
  return 10 * pow;
}

export interface ColumnPoint {
  label: string;
  value: number;
  /** Rendered muted (e.g. days of the sprint that have not happened yet). */
  muted?: boolean;
  /** Marked with a rule and a label (e.g. today). */
  marked?: boolean;
}

/** Daily clearance counts (Spec §7.1). Bars are drawn edge-to-edge; only a few labels are shown. */
export function ColumnChart({ points, title, description, height = 230, valueLabel = "students cleared" }: { points: ColumnPoint[]; title: string; description: string; height?: number; valueLabel?: string }) {
  if (points.length === 0) return null;
  const width = 720;
  // Extra headroom at the top: every bar carries its value, rotated upright where bars are narrow.
  // Bottom gutter holds an upright category label for EVERY bar: a value with no period attached
  // tells the reader nothing, so no category is skipped.
  const padding = { top: 30, right: 8, bottom: 56, left: 44 };
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;
  const max = niceMax(Math.max(...points.map((p) => p.value)));
  const barW = plotW / points.length;
  const ticks = [0, max / 2, max];
  const wideBars = barW >= 44;

  return (
    <figure className="m-0">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto" role="img" aria-label={`${title}. ${description}`} preserveAspectRatio="none">
        <title>{title}</title>
        <desc>{description}</desc>
        {ticks.map((t) => {
          const y = padding.top + plotH - (t / max) * plotH;
          return (
            <g key={t}>
              <line x1={padding.left} x2={width - padding.right} y1={y} y2={y} stroke={GRID} strokeWidth={1} />
              <text x={padding.left - 6} y={y + 4} textAnchor="end" fontSize={11} fill={AXIS}>
                {formatCount(Math.round(t))}
              </text>
            </g>
          );
        })}
        {points.map((p, i) => {
          const h = max > 0 ? (p.value / max) * plotH : 0;
          const x = padding.left + i * barW;
          const y = padding.top + plotH - h;
          return (
            <g key={p.label}>
              <rect
                x={x + Math.min(1, barW * 0.1)}
                y={y}
                width={Math.max(1, barW - Math.min(2, barW * 0.2))}
                height={Math.max(p.value > 0 ? 1 : 0, h)}
                fill={p.muted ? GRID : "var(--color-brand, #2a78d6)"}
                opacity={p.muted ? 0.6 : 1}
              />
              {p.marked ? <line x1={x + barW / 2} x2={x + barW / 2} y1={padding.top} y2={padding.top + plotH} stroke={AXIS} strokeDasharray="3 3" strokeWidth={1} /> : null}
              {p.value > 0 ? (
                barW >= 26 ? (
                  <text x={x + barW / 2} y={y - 3} textAnchor="middle" fontSize={9} fill={LABEL}>
                    {labelText(p.value)}
                  </text>
                ) : (
                  <text x={x + barW / 2} y={y - 4} textAnchor="start" fontSize={9} fill={LABEL} transform={`rotate(-90 ${x + barW / 2} ${y - 4})`}>
                    {labelText(p.value)}
                  </text>
                )
              ) : null}
              {wideBars ? (
                <text x={x + barW / 2} y={height - 40} textAnchor="middle" fontSize={10} fill={AXIS}>
                  {p.label}
                </text>
              ) : (
                <text x={x + barW / 2} y={height - 48} textAnchor="end" fontSize={9} fill={AXIS} transform={`rotate(-90 ${x + barW / 2} ${height - 48})`}>
                  {p.label}
                </text>
              )}
            </g>
          );
        })}
        <line x1={padding.left} x2={width - padding.right} y1={padding.top + plotH} y2={padding.top + plotH} stroke={AXIS} strokeWidth={1} />
      </svg>
      <figcaption className="sr-only">
        {title} — {description} ({valueLabel})
      </figcaption>
    </figure>
  );
}

/** Horizontal bars for Cleared by operator (Spec §7.2) — labels sit beside each bar, never colour-coded. */
export function BarChart({ rows, title, description }: { rows: Array<{ label: string; value: number; muted?: boolean }>; title: string; description: string }) {
  if (rows.length === 0) return null;
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <figure className="m-0" role="img" aria-label={`${title}. ${description}`}>
      <ul className="space-y-1.5 list-none p-0 m-0">
        {rows.map((r) => (
          <li key={r.label} className="grid grid-cols-[minmax(7rem,12rem)_1fr_auto] items-center gap-2 text-xs">
            <span className="truncate text-ink-2" title={r.label}>
              {r.label}
            </span>
            <span className="h-3 rounded-sm bg-surface-2 overflow-hidden">
              <span className="block h-full rounded-sm" style={{ width: `${(r.value / max) * 100}%`, background: r.muted ? "var(--color-border)" : "var(--color-brand)" }} />
            </span>
            <span className="tabular text-ink-2">{formatCount(r.value)}</span>
          </li>
        ))}
      </ul>
      <figcaption className="sr-only">{description}</figcaption>
    </figure>
  );
}

/** Clustered bars for two or more measures per period (Spec §9.1's grouped-column view). */
export function GroupedColumnChart({
  groups,
  seriesNames,
  title,
  description,
  height = 260,
}: {
  groups: Array<{ label: string; values: Array<number | null> }>;
  seriesNames: string[];
  title: string;
  description: string;
  height?: number;
}) {
  if (groups.length === 0) return null;
  const width = 720;
  // Headroom for the per-bar value labels.
  // Every group is named, upright when the cluster is narrower than its label.
  const padding = { top: 32, right: 10, bottom: 58, left: 52 };
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;
  const max = niceMax(Math.max(...groups.flatMap((g) => g.values.map((v) => v ?? 0)), 1));
  const groupW = plotW / groups.length;
  const barW = (groupW * 0.8) / Math.max(1, seriesNames.length);
  const ticks = [0, max / 2, max];
  // Two measures, distinguished by fill AND by legend order — never by colour alone.
  const fills = ["var(--color-brand, #2a78d6)", "var(--color-brand-track, #d6e4f7)", "var(--color-ink-3, #6b7280)"];
  const wideGroups = groupW >= 64;

  return (
    <figure className="m-0">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto" role="img" aria-label={`${title}. ${description}`}>
        <title>{title}</title>
        <desc>{description}</desc>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padding.left} x2={width - padding.right} y1={padding.top + plotH - (t / max) * plotH} y2={padding.top + plotH - (t / max) * plotH} stroke={GRID} strokeWidth={1} />
            <text x={padding.left - 6} y={padding.top + plotH - (t / max) * plotH + 4} textAnchor="end" fontSize={11} fill={AXIS}>
              {formatCount(Math.round(t))}
            </text>
          </g>
        ))}
        {groups.map((g, gi) =>
          g.values.map((v, si) => {
            if (v === null) return null;
            const h = (v / max) * plotH;
            const x = padding.left + gi * groupW + groupW * 0.1 + si * barW;
            const barX = x + Math.max(1, barW - 1) / 2;
            const barY = padding.top + plotH - h;
            return (
              <g key={`${g.label}-${si}`}>
                <rect x={x} y={barY} width={Math.max(1, barW - 1)} height={Math.max(1, h)} fill={fills[si % fills.length]} stroke={GRID} strokeWidth={0.5} />
                {barW >= 26 ? (
                  <text x={barX} y={barY - 3} textAnchor="middle" fontSize={9} fill={LABEL}>
                    {labelText(v)}
                  </text>
                ) : (
                  <text x={barX} y={barY - 4} textAnchor="start" fontSize={9} fill={LABEL} transform={`rotate(-90 ${barX} ${barY - 4})`}>
                    {labelText(v)}
                  </text>
                )}
              </g>
            );
          }),
        )}
        {groups.map((g, gi) => {
          const cx = padding.left + gi * groupW + groupW / 2;
          return wideGroups ? (
            <text key={`l-${g.label}`} x={cx} y={height - 42} textAnchor="middle" fontSize={10} fill={AXIS}>
              {g.label}
            </text>
          ) : (
            <text key={`l-${g.label}`} x={cx} y={height - 50} textAnchor="end" fontSize={9} fill={AXIS} transform={`rotate(-90 ${cx} ${height - 50})`}>
              {g.label}
            </text>
          );
        })}
        <line x1={padding.left} x2={width - padding.right} y1={padding.top + plotH} y2={padding.top + plotH} stroke={AXIS} strokeWidth={1} />
      </svg>
      <ul className="flex flex-wrap gap-3 text-xs text-ink-2 list-none p-0 mt-1">
        {seriesNames.map((n, i) => (
          <li key={n} className="flex items-center gap-1.5">
            <span aria-hidden className="inline-block h-3 w-3 rounded-sm border border-border" style={{ background: fills[i % fills.length] }} />
            {n}
          </li>
        ))}
      </ul>
      <figcaption className="sr-only">{description}</figcaption>
    </figure>
  );
}

export interface LineSeries {
  key: string;
  label: string;
  /** Dashed + lighter for prior semesters so the current term reads first without relying on colour. */
  emphasis?: "primary" | "secondary";
  points: Array<{ x: number; y: number }>;
}

/** A horizontal target drawn across the plot — a prior semester's final total (Spec §7.4). */
export interface ReferenceLine {
  label: string;
  value: number;
}

/** Cumulative curves aligned on day-of-sprint (Spec §7.4 same-point comparison). */
export function LineChart({
  series,
  references = [],
  pointLabels,
  title,
  description,
  xLabel = "Day of sprint",
  startLabel,
  endLabel,
  height = 240,
}: {
  series: LineSeries[];
  references?: ReferenceLine[];
  /**
   * The name of each x position — semesters, school years, whatever the points actually are.
   * When present, EVERY point is named on the axis instead of just the two ends: a value floating on
   * a line with no period attached to it is not information.
   */
  pointLabels?: string[];
  title: string;
  description: string;
  xLabel?: string;
  /** Axis end labels, used only when `pointLabels` is not supplied (the sprint's "Day 1 … Day N"). */
  startLabel?: string;
  endLabel?: string;
  height?: number;
}) {
  const all = series.flatMap((s) => s.points);
  if (all.length === 0) return null;
  const width = 720;
  // Headroom for value labels, a wider left gutter for the axis, and a deep bottom gutter when every
  // x position carries its own name.
  const padding = { top: 26, right: 16, bottom: pointLabels ? 76 : 30, left: 56 };
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;
  const maxX = Math.max(...all.map((p) => p.x), 1);
  const maxY = niceMax(Math.max(...all.map((p) => p.y), ...references.map((r) => r.value)));
  const sx = (x: number) => padding.left + ((x - 1) / Math.max(1, maxX - 1)) * plotW;
  const sy = (y: number) => padding.top + plotH - (y / maxY) * plotH;
  const ticks = [0, maxY / 2, maxY];

  return (
    <figure className="m-0">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto" role="img" aria-label={`${title}. ${description}`}>
        <title>{title}</title>
        <desc>{description}</desc>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padding.left} x2={width - padding.right} y1={sy(t)} y2={sy(t)} stroke={GRID} strokeWidth={1} />
            <text x={padding.left - 6} y={sy(t) + 4} textAnchor="end" fontSize={11} fill={AXIS}>
              {formatCount(Math.round(t))}
            </text>
          </g>
        ))}
        {references.map((r) => (
          <g key={r.label}>
            <line x1={padding.left} x2={width - padding.right} y1={sy(r.value)} y2={sy(r.value)} stroke={AXIS} strokeWidth={1} strokeDasharray="2 4" />
            <text x={width - padding.right} y={sy(r.value) - 4} textAnchor="end" fontSize={11} fill={AXIS}>
              {r.label} {formatCount(r.value)}
            </text>
          </g>
        ))}
        {series.map((s, i) => (
          <polyline
            key={s.key}
            fill="none"
            stroke={s.emphasis === "secondary" ? AXIS : "var(--color-brand, #2a78d6)"}
            strokeWidth={s.emphasis === "secondary" ? 1.5 : 2.5}
            strokeDasharray={s.emphasis === "secondary" ? `${4 + i} ${3 + i}` : undefined}
            points={s.points.map((p) => `${sx(p.x)},${sy(p.y)}`).join(" ")}
          />
        ))}
        {/* A marker and its value on every point. Labels alternate above and below the line, and turn
            upright when points are closer together than a number is wide, so none of them collide. */}
        {series.map((s) => {
          const spacing = s.points.length > 1 ? plotW / (s.points.length - 1) : plotW;
          return s.points.map((p, pi) => {
            const cx = sx(p.x);
            const cy = sy(p.y);
            const above = pi % 2 === 0;
            const stroke = s.emphasis === "secondary" ? AXIS : "var(--color-brand, #2a78d6)";
            return (
              <g key={`${s.key}-${p.x}`}>
                <circle cx={cx} cy={cy} r={s.emphasis === "secondary" ? 1.8 : 2.4} fill={stroke} />
                {spacing >= 30 ? (
                  <text x={cx} y={above ? cy - 7 : cy + 13} textAnchor="middle" fontSize={9} fill={LABEL}>
                    {labelText(p.y)}
                  </text>
                ) : (
                  <text x={cx} y={cy - 6} textAnchor="start" fontSize={9} fill={LABEL} transform={`rotate(-90 ${cx} ${cy - 6})`}>
                    {labelText(p.y)}
                  </text>
                )}
              </g>
            );
          });
        })}
        <line x1={padding.left} x2={width - padding.right} y1={padding.top + plotH} y2={padding.top + plotH} stroke={AXIS} strokeWidth={1} />
        {pointLabels ? (
          pointLabels.map((label, i) => {
            const cx = sx(i + 1);
            const wide = plotW / Math.max(1, pointLabels.length) >= 56;
            return wide ? (
              <text key={`${label}-${i}`} x={cx} y={padding.top + plotH + 16} textAnchor="middle" fontSize={10} fill={AXIS}>
                {label}
              </text>
            ) : (
              <text key={`${label}-${i}`} x={cx} y={padding.top + plotH + 8} textAnchor="end" fontSize={9} fill={AXIS} transform={`rotate(-90 ${cx} ${padding.top + plotH + 8})`}>
                {label}
              </text>
            );
          })
        ) : (
          <>
            <text x={padding.left} y={height - 8} fontSize={11} fill={AXIS}>
              {startLabel ?? "Day 1"}
            </text>
            <text x={width - padding.right} y={height - 8} fontSize={11} fill={AXIS} textAnchor="end">
              {endLabel ?? `${xLabel} ${maxX}`}
            </text>
          </>
        )}
      </svg>
      <ul className="flex flex-wrap gap-3 text-xs text-ink-2 list-none p-0 mt-1">
        {series.map((s, i) => (
          <li key={s.key} className="flex items-center gap-1.5">
            <svg width="22" height="8" aria-hidden className="shrink-0">
              <line
                x1="0"
                y1="4"
                x2="22"
                y2="4"
                stroke={s.emphasis === "secondary" ? AXIS : "var(--color-brand, #2a78d6)"}
                strokeWidth={s.emphasis === "secondary" ? 1.5 : 2.5}
                strokeDasharray={s.emphasis === "secondary" ? `${4 + i} ${3 + i}` : undefined}
              />
            </svg>
            {s.label}
          </li>
        ))}
      </ul>
      <figcaption className="sr-only">{description}</figcaption>
    </figure>
  );
}
