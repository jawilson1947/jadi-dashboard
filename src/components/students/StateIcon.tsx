import type { StudentSearchState } from "@/server/repositories/types";

/**
 * Bio Spec 1.3 `icon`. Colour alone never carries the meaning: each state has its own glyph and an
 * accessible name, so the column is readable in monochrome and to a screen reader.
 */
const STATES: Record<StudentSearchState, { glyph: string; label: string; className: string }> = {
  cleared: { glyph: "✔", label: "Cleared this semester", className: "text-good" },
  "not-cleared": { glyph: "✖", label: "Enrolled, not cleared", className: "text-warning" },
  "not-enrolled": { glyph: "○", label: "Not currently enrolled", className: "text-ink-3" },
};

export function StateIcon({ state }: { state: StudentSearchState }) {
  const s = STATES[state];
  return (
    <span className={`inline-flex items-center gap-1 ${s.className}`}>
      <span aria-hidden>{s.glyph}</span>
      <span className="sr-only">{s.label}</span>
    </span>
  );
}
