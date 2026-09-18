"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Refresh button for the Clearance Breakdown card: runs the audited job, then re-renders the page from the new snapshot. */
export function RefreshBreakdownButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function refresh() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/v1/dashboard/clearance-breakdown/refresh", { method: "POST" });
      const body = await res.json().catch(() => null);
      const status: string | undefined = body?.data?.status;
      if (status === "SUCCEEDED") setMsg("Refreshed");
      else if (status === "SKIPPED_OVERLAP") setMsg("A refresh is already running — showing the latest snapshot.");
      else setMsg(body?.data?.errorSummary ?? body?.error?.message ?? `Refresh failed (HTTP ${res.status})`);
      router.refresh();
    } catch {
      setMsg("Refresh failed — request did not complete.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ml-auto flex items-center gap-2">
      {msg ? (
        <span role="status" className="text-xs text-ink-3">
          {msg}
        </span>
      ) : null}
      <button
        type="button"
        onClick={refresh}
        disabled={busy}
        aria-busy={busy}
        className="rounded-md border border-brand text-brand px-3 py-1 text-xs hover:bg-brand-track disabled:opacity-50"
      >
        {busy ? "Refreshing…" : "Refresh"}
      </button>
    </div>
  );
}
