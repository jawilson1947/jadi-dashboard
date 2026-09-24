"use client";

import { useState } from "react";

/**
 * Bio Spec 3.5 — ask for an AI-drafted collection notice (sub-phase 5f).
 *
 * The button always renders for a user who can see the cue; whether drafting is *allowed* is decided
 * by the server (A-26 — two switches and a permission). When it refuses, the reason is shown as
 * written rather than reduced to "something went wrong", because "not approved yet" and "the model is
 * down" call for different actions.
 *
 * Nothing here sends anything to a student: it produces text for a person to review.
 */
export function CollectionNoticeButton({ studentId }: { studentId: string }) {
  const [state, setState] = useState<{ status: "idle" | "loading" | "done" | "error"; text?: string; message?: string }>({ status: "idle" });

  async function draft() {
    setState({ status: "loading" });
    try {
      const res = await fetch(`/api/v1/students/${encodeURIComponent(studentId)}/collection-notice`, { method: "POST", headers: { "content-type": "application/json" } });
      const body = await res.json();
      if (!res.ok) {
        setState({ status: "error", message: body?.error?.message ?? "The draft could not be produced." });
        return;
      }
      setState({ status: "done", text: body?.data?.text ?? "" });
    } catch {
      setState({ status: "error", message: "The draft could not be produced." });
    }
  }

  return (
    <div className="space-y-2">
      <button type="button" onClick={draft} disabled={state.status === "loading"} className="rounded-md border border-border px-3 py-1 text-sm hover:bg-surface-2">
        {state.status === "loading" ? "Drafting…" : "Draft a collection notice"}
      </button>
      {state.status === "error" ? (
        <p role="alert" className="text-sm text-ink-2">{state.message}</p>
      ) : null}
      {state.status === "done" ? (
        <div className="space-y-1">
          <p className="text-xs text-ink-3">
            <span className="rounded-full border border-border px-2 py-0.5">AI-assisted</span> Draft only — review every figure before sending.
          </p>
          <textarea readOnly value={state.text} rows={10} className="w-full rounded-md border border-border bg-surface-1 p-3 text-sm" aria-label="Drafted collection notice" />
        </div>
      ) : null}
    </div>
  );
}
