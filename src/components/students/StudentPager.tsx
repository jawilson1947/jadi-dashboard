import Link from "next/link";
import type { StudentNeighbors, StudentStep } from "@/server/services/student-neighbors";

/**
 * Step through a Student Lookup result set without going back to the list (Bio Spec 1.1).
 *
 * The position counter is the point as much as the arrows are: it says how far down the list this
 * record is and how much is left, which a pair of bare arrows cannot. Ends of the list render as
 * disabled text rather than disappearing, so the control does not change shape as you move.
 */
export function StudentPager({ neighbors }: { neighbors: StudentNeighbors }) {
  return (
    <nav aria-label="Search results" className="flex items-center gap-2 text-sm no-print">
      <Step step={neighbors.prev} label="Previous" arrow="‹" />
      <span className="text-ink-2 whitespace-nowrap tabular">
        {neighbors.position} of {neighbors.total}
      </span>
      <Step step={neighbors.next} label="Next" arrow="›" />
    </nav>
  );
}

function Step({ step, label, arrow }: { step: StudentStep | null; label: string; arrow: string }) {
  const shape = "rounded-md border border-border px-2 py-1 whitespace-nowrap";
  if (!step) {
    return (
      <span aria-disabled="true" className={`${shape} text-ink-3`}>
        <span aria-hidden>{arrow}</span> {label}
      </span>
    );
  }
  return (
    <Link href={step.href} title={`${label}: ${step.name} (${step.idnumber})`} className={`${shape} hover:bg-surface-2`}>
      <span aria-hidden>{arrow}</span> {label}
    </Link>
  );
}
