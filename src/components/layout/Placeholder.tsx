import { PageHeader } from "./PageHeader";

/** Planned-module page so navigation is complete while later phases are built. */
export function Placeholder({ title, phase, spec }: { title: string; phase: number; spec: string }) {
  return (
    <>
      <PageHeader title={title} />
      <div className="card">
        <p className="text-ink-2">
          This module is scheduled for <strong>Phase {phase}</strong> (Spec {spec}). See <code>PLAN.md</code>.
        </p>
      </div>
    </>
  );
}
