import Link from "next/link";
import { formatDateTime } from "@/lib/format";
import { PageHeader } from "@/components/layout/PageHeader";
import { PrintButton } from "@/components/print/PrintButton";
import type { AnalysisView } from "@/server/services/ai/analysis";

/**
 * The Spec §12 output shape, rendered once for every module.
 *
 * Facts / Hypotheses / Questions, an AI-assisted badge and a citation footer — the spec had this
 * right before the plan existed. AI-D1 takes it literally: the Facts section is computed and is
 * always present; only the other two come from a model, and they are visibly absent when none is
 * wired rather than silently missing.
 *
 * The badge is on the GENERATED sections, not on the page. Badging the whole page would imply the
 * figures came from a model, which is the opposite of the guarantee.
 */
export function AnalysisShell({ view, timeZone }: { view: AnalysisView; timeZone: string }) {
  const p = view.presentation;
  return (
    <>
      <PageHeader
        title={view.title}
        description={view.blurb}
        actions={
          <span className="flex items-center gap-3">
            <PrintButton />
            <Link href="/ai" className="text-sm text-brand no-print">
              ← Back to analyses
            </Link>
          </span>
        }
      />

      <section className="card" aria-labelledby="facts">
        <h2 id="facts" className="text-sm font-medium text-ink-2">Facts</h2>
        <p className="text-sm mt-1 max-w-3xl">{p.headline}</p>

        <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-4 text-sm mt-4">
          {p.figures.map((f) => (
            <div key={f.label}>
              <dt className="text-ink-3 text-xs">{f.label}</dt>
              <dd className="tabular">{f.value}</dd>
              {f.hint ? <dd className="text-xs text-ink-3">{f.hint}</dd> : null}
            </div>
          ))}
        </dl>
      </section>

      {p.tables.map((t) => (
        <div key={t.caption} className="card p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="text-left text-sm font-medium text-ink-2 px-3 pt-3">{t.caption}</caption>
              <thead className="bg-surface-2 text-left">
                <tr>
                  {t.columns.map((c) => (
                    <th key={c} scope="col" className="px-3 py-2 font-medium text-ink-2 whitespace-nowrap">{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {t.rows.map((row, i) => (
                  <tr key={i} className="border-t border-border">
                    {row.map((cell, j) => (
                      <td key={j} className={`px-3 py-2 ${j === 0 ? "" : "tabular"}`}>{cell}</td>
                    ))}
                  </tr>
                ))}
                {t.rows.length === 0 ? (
                  <tr><td colSpan={t.columns.length} className="px-3 py-6 text-center text-ink-2">Nothing to show.</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
          {t.note ? <p className="text-xs text-ink-3 px-3 pb-3 pt-2 max-w-3xl">{t.note}</p> : null}
        </div>
      ))}

      {view.confidence.length > 0 ? (
        <section className="card" aria-labelledby="confidence">
          <h2 id="confidence" className="text-sm font-medium text-ink-2">
            <span aria-hidden>⚠</span> What this analysis cannot support
          </h2>
          <dl className="text-sm mt-2 space-y-2 max-w-3xl">
            {view.confidence.map((c) => (
              <div key={c.subject}>
                <dt className="text-ink-2">{c.subject}</dt>
                <dd className="text-ink-3">{c.effect}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}

      {view.dark ? (
        <section role="status" className="rounded-md border border-border bg-surface-1 px-4 py-3 text-sm">
          <p className="max-w-3xl">
            <strong>Hypotheses and Questions are not available.</strong> {view.dark.message}
          </p>
          <p className="text-xs text-ink-3 mt-2">
            Sign <strong>{view.dark.assumption}</strong> in <code>ASSUMPTIONS.md</code> and configure a model to enable them.
          </p>
        </section>
      ) : view.narrative ? (
        <>
          <section className="card" aria-labelledby="hypotheses">
            <h2 id="hypotheses" className="text-sm font-medium text-ink-2 flex items-center gap-2">
              Hypotheses
              <span className="rounded-full border border-border px-2 py-0.5 text-xs text-ink-3">AI-assisted</span>
            </h2>
            <div className="text-sm mt-2 space-y-2 max-w-3xl">
              {view.narrative.hypotheses.map((h, i) => <p key={i}>{h}</p>)}
            </div>
          </section>
          <section className="card" aria-labelledby="questions">
            <h2 id="questions" className="text-sm font-medium text-ink-2 flex items-center gap-2">
              Questions to ask
              <span className="rounded-full border border-border px-2 py-0.5 text-xs text-ink-3">AI-assisted</span>
            </h2>
            <ul className="text-sm mt-2 space-y-1 list-disc pl-5 max-w-3xl">
              {view.narrative.questions.map((q, i) => <li key={i}>{q}</li>)}
            </ul>
          </section>
        </>
      ) : null}

      <p className="text-xs text-ink-3 max-w-3xl">
        Computed from {view.citation.sources.join(", ")}
        {view.citation.capturedAt ? ` · population captured ${formatDateTime(view.citation.capturedAt.toISOString(), timeZone)}` : ""}
        {" · read "}
        {formatDateTime(view.citation.readAt.toISOString(), timeZone)}
        {view.narrative ? ` · interpretation by ${view.narrative.model}` : ""}
      </p>
    </>
  );
}
