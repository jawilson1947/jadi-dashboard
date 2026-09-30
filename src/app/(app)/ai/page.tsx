import Link from "next/link";
import { getPrincipal } from "@/server/auth/session";
import { requirePermission } from "@/server/authz/permissions";
import { PageHeader } from "@/components/layout/PageHeader";
import { ANALYSIS_MODULES } from "@/server/services/ai/analysis";
import { analysisUnavailableReason, ANALYSIS_DARK_MESSAGES } from "@/server/services/ai/model";

export const dynamic = "force-dynamic";
export const metadata = { title: "AI Analyses" };

/**
 * Phase 8a catalog (Spec §12, docs/AI-ANALYSIS-PLAN.md §4).
 *
 * The banner is at the top rather than on each card because the state is deployment-wide, and
 * because a reader should learn that the prose is off BEFORE opening a module, not after.
 */
export default async function Page() {
  requirePermission(await getPrincipal(), "ai.view");
  const reason = analysisUnavailableReason();

  return (
    <>
      <PageHeader
        title="AI Analyses"
        description="Computed figures with a written interpretation. Every number is calculated here; only the interpretation is generated."
      />

      {reason ? (
        <div role="status" className="rounded-md border border-border bg-surface-1 px-4 py-2 text-sm">
          <span aria-hidden>⚠</span> {ANALYSIS_DARK_MESSAGES[reason]}
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {ANALYSIS_MODULES.map((m) => (
          <Link key={m.key} href={`/ai/${m.key}`} className="card hover:bg-surface-2 block">
            <div className="text-xs text-ink-3">{m.ref}</div>
            <div className="font-medium">{m.title}</div>
            <p className="text-sm text-ink-2 mt-1">{m.blurb}</p>
          </Link>
        ))}
      </div>
    </>
  );
}
