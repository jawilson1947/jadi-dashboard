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

/**
 * Bio Spec 1.3: `clearedon` is documented as YYYYMMDD, but the column is `varchar(50)` — and a free-text
 * date column collects shapes over the years. Rather than show a blank for anything that is not
 * exactly eight digits, this reads the forms that actually turn up in such a column:
 *
 *   20260715 · 20260806110107.143 · 2026-07-15 · 2026/07/15 · 07/15/2026 · 7/15/2026
 *   and any of these with a time after them
 *
 * The second of those is what staging actually holds (confirmed 2026-09-24 on idnumber 181083):
 * YYYYMMDDhhmmss.fff run together, with no separator to split a time off. Only the date part is
 * shown — the card answers "which day was this student cleared", not the millisecond.
 *
 * Anything else still returns null, and the caller shows the raw text rather than hiding it, so an
 * unrecognised value is visible instead of looking like an empty field.
 */
export function parseCompactDate(value: string | null | undefined): string | null {
  if (!value) return null;
  // Take the date part: everything before the first space or "T" (a time component is not a date).
  const v = value.trim().split(/[ T]/)[0];
  if (v === "") return null;

  const build = (y: number, m: number, d: number): string | null => {
    if (!y || !m || !d || m < 1 || m > 12 || d < 1 || d > 31) return null;
    const iso = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const parsed = new Date(`${iso}T00:00:00Z`);
    // Reject a date that does not exist (31 February rolls over rather than failing to parse).
    return Number.isNaN(parsed.getTime()) || parsed.getUTCDate() !== d ? null : iso;
  };

  let m: RegExpExecArray | null;
  // All digits: 8 for a date, optionally followed by a run-together time (hhmm, hhmmss, .fff).
  if ((m = /^(\d{4})(\d{2})(\d{2})(?:\d{2,6})?(?:\.\d+)?$/.exec(v))) return build(+m[1], +m[2], +m[3]);
  if ((m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(v))) return build(+m[1], +m[2], +m[3]);
  // US order, which is what the Bio Spec's own substring expression renders: MM/DD/YYYY.
  if ((m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(v))) return build(+m[3], +m[1], +m[2]);
  return null;
}

/** ISO date for display, or an em dash. Parsed as a calendar date so it cannot shift a day. */
export function formatIsoDateSafe(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return "—";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
}
