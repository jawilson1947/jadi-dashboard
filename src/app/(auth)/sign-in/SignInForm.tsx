"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function SignInForm({ next }: { next?: string }) {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Reveal is off on every render: a password left visible on an unattended screen is the risk the
  // masking exists to prevent, so the choice is per sign-in and never remembered.
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/auth/sign-in", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password }) });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error?.message ?? "Sign-in failed.");
        return;
      }
      router.push(body?.data?.mustChangePassword ? "/change-password" : next && next.startsWith("/") ? next : "/dashboard");
      router.refresh();
    } catch {
      setError("Sign-in failed — the request did not complete.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3" aria-describedby={error ? "signin-error" : undefined}>
      <div>
        <label htmlFor="username" className="block text-sm font-medium mb-1">Username</label>
        <input id="username" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} required value={username} onChange={(e) => setUsername(e.target.value)} className="w-full rounded-md border border-border bg-surface-1 px-3 py-2" />
      </div>
      <div>
        <label htmlFor="password" className="block text-sm font-medium mb-1">Password</label>
        <div className="relative">
          <input
            id="password"
            name="password"
            type={reveal ? "text" : "password"}
            autoComplete="current-password"
            autoCapitalize="none"
            spellCheck={false}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-md border border-border bg-surface-1 px-3 py-2 pr-16"
          />
          <button
            type="button"
            onClick={() => setReveal((v) => !v)}
            aria-pressed={reveal}
            aria-controls="password"
            className="absolute inset-y-0 right-0 px-3 text-xs font-medium text-ink-2 hover:text-ink-1"
          >
            {reveal ? "Hide" : "Show"}
          </button>
        </div>
        <p aria-live="polite" className="sr-only">{reveal ? "Password is visible." : "Password is hidden."}</p>
      </div>
      {error ? (
        <p id="signin-error" role="alert" className="text-sm text-critical">{error}</p>
      ) : null}
      <button type="submit" disabled={busy} className="w-full rounded-md bg-brand text-brand-ink py-2.5 font-medium hover:opacity-90 disabled:opacity-60">
        {busy ? "Signing in…" : "Sign in"}
      </button>
      <p className="text-xs text-ink-3">Forgot your password? Ask a dashboard administrator to issue a reset link.</p>
    </form>
  );
}
