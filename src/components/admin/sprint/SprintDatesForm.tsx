"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Sprint window editor (Spec §7, ASSUMPTIONS A-10). Both dates are required — the application
 * deliberately offers no computed default, so an unset window stays unset until someone decides it.
 * Saving invalidates the current sprint snapshot; the sprint page re-captures on its next load.
 */
export function SprintDatesForm({ termKey, termLabel, initial, hint }: { termKey: string; termLabel: string; initial: { start: string; end: string } | null; hint?: string }) {
  const router = useRouter();
  const [start, setStart] = useState(initial?.start ?? "");
  const [end, setEnd] = useState(initial?.end ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const input = "rounded-md border border-border bg-surface-1 px-3 py-2 text-sm";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/v1/admin/metadata/sprint", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ termKey, start, end }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) return setError(body?.error?.message ?? `Request failed (HTTP ${res.status})`);
      setSaved(true);
      router.refresh();
    } catch {
      setError("The request did not complete.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1">
        <label htmlFor="sprint-start" className="text-xs text-ink-2">
          Sprint start ({termKey})
        </label>
        <input id="sprint-start" type="date" required value={start} onChange={(e) => setStart(e.target.value)} className={input} />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="sprint-end" className="text-xs text-ink-2">
          Sprint end
        </label>
        <input id="sprint-end" type="date" required value={end} onChange={(e) => setEnd(e.target.value)} min={start || undefined} className={input} />
      </div>
      <button type="submit" disabled={busy || !start || !end} className="rounded-md bg-brand text-brand-ink px-3 py-2 text-sm disabled:opacity-60">
        {busy ? "Saving…" : initial ? "Update dates" : "Set dates"}
      </button>
      <p role="status" className="text-xs text-ink-2 basis-full">
        {error ? <span className="text-critical">{error}</span> : saved ? `Sprint window saved for ${termLabel}.` : hint}
      </p>
    </form>
  );
}
