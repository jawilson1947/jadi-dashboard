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
        <label htmlFor="current-password" className="block text-sm font-medium mb-1">Current password</label>
        <input id="current-password" type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} className="w-full rounded-md border border-border bg-surface-1 px-3 py-2" />
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
