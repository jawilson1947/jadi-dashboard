/**
 * Calendar-date helpers for the clearance sprint (Spec §7, ASSUMPTIONS A-10, A-15).
 *
 * A sprint window is a pair of CALENDAR DATES in the institution timezone, carried as
 * "YYYY-MM-DD" strings. Timestamps are only converted to a calendar date at the boundary
 * (`toIsoDate`); everything else is plain string/integer arithmetic, so a window never shifts because
 * the server runs in UTC or crosses a DST change.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Calendar date of an instant in the institution timezone (en-CA gives YYYY-MM-DD). */
export function toIsoDate(value: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(value);
}

/** Today in the institution timezone. */
export function todayIso(timeZone: string, now: Date = new Date()): string {
  return toIsoDate(now, timeZone);
}

export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

/** Every calendar date in [start, end], inclusive. Empty when the range is inverted. */
export function eachDate(start: string, end: string): string[] {
  const n = daysBetween(start, end);
  if (n < 0) return [];
  return Array.from({ length: n + 1 }, (_, i) => addDays(start, i));
}

export function clampIso(value: string, min: string, max: string): string {
  return value < min ? min : value > max ? max : value;
}

/** Display form of a calendar date — parsed as a date, never as an instant, so it cannot shift a day. */
export function formatIsoDate(iso: string | null | undefined, style: "medium" | "short" = "medium"): string {
  if (!iso || !isIsoDate(iso)) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { dateStyle: style, timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** "Day 14" position of a date within a sprint (1-based); null when outside the window. */
export function dayOfSprint(iso: string, start: string, end: string): number | null {
  if (iso < start || iso > end) return null;
  return daysBetween(start, iso) + 1;
}
