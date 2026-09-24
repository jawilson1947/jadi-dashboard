import type { StudentSearchState } from "@/server/repositories/types";

/**
 * Bio Spec 1.3 `icon`. Colour alone never carries the meaning: each state has its own glyph and an
 * accessible name, so the column is readable in monochrome and to a screen reader.
 *
 * `cleared-prior` exists because the clearance flag belongs to the LastCleared term, not to today's
 * (J. Wilson, 2026-09-24): a student cleared for a semester that has passed gets its own glyph
 * rather than borrowing the tick, which would claim something untrue about the current semester.
 */
const STATES: Record<StudentSearchState, { glyph: string; label: string; className: string }> = {
  cleared: { glyph: "✔", label: "Cleared for the current semester", className: "text-good" },
  "cleared-prior": { glyph: "◐", label: "Cleared for an earlier semester, not the current one", className: "text-serious" },
  "not-cleared": { glyph: "✖", label: "Enrolled, not cleared", className: "text-warning" },
  "not-enrolled": { glyph: "○", label: "Not currently enrolled", className: "text-ink-3" },
};

/** The same four meanings as prose, for the legend under a table of these icons. */
export const STATE_LEGEND = "✔ cleared for the current semester · ◐ cleared for an earlier semester · ✖ enrolled, not cleared · ○ not currently enrolled";

export function StateIcon({ state }: { state: StudentSearchState }) {
  const s = STATES[state];
  return (
    <span className={`inline-flex items-center gap-1 ${s.className}`}>
      <span aria-hidden>{s.glyph}</span>
      <span className="sr-only">{s.label}</span>
    </span>
  );
}
