/**
 * Return-to-results plumbing for Student Lookup.
 *
 * A profile opened from the lookup carries the exact list URL it came from in `?from=`, so
 * "Return to results" lands back on the result card — same page, same page size, same row
 * highlighted — instead of an empty search form. The value is a same-origin path and nothing
 * else: it is echoed into an href, so it is validated rather than trusted.
 */

/** Long enough for a name search plus paging and a row anchor; short enough to bound the URL. */
const MAX_RETURN_TO = 400;

/**
 * Accept only a lookup-page path. A leading "//" would be protocol-relative (an off-site
 * redirect wearing a path's clothes), and control characters have no business in an href.
 */
export function parseReturnTo(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (value.length === 0 || value.length > MAX_RETURN_TO) return null;
  if (!value.startsWith("/students?")) return null;
  if (value.startsWith("//") || /[\u0000-\u001f\u007f]/.test(value)) return null;
  return value;
}

/** Append `from` to an href, preserving whichever separator the href already needs. */
export function withReturnTo(href: string, returnTo: string | null): string {
  if (!returnTo) return href;
  return `${href}${href.includes("?") ? "&" : "?"}from=${encodeURIComponent(returnTo)}`;
}

/** Anchor id for a result row, so the browser restores the scroll position itself. */
export const rowAnchorId = (key: string) => `row-${key}`;
