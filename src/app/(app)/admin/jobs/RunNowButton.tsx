"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function RunNowButton({ jobKey, disabled }: { jobKey: string; disabled?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/v1/admin/jobs/${encodeURIComponent(jobKey)}/run`, { method: "POST" });
      const body = await res.json().catch(() => null);
      setMsg(body?.data?.status ?? body?.error?.message ?? `HTTP ${res.status}`);
      router.refresh();
    } catch {
      setMsg("Request failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <button type="button" onClick={run} disabled={busy || disabled} className="rounded-md border border-brand text-brand px-3 py-1 text-xs hover:bg-brand-track disabled:opacity-50">
        {busy ? "Running…" : "Run now"}
      </button>
      {msg ? <span role="status" className="text-xs text-ink-3">{msg}</span> : null}
    </div>
  );
}
