/**
 * Presentation-layer formatting (Spec §5, §15). The API returns raw typed values;
 * this is the ONLY place values become display strings.
 */

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const count = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const pct2 = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function formatCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return usd.format(value);
}

export function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return count.format(value);
}

/** Percentages to two decimals; null renders as N/A (division by zero rule, App. B). */
export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "N/A";
  return `${pct2.format(value)}%`;
}

export function formatSignedCount(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const s = count.format(Math.abs(value));
  return value > 0 ? `+${s}` : value < 0 ? `−${s}` : s;
}

export function formatDateTime(value: Date | string | null | undefined, timeZone = "America/Chicago"): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(d);
}

/** Mask a PID to its last four characters (ASSUMPTIONS A-3). */
export function maskPid(pid: string | null | undefined): string {
  if (!pid) return "—";
  return pid.length <= 4 ? "••••" : `•••••${pid.slice(-4)}`;
}
