import { randomUUID } from "node:crypto";
import { Cron } from "croner";
import { getConfig } from "../db/config";
import { getAppStore } from "../store";
import type { AppStore, JobDefinitionRecord, JobKey, JobRunRecord, OperatorProfileRecord, SprintWindowRecord } from "../store/types";
import { isIsoDate } from "@/lib/dates";
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

/**
 * Set a semester's clearance sprint window (ASSUMPTIONS A-10). Both dates are required and are
 * calendar dates in the institution timezone; there is no computed default, and the app never
 * writes these back to tblOUSA (A-20). Changing them invalidates the current sprint snapshot,
 * which the sprint page detects and re-captures on its next load.
 */
export async function setSprintWindow(
  actor: Principal,
  input: { termKey: string; start: string; end: string },
  correlationId?: string,
  store: AppStore = getAppStore(),
): Promise<SprintWindowRecord> {
  if (!isIsoDate(input.start) || !isIsoDate(input.end)) throw new Error("Sprint dates must be calendar dates (YYYY-MM-DD).");
  if (input.end < input.start) throw new Error("The sprint end date cannot be before the start date.");
  const before = await store.getSprintWindow(input.termKey);
  await store.setSprintWindow(input.termKey, input.start, input.end, actor.userId);
  await audit(actor, "admin.change", {
    correlationId,
    targetType: "sprintWindow",
    targetId: input.termKey,
    metadata: { start: input.start, end: input.end, previousStart: before?.start ?? null, previousEnd: before?.end ?? null },
  });
  return (await store.getSprintWindow(input.termKey))!;
}

export interface OperatorInput {
  id?: string;
  sourceCode: string;
  displayName: string;
  email?: string | null;
  department?: string | null;
  isActive?: boolean;
  isSystem?: boolean;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
}

/** Create or update an operator profile (Spec §7.2). Names are entered by administrators, never inferred. */
export async function upsertOperator(actor: Principal, input: OperatorInput, correlationId?: string, store: AppStore = getAppStore()): Promise<OperatorProfileRecord> {
  for (const d of [input.effectiveFrom, input.effectiveTo]) if (d && !isIsoDate(d)) throw new Error("Effective dates must be calendar dates (YYYY-MM-DD).");
  if (input.effectiveFrom && input.effectiveTo && input.effectiveTo < input.effectiveFrom) throw new Error("The effective-to date cannot be before the effective-from date.");
  const record: OperatorProfileRecord = {
    id: input.id ?? randomUUID(),
    sourceCode: input.sourceCode.trim(),
    displayName: input.displayName.trim(),
    email: input.email?.trim() || null,
    department: input.department?.trim() || null,
    isActive: input.isActive ?? true,
    isSystem: input.isSystem ?? false,
    effectiveFrom: input.effectiveFrom || null,
    effectiveTo: input.effectiveTo || null,
    updatedAt: new Date(),
    updatedBy: actor.userId,
  };
  try {
    await store.upsertOperatorProfile(record);
  } catch (err) {
    // One profile per (code, effective-from), and one open-ended profile per code — enforced by two
    // filtered unique indexes. Editing a date into a slot another row holds should read as a
    // conflict, not as an internal error.
    if (isDuplicateKey(err)) throw new Error(`Another profile for ${record.sourceCode} already covers that effective-from date. Edit or remove that one instead.`);
    throw err;
  }
  await audit(actor, "admin.change", {
    correlationId,
    targetType: "operatorProfile",
    targetId: record.sourceCode,
    metadata: { displayName: record.displayName, isActive: record.isActive, effectiveFrom: record.effectiveFrom, effectiveTo: record.effectiveTo },
  });
  return record;
}

function isDuplicateKey(err: unknown): boolean {
  const n = (err as { number?: number } | null)?.number;
  return n === 2601 || n === 2627;
}

/**
 * Remove a profile outright. Deleting is the only way to retire a mapping that should never have
 * existed; a mapping that merely ended belongs in `effectiveTo` so past actions keep resolving.
 */
export async function deleteOperator(actor: Principal, id: string, correlationId?: string, store: AppStore = getAppStore()): Promise<boolean> {
  const existing = (await store.listOperatorProfiles()).find((o) => o.id === id) ?? null;
  const removed = await store.deleteOperatorProfile(id);
  if (removed) {
    await audit(actor, "admin.change", {
      correlationId,
      targetType: "operatorProfile",
      targetId: existing?.sourceCode ?? id,
      metadata: { action: "delete", displayName: existing?.displayName ?? null, effectiveFrom: existing?.effectiveFrom ?? null, effectiveTo: existing?.effectiveTo ?? null },
    });
  }
  return removed;
}

export async function listOperators(store: AppStore = getAppStore()): Promise<OperatorProfileRecord[]> {
  return store.listOperatorProfiles();
}

export async function listSprintWindows(store: AppStore = getAppStore()): Promise<SprintWindowRecord[]> {
  return store.listSprintWindows();
}
