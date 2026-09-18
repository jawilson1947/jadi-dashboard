/**
 * Run every enabled job once through the audited pipeline and print a summary. Useful for
 * operations ("refresh everything now") and for verifying a new environment:
 *   npm run snapshot:once
 * Honors DATA_PROVIDER / APP_STORE / OUSADB_CONNECTION_STRING from the environment.
 */
import { getConfig } from "../src/server/db/config";
import { closePools } from "../src/server/db/mssql";
import { JOB_DEFINITIONS } from "../src/server/jobs/definitions";
import { ensureJobsSeeded, runJob } from "../src/server/jobs/runner";
import { getAppStore } from "../src/server/store";

async function main() {
  const cfg = getConfig();
  const store = getAppStore();
  await ensureJobsSeeded(store);
  console.log(`provider=${cfg.DATA_PROVIDER} store=${cfg.APP_STORE}${cfg.APP_STORE === "memory" ? ` (${cfg.APP_STORE_FILE})` : ""}`);
  for (const def of JOB_DEFINITIONS) {
    const r = await runJob(def.key, { triggeredBy: "manual:snapshot-once", ignoreMinInterval: true });
    const snap = r.status === "SUCCEEDED" ? await store.latestSnapshot(def.family) : null;
    const payload = snap ? JSON.stringify(snap.payload).slice(0, 240) : r.errorSummary ?? "";
    console.log(`${r.status.padEnd(16)} ${def.key.padEnd(32)} ${String(r.durationMs ?? 0).padStart(7)} ms  ${payload}`);
  }
  await closePools().catch(() => undefined);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
