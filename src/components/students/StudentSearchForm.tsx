import Link from "next/link";

/**
 * Bio Spec 1.1–1.2 — the two searches, as one GET form.
 *
 * Plain HTML: no JavaScript is needed to search, every result set is a shareable URL, and the
 * browser remembers what was typed. The guard messages come from the service (one place decides what
 * is too broad a search) and render beside the fields rather than as an error page.
 *
 * The page-size control lives in this form so that changing it re-submits the search without a
 * `page` param — a new page size lands on page 1, which is the only page guaranteed to exist.
 */
export function StudentSearchForm({
  current,
  minNameLength,
  pageSizeOptions,
  error,
}: {
  current: { by: "name" | "id"; last: string; first: string; id: string; pageSize: number };
  minNameLength: number;
  pageSizeOptions: readonly number[];
  error: string | null;
}) {
  const field = "rounded-md border border-border bg-surface-1 px-3 py-2 text-sm";
  return (
    <form method="get" action="/students" className="card space-y-3" aria-label="Search for a student">
      <fieldset className="flex flex-wrap items-end gap-4">
        <legend className="sr-only">Search by</legend>

        <div className="flex items-center gap-4 pb-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="by" value="name" defaultChecked={current.by === "name"} /> By name
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="by" value="id" defaultChecked={current.by === "id"} /> By student ID
          </label>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="s-last" className="text-xs text-ink-2">Last name</label>
          <input id="s-last" name="last" defaultValue={current.last} className={field} autoComplete="off" spellCheck={false} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="s-first" className="text-xs text-ink-2">First name (optional)</label>
          <input id="s-first" name="first" defaultValue={current.first} className={field} autoComplete="off" spellCheck={false} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="s-id" className="text-xs text-ink-2">Student ID</label>
          <input id="s-id" name="id" defaultValue={current.id} inputMode="numeric" className={field} autoComplete="off" />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="s-page-size" className="text-xs text-ink-2">Results per page</label>
          <select id="s-page-size" name="pageSize" defaultValue={String(current.pageSize)} className={field}>
            {pageSizeOptions.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </div>

        <button type="submit" className="rounded-md bg-brand text-brand-ink px-4 py-2 text-sm font-medium">Search</button>
        <Link href="/students" className="text-sm text-ink-2 underline hover:no-underline">Reset</Link>
      </fieldset>

      {error ? (
        <p role="alert" className="text-sm text-critical">{error}</p>
      ) : (
        <p className="text-xs text-ink-3">
          Enter at least {minNameLength} characters of a last name, or at least two digits of an ID. A wildcard on its own is not accepted — it would return the whole student body.
        </p>
      )}
    </form>
  );
}
