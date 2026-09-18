"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface DevUserOption {
  username: string;
  displayName: string;
  roles: string[];
}

export function DevSignInForm({ users }: { users: DevUserOption[] }) {
  const router = useRouter();
  const [username, setUsername] = useState(users[0]?.username ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/v1/auth/dev-login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username }),
    });
    setBusy(false);
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error?.message ?? "Sign-in failed.");
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="mt-6 border-t border-border pt-5">
      <p className="text-xs uppercase tracking-wide text-ink-3 mb-2">Development sign-in (synthetic accounts)</p>
      <label htmlFor="dev-user" className="block text-sm font-medium mb-1">
        Sign in as
      </label>
      <select
        id="dev-user"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        className="w-full rounded-md border border-border bg-surface-1 px-3 py-2"
      >
        {users.map((u) => (
          <option key={u.username} value={u.username}>
            {u.displayName} — {u.roles.join(", ")}
          </option>
        ))}
      </select>
      {error ? (
        <p role="alert" className="text-sm text-critical mt-2">
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={busy}
        className="mt-3 w-full rounded-md border border-brand text-brand py-2 font-medium hover:bg-brand-track disabled:opacity-60"
      >
        {busy ? "Signing in…" : "Continue"}
      </button>
    </form>
  );
}
