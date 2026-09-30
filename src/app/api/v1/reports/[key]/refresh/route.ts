import { getPrincipal } from "@/server/auth/session";
import { requirePermission } from "@/server/authz/permissions";
import { getReportDefinition } from "@/server/reports/definitions";
import { runJob } from "@/server/jobs/runner";
import { audit } from "@/server/audit/audit";
import { handle, ok, fail } from "@/server/api/respond";

/**
 * POST /api/v1/reports/{key}/refresh — re-capture one report's population.
 *
 * Requires dashboard.view rather than schedule.manage, matching the Clearance Breakdown card: the
 * people who read a report are the people who need it current. The run goes through runJob, so the
 * job lock, the minimum interval and the run history all apply exactly as they do to the nightly
 * schedule — a manual refresh is not a second path that can drift from the scheduled one.
 *
 * Unlike the breakdown card this does NOT pass ignoreMinInterval: these are the 40-120 s queries the
 * snapshot exists to avoid, so the job's own minimum interval is the rate limit, and a second click
 * returns SKIPPED_OVERLAP rather than starting another scan of the source views.
 */
export const POST = handle(async (req, { correlationId }) => {
  const principal = requirePermission(await getPrincipal(), "dashboard.view");
  const key = decodeURIComponent(new URL(req.url).pathname.split("/").at(-2) ?? "");
  const def = getReportDefinition(key);
  if (!def) return fail(404, "not_found", "Unknown report.", correlationId);
  if (!def.jobKey) return fail(409, "not_refreshable", "This report reads live data and has nothing to refresh.", correlationId);

  const run = await runJob(def.jobKey, { triggeredBy: `manual:${principal.userId}` });
  await audit(principal, "report.refresh", {
    correlationId,
    targetType: "report",
    targetId: def.key,
    metadata: { status: run.status, durationMs: run.durationMs, rows: run.rowsProcessed },
  });
  return ok(
    { status: run.status, finishedAt: run.finishedAt, rowsProcessed: run.rowsProcessed, errorSummary: run.errorSummary },
    { correlationId },
    { status: run.status === "FAILED" ? 502 : 200 },
  );
});
