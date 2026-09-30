import { notFound } from "next/navigation";
import { getPrincipal } from "@/server/auth/session";
import { requirePermission } from "@/server/authz/permissions";
import { getConfig } from "@/server/db/config";
import { newCorrelationId } from "@/server/audit/audit";
import { AnalysisShell } from "@/components/ai/AnalysisShell";
import { auditAnalysisView, getAnalysisModule, getAnalysisView } from "@/server/services/ai/analysis";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  return { title: getAnalysisModule(key)?.title ?? "Analysis" };
}

/**
 * One route for every analysis module (docs/AI-ANALYSIS-PLAN.md §5.1).
 *
 * `ai.view` reads aggregate narratives — the same gate the catalog uses. These modules send no
 * identified data by construction (§6), so `ai.notice.create` and the identified-data switch are
 * deliberately not involved.
 */
export default async function Page({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const principal = requirePermission(await getPrincipal(), "ai.view");
  if (!getAnalysisModule(key)) notFound();

  const view = await getAnalysisView(key);
  if (!view) notFound();

  await auditAnalysisView(principal, view, newCorrelationId());
  return <AnalysisShell view={view} timeZone={getConfig().APP_TIMEZONE} />;
}
