/**
 * Scheduled refresh worker (Spec §14.6, PLAN Phase 2).
 *
 *   npm run worker
 *
 * - Seeds job definitions, then schedules each enabled job by its cron expression (read from the
 *   store every minute so admin edits take effect without a restart).
 * - Every run goes through runJob(): DB-backed lock, RUNNING → SUCCEEDED/FAILED, snapshot saved.
 * - On startup it runs any job that has no successful run yet, so a fresh install shows data quickly.
 * - Never writes to ousadb; never writes tblOUSA (the nightly 9 pm SQL Agent job owns that).
 */
import { Cron } from "croner";
import { getConfig } from "./server/db/config";
import { getDataProvider } from "./server/repositories";
import { getAppStore } from "./server/store";
import type { JobKey } from "./server/store/types";
import { ensureJobsSeeded, runJob, workerId } from "./server/jobs/runner";
import { connectionHost } from "./server/db/target";

const log = (msg: string, extra: Record<string, unknown> = {}) => console.log(JSON.stringify({ level: "info", ts: new Date().toISOString(), worker: workerId(), msg, ...extra }));

async function main() {
  const cfg = getConfig();
  const store = getAppStore();
  const provider = getDataProvider();
  await ensureJobsSeeded(store);
  log("worker started", {
    provider: provider.name,
    store: cfg.APP_STORE,
    timezone: cfg.APP_TIMEZONE,
    // Which database this worker writes snapshots from and to. Hosts only — never the
    // connection strings (docs/TARGET-SWITCHING-PLAN.md).
    target: cfg.DB_TARGET,
    ousaHost: connectionHost(cfg.OUSADB_CONNECTION_STRING),
    dashHost: connectionHost(cfg.DASH_CONNECTION_STRING),
  });

  // Startup catch-up: populate any family that has never succeeded.
  for (const job of await store.listJobs()) {
    const [last] = await store.listRuns(job.key, 1);
    if (job.isEnabled && (!last || last.status !== "SUCCEEDED")) {
      const r = await runJob(job.key, { triggeredBy: "startup", ignoreMinInterval: true });
      log("startup run", { job: job.key, status: r.status, ms: r.durationMs, rows: r.rowsProcessed });
    }
  }

  const scheduled = new Map<JobKey, { cron: string; handle: Cron }>();
  const reconcile = async () => {
    const jobs = await store.listJobs();
    for (const job of jobs) {
      const current = scheduled.get(job.key);
      if (!job.isEnabled) {
        if (current) {
          current.handle.stop();
          scheduled.delete(job.key);
          log("unscheduled", { job: job.key });
        }
        continue;
      }
      if (current && current.cron === job.cronExpression) continue;
      current?.handle.stop();
      const handle = new Cron(job.cronExpression, { timezone: cfg.APP_TIMEZONE, protect: true }, async () => {
        const r = await runJob(job.key, { triggeredBy: "schedule" });
        log("scheduled run", { job: job.key, status: r.status, ms: r.durationMs, rows: r.rowsProcessed, error: r.errorSummary ?? undefined });
      });
      scheduled.set(job.key, { cron: job.cronExpression, handle });
      log("scheduled", { job: job.key, cron: job.cronExpression, next: handle.nextRun()?.toISOString() });
    }
  };

  await reconcile();
  setInterval(() => void reconcile().catch((e) => console.error(e)), 60_000);

  const shutdown = () => {
    log("worker stopping");
    for (const { handle } of scheduled.values()) handle.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error(JSON.stringify({ level: "error", msg: err instanceof Error ? err.message : String(err) }));
  process.exit(1);
});
