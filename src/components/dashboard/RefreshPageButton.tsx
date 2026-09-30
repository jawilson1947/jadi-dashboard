"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export interface RefreshJob {
  key: string;
  label: string;
}

interface Outcome {
  label: string;
  status: string;
  errorSummary: string | null;
}

/**
 * "Refresh" for the Current Semester dashboard (Spec §6).
 *
 * Walks the page's snapshot jobs one at a time rather than firing a single opaque request. Each of
 * these is a 40-120 s source query (FINDINGS §6), so a lone spinner over the whole set would be
 * indistinguishable from a hang. Stepping through them lets the person see which figure is being
 * recomputed, and a job that fails does not discard the ones that already succeeded.
 *
 * The animation is decorative. Every state is also announced as text inside an aria-live region,
 * and prefers-reduced-motion stops the movement without removing the element (globals.css).
 */
export function RefreshPageButton({ jobs }: { jobs: RefreshJob[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);
  const [current, setCurrent] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<Outcome[] | null>(null);

  async function refreshAll() {
    setBusy(true);
    setDone(0);
    setOutcomes(null);
    const results: Outcome[] = [];

    for (const job of jobs) {
      setCurrent(job.label);
      try {
        const res = await fetch("/api/v1/dashboard/refresh", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ job: job.key }),
        });
        const body = await res.json().catch(() => null);
        results.push({
          label: job.label,
          status: body?.data?.status ?? `HTTP ${res.status}`,
          errorSummary: body?.data?.errorSummary ?? body?.error?.message ?? null,
        });
      } catch {
        // A dropped request is reported like any other failure, and the loop continues, so one
        // network blip does not abandon the remaining jobs.
        results.push({ label: job.label, status: "FAILED", errorSummary: "Request did not complete." });
      }
      setDone((n) => n + 1);
    }

    setCurrent(null);
    setOutcomes(results);
    setBusy(false);
    // Re-read the page's server components so the new snapshots are what gets drawn.
    router.refresh();
  }

  const failed = outcomes?.filter((o) => o.status === "FAILED") ?? [];
  const skipped = outcomes?.filter((o) => o.status === "SKIPPED_OVERLAP") ?? [];
  const pctDone = jobs.length ? Math.round((100 * done) / jobs.length) : 0;

  return (
    <span className="inline-flex items-center gap-3 no-print">
      {/* One live region for every state, so the announcement is not split across elements. */}
      <span role="status" aria-live="polite" className="text-xs text-ink-3 min-w-0">
        {busy ? (
          <span className="inline-flex items-center gap-2">
            <span className="jadi-spinner text-brand" aria-hidden />
            <span className="whitespace-nowrap">
              Refreshing {Math.min(done + 1, jobs.length)} of {jobs.length}
              {current ? ` — ${current}` : ""}
            </span>
          </span>
        ) : outcomes ? (
          failed.length > 0 ? (
            <span className="text-warning">
              <span aria-hidden>⚠</span> {failed.length} of {jobs.length} failed: {failed.map((f) => f.label).join(", ")}
              {failed[0].errorSummary ? ` — ${failed[0].errorSummary}` : ""}
            </span>
          ) : skipped.length > 0 ? (
            <>Refreshed. {skipped.length} already running, so {skipped.length === 1 ? "it was" : "they were"} left alone.</>
          ) : (
            <>Refreshed all {jobs.length}.</>
          )
        ) : null}
      </span>

      <span className="inline-flex flex-col gap-1">
        <button
          type="button"
          onClick={refreshAll}
          disabled={busy}
          aria-busy={busy}
          className="rounded-md border border-brand text-brand px-3 py-2 text-sm hover:bg-brand-track disabled:opacity-50"
          title="Re-run every source query behind this page now"
        >
          {busy ? "Refreshing…" : "Refresh"}
        </button>
        {busy ? (
          <span
            className="jadi-progress text-brand"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={jobs.length}
            aria-valuenow={done}
            aria-label="Refresh progress"
          >
            <span style={{ width: `${pctDone}%` }} />
          </span>
        ) : null}
      </span>
    </span>
  );
}
