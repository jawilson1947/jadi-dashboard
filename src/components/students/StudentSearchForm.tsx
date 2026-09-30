"use client";

import { useRef } from "react";
import Link from "next/link";

/**
 * Bio Spec 1.1–1.2 — the two searches, as one GET form.
 *
 * Still plain HTML underneath: it is a GET form, every result set is a shareable URL, and it
 * submits and searches correctly with scripting off. The guard messages come from the service (one
 * place decides what is too broad a search) and render beside the fields rather than as an error page.
 *
 * The one thing script adds is housekeeping: picking a search mode clears the fields belonging to
 * the other one, so a leftover ID cannot sit under a name search looking like it counts. The server
 * already ignores the fields the chosen mode does not use, so this changes what the form *says*,
 * not what it does — which is exactly why it is safe to lose when scripting is off.
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

  // Uncontrolled inputs, cleared by hand: the browser stays in charge of what was typed, and this
  // stays a form rather than becoming a piece of state to keep in sync with the URL.
  const lastRef = useRef<HTMLInputElement>(null);
  const firstRef = useRef<HTMLInputElement>(null);
  const idRef = useRef<HTMLInputElement>(null);

  const chooseMode = (mode: "name" | "id") => {
    const clear = mode === "name" ? [idRef] : [lastRef, firstRef];
    for (const ref of clear) {
      if (ref.current) ref.current.value = "";
    }
  };

  return (
    <form method="get" action="/students" className="card space-y-3" aria-label="Search for a student">
      <fieldset className="flex flex-wrap items-end gap-4">
        <legend className="sr-only">Search by</legend>

        <div className="flex items-center gap-4 pb-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="by" value="name" defaultChecked={current.by === "name"} onChange={() => chooseMode("name")} /> By name
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="by" value="id" defaultChecked={current.by === "id"} onChange={() => chooseMode("id")} /> By student ID
          </label>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="s-last" className="text-xs text-ink-2">Last name</label>
          <input ref={lastRef} id="s-last" name="last" defaultValue={current.last} className={field} autoComplete="off" spellCheck={false} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="s-first" className="text-xs text-ink-2">First name (optional)</label>
          <input ref={firstRef} id="s-first" name="first" defaultValue={current.first} className={field} autoComplete="off" spellCheck={false} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="s-id" className="text-xs text-ink-2">Student ID</label>
          <input ref={idRef} id="s-id" name="id" defaultValue={current.id} inputMode="numeric" className={field} autoComplete="off" />
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
