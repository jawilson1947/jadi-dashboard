"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Re-capture a report population on demand. Routes through the same job pipeline as the scheduled
 * run, so locking, run history and the admin screen apply identically — a manual refresh is not a
 * second code path that can drift from the nightly one.
 */
export function RefreshReportButton({ reportKey }: { reportKey: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function refresh() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/v1/reports/${encodeURIComponent(reportKey)}/refresh`, { method: "POST" });
      const body = await res.json().catch(() => null);
      const status: string | undefined = body?.data?.status;
      if (status === "SUCCEEDED") setMsg("Refreshed");
      else if (status === "SKIPPED_OVERLAP") setMsg("Already running — showing the latest capture.");
      else setMsg(body?.data?.errorSummary ?? body?.error?.message ?? `Refresh failed (HTTP ${res.status})`);
      router.refresh();
    } catch {
      setMsg("Refresh failed — request did not complete.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-2 no-print">
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
        className="rounded-md border border-brand text-brand px-3 py-2 text-sm hover:bg-brand-track disabled:opacity-50"
        title="Re-run this report's source query now"
      >
        {busy ? "Refreshing…" : "Refresh"}
      </button>
    </span>
  );
}
