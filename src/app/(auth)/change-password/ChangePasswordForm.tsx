"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PasswordFields } from "@/components/auth/PasswordFields";

export function ChangePasswordForm({ forced }: { forced: boolean }) {
  const router = useRouter();
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Its own toggle: the current password is a different secret from the new one. Off by default. */
  const [revealCurrent, setRevealCurrent] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) return setError("The two passwords do not match.");
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/auth/change-password", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ currentPassword: current, newPassword: password }) });
      const body = await res.json().catch(() => null);
      if (!res.ok) return setError(body?.error?.message ?? "Could not change the password.");
      router.push("/dashboard");
      router.refresh();
    } catch {
      setError("The request did not complete.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div>
        <div className="flex items-baseline justify-between mb-1">
          <label htmlFor="current-password" className="block text-sm font-medium">Current password</label>
          <button
            type="button"
            onClick={() => setRevealCurrent((v) => !v)}
            aria-pressed={revealCurrent}
            aria-controls="current-password"
            className="text-xs font-medium text-ink-2 hover:text-ink-1"
          >
            {revealCurrent ? "Hide" : "Show"}
          </button>
        </div>
        <input
          id="current-password"
          type={revealCurrent ? "text" : "password"}
          autoComplete="current-password"
          autoCapitalize="none"
          spellCheck={false}
          required
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          className="w-full rounded-md border border-border bg-surface-1 px-3 py-2"
        />
      </div>
      <PasswordFields password={password} confirm={confirm} onPassword={setPassword} onConfirm={setConfirm} label="New password" autoComplete="new-password" />
      {error ? <p role="alert" className="text-sm text-critical">{error}</p> : null}
      <button type="submit" disabled={busy} className="w-full rounded-md bg-brand text-brand-ink py-2.5 font-medium hover:opacity-90 disabled:opacity-60">
        {busy ? "Saving…" : "Change password"}
      </button>
      {!forced ? <p className="text-center text-sm"><Link href="/dashboard" className="text-brand">Back to the dashboard</Link></p> : null}
    </form>
  );
}
