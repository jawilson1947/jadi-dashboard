/**
 * A card that failed. Spec §17: never render a zero in place of a figure that could not be read —
 * say what is missing, and why, so the reader knows the difference between "no money owed" and
 * "we could not look".
 */
export function Unavailable({ title, detail, hint }: { title: string; detail: string; hint?: string }) {
  return (
    <section className="card space-y-1" aria-live="polite">
      <h2 className="text-sm font-medium text-ink-2">{title}</h2>
      <p className="text-sm">{detail}</p>
      {hint ? <p className="text-xs text-ink-3">{hint}</p> : null}
    </section>
  );
}
