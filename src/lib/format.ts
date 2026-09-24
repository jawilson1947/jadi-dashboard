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

/**
 * Mask a date of birth to its year (A-29). The year is enough to tell two records apart and to sanity-check
 * an age; the day and month are the part that identifies a person, so they never leave the server
 * unless the caller holds student.pii.view.
 */
export function maskDob(iso: string | null | undefined): string {
  if (!iso || iso.length < 4) return "—";
  return `${iso.slice(0, 4)} (year only)`;
}

/** Bio Spec 1.3: clearedon is stored as YYYYMMDD. Returns an ISO date, or null when unparseable. */
export function parseCompactDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = value.trim();
  if (!/^\d{8}$/.test(v)) return null;
  const iso = `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;
  return Number.isNaN(Date.parse(`${iso}T00:00:00Z`)) ? null : iso;
}

/** ISO date for display, or an em dash. Parsed as a calendar date so it cannot shift a day. */
export function formatIsoDateSafe(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return "—";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
}
