"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { EMPTY_OPERATOR, OperatorForm, type ObservedCode, type OperatorFormValues } from "./OperatorForm";

export interface OperatorProfileView extends OperatorFormValues {
  id: string;
  updatedAtLabel: string;
}

/**
 * The editing half of Administration → Operators: the add/update form and the list of existing
 * profiles, together, because editing a row means loading it into the form.
 *
 * Before this existed the page could only ever ADD: the form always started empty, and a profile
 * saved with a wrong effective-from could not be corrected from the UI at all (J. Wilson,
 * 2026-09-24). Delete is a two-step inline confirm rather than a browser dialog.
 */
export function OperatorAdmin({ profiles, codes }: { profiles: OperatorProfileView[]; codes: ObservedCode[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<OperatorFormValues | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function remove(id: string) {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/v1/admin/operators/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        return setError(body?.error?.message ?? `Delete failed (HTTP ${res.status})`);
      }
      if (editing?.id === id) setEditing(null);
      setConfirming(null);
      router.refresh();
    } catch {
      setError("The request did not complete.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <section className="card space-y-3">
        <h2 className="text-sm font-medium text-ink-2">{editing ? `Editing ${editing.sourceCode}` : "Add or update a profile"}</h2>
        <p className="text-xs text-ink-3">
          Leave the effective dates empty for an open-ended mapping. Set them when a code changes hands, so last semester&apos;s clearance actions keep resolving to the person who made
          them — a range that does not cover a code&apos;s actions leaves it showing as unmapped.
        </p>
        <OperatorForm
          key={editing?.id ?? "new"}
          initial={editing ?? EMPTY_OPERATOR}
          codes={codes}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
          onCancel={editing ? () => setEditing(null) : undefined}
        />
      </section>

      <section className="card space-y-3">
        <h2 className="text-sm font-medium text-ink-2">Existing profiles</h2>
        {error ? (
          <p role="alert" className="text-sm text-critical">
            {error}
          </p>
        ) : null}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Operator profiles</caption>
            <thead className="bg-surface-2 text-left">
              <tr>
                {["Code", "Display name", "Email", "Department", "Effective from", "Effective to", "Status", "Updated", "Actions"].map((h) => (
                  <th key={h} scope="col" className="px-3 py-2 font-medium text-ink-2 whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {profiles.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-3 py-8 text-center text-ink-3">
                    No operator profiles yet.
                  </td>
                </tr>
              ) : (
                profiles.map((p) => (
                  <tr key={p.id} className="border-t border-border">
                    <td className="px-3 py-1.5 font-mono text-xs">{p.sourceCode}</td>
                    <td className="px-3 py-1.5">{p.displayName}</td>
                    <td className="px-3 py-1.5 text-ink-2">{p.email || "—"}</td>
                    <td className="px-3 py-1.5 text-ink-2">{p.department || "—"}</td>
                    <td className="px-3 py-1.5 whitespace-nowrap">{p.effectiveFrom || "—"}</td>
                    <td className="px-3 py-1.5 whitespace-nowrap">{p.effectiveTo || "—"}</td>
                    <td className="px-3 py-1.5 text-xs">
                      {p.isActive ? (
                        <span className="rounded-full border border-border px-2 py-0.5">active</span>
                      ) : (
                        <span className="rounded-full border border-border text-ink-3 px-2 py-0.5">inactive</span>
                      )}
                      {p.isSystem ? <span className="ml-1 rounded-full border border-border text-ink-2 px-2 py-0.5">automatic</span> : null}
                    </td>
                    <td className="px-3 py-1.5 whitespace-nowrap text-ink-2">{p.updatedAtLabel}</td>
                    <td className="px-3 py-1.5 whitespace-nowrap">
                      <span className="flex items-center gap-2 text-xs">
                        <button
                          type="button"
                          onClick={() => {
                            setConfirming(null);
                            setEditing(p);
                          }}
                          className="rounded-md border border-border px-2 py-1 hover:bg-surface-2"
                        >
                          Edit
                        </button>
                        {confirming === p.id ? (
                          <>
                            <button
                              type="button"
                              disabled={busyId === p.id}
                              onClick={() => void remove(p.id)}
                              className="rounded-md border border-critical text-critical px-2 py-1 disabled:opacity-60"
                            >
                              {busyId === p.id ? "Deleting…" : "Confirm delete"}
                            </button>
                            <button type="button" onClick={() => setConfirming(null)} className="text-ink-2 underline hover:no-underline">
                              Cancel
                            </button>
                          </>
                        ) : (
                          <button type="button" onClick={() => setConfirming(p.id)} className="rounded-md border border-border px-2 py-1 hover:bg-surface-2">
                            Delete
                          </button>
                        )}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-ink-3">
          Deleting is for a row entered in error. A mapping that simply ended should get an effective-to date instead, so past clearance actions keep resolving to whoever made them.
        </p>
      </section>
    </>
  );
}
