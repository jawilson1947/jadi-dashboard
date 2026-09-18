"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { TokenBox } from "./TokenBox";

interface Props {
  user: { id: string; username: string; status: "ACTIVE" | "DISABLED" | "INVITED"; isLocked: boolean; hasPassword: boolean; isSelf: boolean };
}

/** Reset credentials, unlock, disable/enable, sign out everywhere (USER-MANAGEMENT-PLAN Sec.5). */
export function UserActions({ user }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [token, setToken] = useState<string | null>(null);

  async function call(name: string, path: string, method: string, body?: unknown) {
    setBusy(name);
    setMsg(null);
    try {
      const res = await fetch(`/api/v1/admin/users/${user.id}${path}`, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
      const json = await res.json().catch(() => null);
      if (!res.ok) return setMsg({ kind: "err", text: json?.error?.message ?? `Request failed (HTTP ${res.status})` });
      return json?.data;
    } catch {
      setMsg({ kind: "err", text: "The request did not complete." });
    } finally {
      setBusy(null);
    }
  }

  async function reset() {
    if (!confirm(`Issue a new one-time link for ${user.username}? Their current password stops working and all their sessions are signed out.`)) return;
    const data = await call("reset", "/reset", "POST");
    if (data?.token) setToken(data.token);
    router.refresh();
  }
  async function unlock() {
    const data = await call("unlock", "/unlock", "POST");
    if (data) setMsg({ kind: "ok", text: "Lockout cleared." });
    router.refresh();
  }
  async function setStatus(status: "ACTIVE" | "DISABLED") {
    if (status === "DISABLED" && !confirm(`Disable ${user.username}? They are signed out immediately and cannot sign in until re-enabled. Their audit history is kept.`)) return;
    const data = await call("status", "", "PATCH", { status });
    if (data) setMsg({ kind: "ok", text: status === "DISABLED" ? "Account disabled." : "Account enabled." });
    router.refresh();
  }
  async function signOutEverywhere() {
    const data = await call("sessions", "/sessions", "DELETE");
    if (data) setMsg({ kind: "ok", text: `${data.sessionsRevoked} session(s) revoked.` });
    router.refresh();
  }

  const btn = "w-full rounded-md border px-3 py-2 text-sm text-left disabled:opacity-50";
  return (
    <div className="space-y-2">
      {token ? <TokenBox token={token} username={user.username} /> : null}
      <button type="button" onClick={reset} disabled={busy !== null || user.status === "DISABLED"} className={`${btn} border-brand text-brand hover:bg-brand-track`}>
        {user.status === "INVITED" ? "Issue a new invite link" : "Reset credentials (one-time link)"}
      </button>
      {user.isLocked ? (
        <button type="button" onClick={unlock} disabled={busy !== null} className={`${btn} border-warning text-warning`}>Unlock account</button>
      ) : null}
      <button type="button" onClick={signOutEverywhere} disabled={busy !== null} className={`${btn} border-border hover:bg-surface-2`}>Sign out everywhere</button>
      {user.status === "DISABLED" ? (
        <button type="button" onClick={() => setStatus("ACTIVE")} disabled={busy !== null || !user.hasPassword} className={`${btn} border-good text-good`} title={!user.hasPassword ? "Issue a new link instead — this user has no password yet" : undefined}>Enable account</button>
      ) : (
        <button type="button" onClick={() => setStatus("DISABLED")} disabled={busy !== null || user.isSelf} className={`${btn} border-critical text-critical`} title={user.isSelf ? "You cannot disable your own account" : undefined}>Disable account</button>
      )}
      {msg ? <p role={msg.kind === "err" ? "alert" : "status"} className={`text-xs ${msg.kind === "err" ? "text-critical" : "text-good"}`}>{msg.text}</p> : null}
      <p className="text-xs text-ink-3 pt-1">There is no hard delete: disabled accounts keep their audit trail (Spec §18).</p>
    </div>
  );
}
