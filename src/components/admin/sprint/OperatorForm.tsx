"use client";

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

export interface ObservedCode {
  code: string;
  cleared: number;
  firstAt: string | null;
  lastAt: string | null;
}

export const EMPTY_OPERATOR: OperatorFormValues = {
  sourceCode: "",
  displayName: "",
  email: "",
  department: "",
  isActive: true,
  isSystem: false,
  effectiveFrom: "",
  effectiveTo: "",
};

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : null);

/**
 * Warn when the effective dates exclude clearance actions the code actually has.
 *
 * A narrow range is legitimate — that is the whole point of effective dates when a code changes
 * hands — so this is a caution, never a block. It exists because the opposite mistake is silent:
 * a profile whose range misses the actions renders as unmapped with no hint that it is even there
 * (J. Wilson, 2026-09-24).
 */
export function coverageWarning(v: Pick<OperatorFormValues, "sourceCode" | "effectiveFrom" | "effectiveTo">, codes: ObservedCode[]): string | null {
  const observed = codes.find((c) => c.code.trim().toLowerCase() === v.sourceCode.trim().toLowerCase());
  if (!observed || observed.cleared === 0) return null;
  const first = day(observed.firstAt);
  const last = day(observed.lastAt);
  if (!first || !last) return null;
  const from = v.effectiveFrom || null;
  const to = v.effectiveTo || null;
  if (!from && !to) return null;

  const span = first === last ? first : `${first} to ${last}`;
  const n = observed.cleared.toLocaleString();
  if ((from && from > last) || (to && to < first)) {
    return `These dates exclude all ${n} clearance actions recorded for ${observed.code} (${span}), so it will still show as unmapped.`;
  }
  if ((from && from > first) || (to && to < last)) {
    return `These dates cover only part of the ${n} clearance actions recorded for ${observed.code} (${span}). Actions outside the range need their own profile.`;
  }
  return null;
}

/**
 * Operator profile editor (Spec §7.2). A code with no profile is shown as "Unmapped" everywhere —
 * the application never guesses a person's name from a login code.
 */
export function OperatorForm({
  initial = EMPTY_OPERATOR,
  codes = [],
  onSaved,
  onCancel,
}: {
  initial?: OperatorFormValues;
  codes?: ObservedCode[];
  onSaved?: () => void;
  onCancel?: () => void;
}) {
  const [v, setV] = useState<OperatorFormValues>(initial);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const input = "w-full rounded-md border border-border bg-surface-1 px-3 py-2 text-sm";
  const set = (patch: Partial<OperatorFormValues>) => setV({ ...v, ...patch });
  const warning = coverageWarning(v, codes);

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
      if (!initial.id) setV(EMPTY_OPERATOR);
      onSaved?.();
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

      {warning ? (
        <p role="status" className="md:col-span-2 rounded-md border border-warning bg-surface-1 px-3 py-2 text-xs">
          <span aria-hidden>⚠</span> {warning} Clear both dates for an open-ended mapping.
        </p>
      ) : null}

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
        {onCancel ? (
          <button type="button" onClick={onCancel} className="rounded-md border border-border px-3 py-2 text-sm">
            Cancel
          </button>
        ) : null}
        <span role="status" className="text-xs">
          {error ? <span className="text-critical">{error}</span> : saved ? <span className="text-ink-2">Saved.</span> : null}
        </span>
      </div>
    </form>
  );
}
