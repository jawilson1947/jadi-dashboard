"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export interface OperatorFormValues {
  id?: string;
  sourceCode: string;
  displayName: string;
  email: string;
  department: string;
  isActive: boolean;
  isSystem: boolean;
  effectiveFrom: string;
  effectiveTo: string;
}

const EMPTY: OperatorFormValues = { sourceCode: "", displayName: "", email: "", department: "", isActive: true, isSystem: false, effectiveFrom: "", effectiveTo: "" };

/**
 * Operator profile editor (Spec §7.2). A code with no profile is shown as "Unmapped" everywhere —
 * the application never guesses a person's name from a login code.
 */
export function OperatorForm({ initial = EMPTY, codes = [] }: { initial?: OperatorFormValues; codes?: Array<{ code: string; cleared: number; firstAt: string | null; lastAt: string | null }> }) {
  const router = useRouter();
  const [v, setV] = useState<OperatorFormValues>(initial);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const input = "w-full rounded-md border border-border bg-surface-1 px-3 py-2 text-sm";
  const set = (patch: Partial<OperatorFormValues>) => setV({ ...v, ...patch });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/v1/admin/operators", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: v.id,
          sourceCode: v.sourceCode,
          displayName: v.displayName,
          email: v.email || null,
          department: v.department || null,
          isActive: v.isActive,
          isSystem: v.isSystem,
          effectiveFrom: v.effectiveFrom || null,
          effectiveTo: v.effectiveTo || null,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) return setError(body?.error?.message ?? `Request failed (HTTP ${res.status})`);
      setSaved(true);
      setV(initial.id ? v : EMPTY);
      router.refresh();
    } catch {
      setError("The request did not complete.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-3 md:grid-cols-2 max-w-3xl">
      <div>
        <label htmlFor="op-code" className="text-xs text-ink-2">
          Source code (ClearedBy)
        </label>
        <input id="op-code" required list="op-codes" value={v.sourceCode} onChange={(e) => set({ sourceCode: e.target.value })} className={input} placeholder="e.g. HSMITH" />
        <datalist id="op-codes">
          {codes.map((c) => (
            <option key={c.code} value={c.code}>
              {c.cleared} clearance actions
            </option>
          ))}
        </datalist>
      </div>
      <div>
        <label htmlFor="op-name" className="text-xs text-ink-2">
          Display name
        </label>
        <input id="op-name" required value={v.displayName} onChange={(e) => set({ displayName: e.target.value })} className={input} />
      </div>
      <div>
        <label htmlFor="op-email" className="text-xs text-ink-2">
          Email (optional)
        </label>
        <input id="op-email" type="email" value={v.email} onChange={(e) => set({ email: e.target.value })} className={input} />
      </div>
      <div>
        <label htmlFor="op-dept" className="text-xs text-ink-2">
          Department (optional)
        </label>
        <input id="op-dept" value={v.department} onChange={(e) => set({ department: e.target.value })} className={input} />
      </div>
      <div>
        <label htmlFor="op-from" className="text-xs text-ink-2">
          Effective from (optional)
        </label>
        <input id="op-from" type="date" value={v.effectiveFrom} onChange={(e) => set({ effectiveFrom: e.target.value })} className={input} />
      </div>
      <div>
        <label htmlFor="op-to" className="text-xs text-ink-2">
          Effective to (optional)
        </label>
        <input id="op-to" type="date" value={v.effectiveTo} onChange={(e) => set({ effectiveTo: e.target.value })} min={v.effectiveFrom || undefined} className={input} />
      </div>
      <div className="flex items-center gap-4 text-sm md:col-span-2">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={v.isActive} onChange={(e) => set({ isActive: e.target.checked })} /> Active
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={v.isSystem} onChange={(e) => set({ isSystem: e.target.checked })} /> Automatic clearance account (not a person)
        </label>
      </div>
      <div className="md:col-span-2 flex items-center gap-3">
        <button type="submit" disabled={busy} className="rounded-md bg-brand text-brand-ink px-3 py-2 text-sm disabled:opacity-60">
          {busy ? "Saving…" : initial.id ? "Save profile" : "Add profile"}
        </button>
        <span role="status" className="text-xs">
          {error ? <span className="text-critical">{error}</span> : saved ? <span className="text-ink-2">Saved.</span> : null}
        </span>
      </div>
    </form>
  );
}
