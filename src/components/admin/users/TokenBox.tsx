"use client";

import { useState } from "react";

/** Shows a one-time credential token once, with the set-password link and a copy button. */
export function TokenBox({ token, username }: { token: string; username: string }) {
  const [copied, setCopied] = useState(false);
  const link = typeof window !== "undefined" ? `${window.location.origin}/set-password?token=${encodeURIComponent(token)}` : `/set-password?token=${encodeURIComponent(token)}`;
  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }
  return (
    <div role="status" className="rounded-md border border-warning bg-surface-1 p-4 space-y-2">
      <p className="text-sm font-medium">One-time link for {username} — this is shown once.</p>
      <p className="text-xs text-ink-2">Give it to the person directly. They will choose their own password; nobody, including administrators, ever sees it. The link expires after the configured token lifetime (72 hours by default) and works only once.</p>
      <div className="flex gap-2">
        <input readOnly value={link} onFocus={(e) => e.currentTarget.select()} className="flex-1 rounded-md border border-border bg-surface-2 px-3 py-2 font-mono text-xs" aria-label="One-time set-password link" />
        <button type="button" onClick={copy} className="rounded-md border border-brand text-brand px-3 py-2 text-sm hover:bg-brand-track">{copied ? "Copied" : "Copy"}</button>
      </div>
    </div>
  );
}
