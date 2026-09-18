"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function UserFilters({ q, status, role }: { q: string; status: string; role: string }) {
  const router = useRouter();
  const [values, setValues] = useState({ q, status, role });
  function apply(e: React.FormEvent) {
    e.preventDefault();
    const p = new URLSearchParams();
    if (values.q) p.set("q", values.q);
    if (values.status) p.set("status", values.status);
    if (values.role) p.set("role", values.role);
    router.push(`/admin/users?${p}`);
  }
  const input = "rounded-md border border-border bg-surface-1 px-3 py-1.5 text-sm";
  return (
    <form onSubmit={apply} className="flex flex-wrap items-end gap-3" role="search">
      <label className="text-sm">
        <span className="block text-xs text-ink-3 mb-1">Search</span>
        <input value={values.q} onChange={(e) => setValues({ ...values, q: e.target.value })} placeholder="username, name or email" className={`${input} w-64`} />
      </label>
      <label className="text-sm">
        <span className="block text-xs text-ink-3 mb-1">Status</span>
        <select value={values.status} onChange={(e) => setValues({ ...values, status: e.target.value })} className={input}>
          <option value="">Any</option>
          <option value="ACTIVE">Active</option>
          <option value="INVITED">Invited</option>
          <option value="DISABLED">Disabled</option>
        </select>
      </label>
      <label className="text-sm">
        <span className="block text-xs text-ink-3 mb-1">Role</span>
        <select value={values.role} onChange={(e) => setValues({ ...values, role: e.target.value })} className={input}>
          <option value="">Any</option>
          <option value="ADMINISTRATOR">Administrator</option>
          <option value="OPERATOR">Operator</option>
          <option value="VIEWER">Viewer</option>
        </select>
      </label>
      <button type="submit" className="rounded-md border border-brand text-brand px-3 py-1.5 text-sm hover:bg-brand-track">Apply</button>
      {q || status || role ? (
        <button type="button" onClick={() => router.push("/admin/users")} className="text-sm text-ink-2 hover:underline">Clear</button>
      ) : null}
    </form>
  );
}
