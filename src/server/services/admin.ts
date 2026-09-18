import { Cron } from "croner";
import { getConfig } from "../db/config";
import { getAppStore } from "../store";
import type { AppStore, JobDefinitionRecord, JobKey, JobRunRecord } from "../store/types";
import { ensureJobsSeeded, runJob } from "../jobs/runner";
import type { Principal } from "../authz/permissions";
import { audit } from "../audit/audit";

export interface JobStatusRow extends JobDefinitionRecord {
  lastRun: JobRunRecord | null;
  lastSuccess: JobRunRecord | null;
  nextRun: string | null;
  isRunning: boolean;
}

/** Job list with last/next run for Administration → Jobs (Spec §14.6). */
export async function getJobStatuses(store: AppStore = getAppStore()): Promise<JobStatusRow[]> {
  await ensureJobsSeeded(store);
  const tz = getConfig().APP_TIMEZONE;
  const jobs = await store.listJobs();
  return Promise.all(
    jobs.map(async (job) => {
      const runs = await store.listRuns(job.key, 20);
      const lastRun = runs[0] ?? null;
      const lastSuccess = runs.find((r) => r.status === "SUCCEEDED") ?? null;
      let nextRun: string | null = null;
      if (job.isEnabled) {
        try {
          nextRun = new Cron(job.cronExpression, { timezone: tz }).nextRun()?.toISOString() ?? null;
        } catch {
          nextRun = null;
        }
      }
      return { ...job, lastRun, lastSuccess, nextRun, isRunning: lastRun?.status === "RUNNING" || job.lockedAt !== null };
    }),
  );
}

/** Manual refresh through the same audited pipeline (Spec §14.6 "manual refresh must use the same audited job pipeline"). */
export async function manualRun(key: JobKey, actor: Principal, correlationId?: string): Promise<JobRunRecord> {
  const run = await runJob(key, { triggeredBy: `manual:${actor.userId}`, ignoreMinInterval: true });
  await audit(actor, "job.manual_run", { correlationId, targetType: "job", targetId: key, metadata: { status: run.status, durationMs: run.durationMs, rows: run.rowsProcessed } });
  return run;
}
