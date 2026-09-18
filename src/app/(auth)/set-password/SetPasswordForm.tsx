"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PasswordFields } from "@/components/auth/PasswordFields";

export function SetPasswordForm({ token: initialToken }: { token: string }) {
  const router = useRouter();
  const [token, setToken] = useState(initialToken);
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
      const res = await fetch("/api/v1/auth/set-password", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, password }) });
      const body = await res.json().catch(() => null);
      if (!res.ok) return setError(body?.error?.message ?? "Could not set the password.");
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
      {!initialToken ? (
        <div>
          <label htmlFor="token" className="block text-sm font-medium mb-1">One-time token</label>
          <input id="token" required value={token} onChange={(e) => setToken(e.target.value)} className="w-full rounded-md border border-border bg-surface-1 px-3 py-2 font-mono text-sm" />
        </div>
      ) : null}
      <PasswordFields password={password} confirm={confirm} onPassword={setPassword} onConfirm={setConfirm} label="New password" autoComplete="new-password" />
      {error ? <p role="alert" className="text-sm text-critical">{error}</p> : null}
      <button type="submit" disabled={busy || !token} className="w-full rounded-md bg-brand text-brand-ink py-2.5 font-medium hover:opacity-90 disabled:opacity-60">
        {busy ? "Saving…" : "Set password and sign in"}
      </button>
    </form>
  );
}
