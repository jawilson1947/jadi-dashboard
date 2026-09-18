import { getPrincipal } from "@/server/auth/session";
import { requirePermission } from "@/server/authz/permissions";
import { getJobStatuses } from "@/server/services/admin";
import { getAppStore } from "@/server/store";
import { getConfig } from "@/server/db/config";
import { formatCount, formatDateTime } from "@/lib/format";
import { PageHeader } from "@/components/layout/PageHeader";
import { RunNowButton } from "./RunNowButton";
import { PrintButton } from "@/components/print/PrintButton";
import { PrintHeader } from "@/components/print/PrintHeader";
import { getCurrentTerms } from "@/server/metadata/terms";

export const metadata = { title: "Refresh jobs" };
export const dynamic = "force-dynamic";

const STATUS_STYLE: Record<string, string> = {
  SUCCEEDED: "border-good text-good",
  FAILED: "border-critical text-critical",
  RUNNING: "border-brand text-brand",
  SKIPPED_OVERLAP: "border-border text-ink-2",
};

/** Administration → Refresh schedules and job status (Spec §14.6). */
export default async function JobsPage() {
  const principal = requirePermission(await getPrincipal(), "schedule.manage");
  const tz = getConfig().APP_TIMEZONE;
  const terms = await getCurrentTerms().catch(() => null);
  const jobs = await getJobStatuses();
  const runs = await getAppStore().listRuns(undefined, 40);

  return (
    <>
      <PageHeader
        title="Refresh schedules & job status"
        description={`Snapshot jobs run in the worker process (npm run worker) on the schedules below (${tz}). Manual runs use the same audited pipeline. Schedule editing arrives with the settings UI in Phase 3.`}
        actions={<PrintButton />}
      />
      <PrintHeader title="Refresh schedules & job status" semester={terms?.label ?? "—"} printedBy={principal.displayName} timeZone={tz} />

      <div className="card p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">Refresh jobs</caption>
          <thead className="bg-surface-2 text-left">
            <tr>
              {["Job", "Schedule", "Enabled", "Last run", "Last success", "Duration", "Rows", "Next run", ""].map((h) => (
                <th key={h} scope="col" className="px-3 py-2 font-medium text-ink-2 whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {jobs.map((j) => (
              <tr key={j.key} className="border-t border-border">
                <td className="px-3 py-2 min-w-56">
                  <div className="font-medium whitespace-nowrap">{j.name}</div>
                  <div className="text-xs text-ink-3 font-mono">{j.key}</div>
                </td>
                <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{j.cronExpression}<div className="text-ink-3">min {j.minIntervalMinutes} min</div></td>
                <td className="px-3 py-2">{j.isEnabled ? "Yes" : "No"}</td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {j.lastRun ? (
                    <>
                      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${STATUS_STYLE[j.lastRun.status]}`}>{j.lastRun.status}</span>
                      <div className="text-xs text-ink-3">{formatDateTime(j.lastRun.startedAt, tz)} · {j.lastRun.triggeredBy}</div>
                      {j.lastRun.errorSummary ? <div className="text-xs text-critical max-w-xs truncate" title={j.lastRun.errorSummary}>{j.lastRun.errorSummary}</div> : null}
                    </>
                  ) : (
                    <span className="text-ink-3">never</span>
                  )}
                </td>
                <td className="px-3 py-2 whitespace-nowrap text-xs">{j.lastSuccess ? formatDateTime(j.lastSuccess.finishedAt, tz) : "—"}</td>
                <td className="px-3 py-2 tabular text-right">{j.lastRun?.durationMs != null ? `${(j.lastRun.durationMs / 1000).toFixed(1)} s` : "—"}</td>
                <td className="px-3 py-2 tabular text-right">{formatCount(j.lastRun?.rowsProcessed)}</td>
                <td className="px-3 py-2 whitespace-nowrap text-xs">{j.nextRun ? formatDateTime(j.nextRun, tz) : "—"}</td>
                <td className="px-3 py-2"><RunNowButton jobKey={j.key} disabled={j.isRunning} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="card p-0 overflow-x-auto">
        <h2 className="px-3 py-2 text-sm font-medium text-ink-2 border-b border-border">Recent runs</h2>
        <table className="w-full text-sm">
          <caption className="sr-only">Recent job runs</caption>
          <thead className="bg-surface-2 text-left">
            <tr>{["Started", "Job", "Status", "Trigger", "Duration", "Rows", "Detail"].map((h) => <th key={h} scope="col" className="px-3 py-2 font-medium text-ink-2">{h}</th>)}</tr>
          </thead>
          <tbody>
            {runs.length === 0 ? (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-ink-3">No runs yet. Start the worker or use “Run now”.</td></tr>
            ) : runs.map((r) => (
              <tr key={r.id} className="border-t border-border">
                <td className="px-3 py-1.5 whitespace-nowrap text-xs">{formatDateTime(r.startedAt, tz)}</td>
                <td className="px-3 py-1.5 font-mono text-xs">{r.jobKey}</td>
                <td className="px-3 py-1.5"><span className={`inline-flex rounded-full border px-2 py-0.5 text-xs ${STATUS_STYLE[r.status]}`}>{r.status}</span></td>
                <td className="px-3 py-1.5 text-xs">{r.triggeredBy}</td>
                <td className="px-3 py-1.5 tabular text-right text-xs">{r.durationMs != null ? `${(r.durationMs / 1000).toFixed(1)} s` : "—"}</td>
                <td className="px-3 py-1.5 tabular text-right text-xs">{formatCount(r.rowsProcessed)}</td>
                <td className="px-3 py-1.5 text-xs text-ink-2 max-w-md truncate" title={r.errorSummary ?? ""}>{r.errorSummary ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
