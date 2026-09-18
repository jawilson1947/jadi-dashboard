"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { TokenBox } from "./TokenBox";

const ROLE_OPTIONS = [
  { key: "ADMINISTRATOR", label: "Administrator", hint: "Everything, including users, metadata, schedules and the audit log" },
  { key: "OPERATOR", label: "Operator", hint: "Dashboards, student-level data, worksheets, exports, mail merge" },
  { key: "VIEWER", label: "Viewer", hint: "Aggregate dashboards only" },
] as const;

export interface UserFormValues {
  username: string;
  email: string;
  displayName: string;
  roles: string[];
  permissions: { key: string; expiresAt: string | null }[];
}

export function UserForm({ mode, userId, initial, allPermissions }: { mode: "create" | "edit"; userId?: string; initial: UserFormValues; allPermissions: readonly string[] }) {
  const router = useRouter();
  const [v, setV] = useState<UserFormValues>(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const input = "w-full rounded-md border border-border bg-surface-1 px-3 py-2";

  function toggleRole(key: string) {
    setV({ ...v, roles: v.roles.includes(key) ? v.roles.filter((r) => r !== key) : [...v.roles, key] });
  }
  function togglePerm(key: string) {
    setV({ ...v, permissions: v.permissions.some((p) => p.key === key) ? v.permissions.filter((p) => p.key !== key) : [...v.permissions, { key, expiresAt: null }] });
  }
  function setExpiry(key: string, date: string) {
    setV({ ...v, permissions: v.permissions.map((p) => (p.key === key ? { ...p, expiresAt: date ? new Date(`${date}T23:59:59`).toISOString() : null } : p)) });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const payload = mode === "create" ? v : { email: v.email, displayName: v.displayName, roles: v.roles, permissions: v.permissions };
      const res = await fetch(mode === "create" ? "/api/v1/admin/users" : `/api/v1/admin/users/${userId}`, {
        method: mode === "create" ? "POST" : "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) return setError(body?.error?.message ?? `Request failed (HTTP ${res.status})`);
      if (mode === "create") {
        setToken(body.data.token);
      } else {
        setSaved(true);
        router.refresh();
      }
    } catch {
      setError("The request did not complete.");
    } finally {
      setBusy(false);
    }
  }

  if (token) {
    return (
      <div className="space-y-4">
        <TokenBox token={token} username={v.username} />
        <div className="flex gap-3">
          <button type="button" onClick={() => router.push("/admin/users")} className="rounded-md bg-brand text-brand-ink px-3 py-2 text-sm">Back to users</button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-5 max-w-2xl">
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label htmlFor="username" className="block text-sm font-medium mb-1">Username</label>
          <input id="username" required disabled={mode === "edit"} value={v.username} onChange={(e) => setV({ ...v, username: e.target.value })} className={`${input} font-mono disabled:opacity-60`} autoCapitalize="none" spellCheck={false} pattern="[A-Za-z0-9][A-Za-z0-9._-]{1,63}" />
          <p className="text-xs text-ink-3 mt-1">{mode === "edit" ? "Usernames cannot be changed." : "Letters, digits, dot, underscore or hyphen. Match the campus username to ease the later SSO transition."}</p>
        </div>
        <div>
          <label htmlFor="displayName" className="block text-sm font-medium mb-1">Display name</label>
          <input id="displayName" required value={v.displayName} onChange={(e) => setV({ ...v, displayName: e.target.value })} className={input} />
        </div>
        <div className="md:col-span-2">
          <label htmlFor="email" className="block text-sm font-medium mb-1">Email</label>
          <input id="email" type="email" required value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} className={input} />
        </div>
      </div>

      <fieldset>
        <legend className="text-sm font-medium mb-2">Roles</legend>
        <div className="grid gap-2 md:grid-cols-3">
          {ROLE_OPTIONS.map((r) => (
            <label key={r.key} className={`rounded-md border p-3 cursor-pointer ${v.roles.includes(r.key) ? "border-brand bg-brand-track" : "border-border"}`}>
              <span className="flex items-center gap-2 font-medium text-sm">
                <input type="checkbox" checked={v.roles.includes(r.key)} onChange={() => toggleRole(r.key)} /> {r.label}
              </span>
              <span className="block text-xs text-ink-2 mt-1">{r.hint}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="text-sm font-medium mb-1">Extra permissions</legend>
        <p className="text-xs text-ink-3 mb-2">Granted in addition to the roles above — for example student.view for a Viewer who may see student-level data (Spec §3.3). An optional expiry date removes the grant automatically.</p>
        <div className="grid gap-1 md:grid-cols-2">
          {allPermissions.map((key) => {
            const g = v.permissions.find((p) => p.key === key);
            return (
              <div key={key} className="flex items-center gap-2 text-sm">
                <label className="flex items-center gap-2 flex-1">
                  <input type="checkbox" checked={Boolean(g)} onChange={() => togglePerm(key)} /> <span className="font-mono text-xs">{key}</span>
                </label>
                {g ? <input type="date" aria-label={`${key} expires`} value={g.expiresAt ? g.expiresAt.slice(0, 10) : ""} onChange={(e) => setExpiry(key, e.target.value)} className="rounded-md border border-border bg-surface-1 px-2 py-1 text-xs" /> : null}
              </div>
            );
          })}
        </div>
      </fieldset>

      {error ? <p role="alert" className="text-sm text-critical">{error}</p> : null}
      {saved ? <p role="status" className="text-sm text-good">Saved.</p> : null}
      <div className="flex items-center gap-3">
        <button type="submit" disabled={busy || v.roles.length === 0} className="rounded-md bg-brand text-brand-ink px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-60">
          {busy ? "Saving…" : mode === "create" ? "Create user and get one-time link" : "Save changes"}
        </button>
        <button type="button" onClick={() => router.push("/admin/users")} className="text-sm text-ink-2 hover:underline">Cancel</button>
      </div>
    </form>
  );
}
