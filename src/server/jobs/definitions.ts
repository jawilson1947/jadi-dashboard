import type { DataProvider } from "../repositories/types";
import { resolveTerms } from "../repositories/types";
import type { AppStore, JobDefinitionRecord, JobKey, MetricFamily } from "../store/types";
import { buildBreakdown } from "../metadata/clearance-breakdown";
import { captureSprint } from "../services/sprint";
import { buildAcademicYears } from "../services/history";

/**
 * Scheduled refresh jobs (Spec §14.6). Each job reads from the DataProvider and produces
 * one snapshot payload. Schedules are seeded here and thereafter admin-editable in the store.
 *
 * Defaults reflect FINDINGS §6: the source views are slow, so nothing here runs on page load.
 * During the clearance sprint the enrollment/clearance job runs every 15 minutes; the nightly
 * 9 pm SQL Agent job that writes tblOUSA is untouched and is captured by `metadata.terms`.
 */
export interface JobDefinition {
  key: JobKey;
  name: string;
  family: MetricFamily;
  defaultCron: string;
  minIntervalMinutes: number;
  /** `store` is passed for jobs that need application-owned configuration (e.g. the sprint window). */
  run(provider: DataProvider, store: AppStore): Promise<{ payload: unknown; rowCount: number | null; termKey: string | null }>;
}

async function currentTermKey(provider: DataProvider): Promise<string> {
  return resolveTerms(await provider.getTermMetadata()).current.tradName;
}

export const JOB_DEFINITIONS: JobDefinition[] = [
  {
    key: "metadata.terms",
    name: "Semester metadata (tblOUSA)",
    family: "terms",
    defaultCron: "5 21 * * *", // 21:05 — right after the 9 pm nightly job
    minIntervalMinutes: 5,
    async run(provider) {
      const terms = await provider.getTermMetadata();
      return { payload: terms, rowCount: terms.length, termKey: resolveTerms(terms).current.tradName };
    },
  },
  {
    key: "dashboard.enrollmentClearance",
    name: "Enrolled vs. financially cleared",
    family: "enrollmentClearance",
    defaultCron: "*/15 * * * *",
    minIntervalMinutes: 5,
    async run(provider) {
      const [payload, termKey] = await Promise.all([provider.getEnrollmentClearance(), currentTermKey(provider)]);
      return { payload, rowCount: payload.enrolled, termKey };
    },
  },
  {
    key: "dashboard.currentReceivable",
    name: "Current receivable",
    family: "currentReceivable",
    defaultCron: "*/30 * * * *",
    minIntervalMinutes: 10,
    async run(provider) {
      const terms = resolveTerms(await provider.getTermMetadata());
      const payload = await provider.getCurrentReceivable(terms.currentKeys);
      return { payload: { ...payload, terms: terms.currentKeys }, rowCount: payload.studentCount, termKey: terms.current.tradName };
    },
  },
  {
    key: "dashboard.chargesCredits",
    name: "Charges, credits and delta",
    family: "chargesCredits",
    defaultCron: "0 * * * *",
    minIntervalMinutes: 15,
    async run(provider) {
      const [payload, termKey] = await Promise.all([provider.getChargesCredits(), currentTermKey(provider)]);
      return { payload, rowCount: null, termKey };
    },
  },
  {
    key: "dashboard.clearanceBreakdown",
    name: "Clearance breakdown by classification",
    family: "clearanceBreakdown",
    defaultCron: "*/15 * * * *",
    minIntervalMinutes: 5,
    async run(provider) {
      const [counts, termKey] = await Promise.all([provider.getClassificationCounts(), currentTermKey(provider)]);
      const rows = buildBreakdown(counts.enrolled, counts.cleared);
      return { payload: rows, rowCount: rows.find((r) => r.isTotal)?.enrolled ?? null, termKey };
    },
  },
  {
    key: "sprint.daily",
    name: "Clearance sprint (by date, operator, classification)",
    family: "sprintDaily",
    // Every 15 minutes during the sprint; outside a configured window the run captures an empty payload.
    defaultCron: "*/15 * * * *",
    minIntervalMinutes: 5,
    async run(provider, store) {
      const terms = resolveTerms(await provider.getTermMetadata());
      const { payload, rowCount } = await captureSprint(provider, store);
      return { payload, rowCount, termKey: terms.current.tradName };
    },
  },
  {
    key: "history.enrollmentClearance",
    name: "Historical enrolled vs. financially cleared",
    family: "historyEnrollment",
    // The figures only change when the nightly 9 pm job writes them, so once a day at 21:10 is enough.
    defaultCron: "10 21 * * *",
    minIntervalMinutes: 60,
    async run(provider) {
      const terms = await provider.getTermMetadata();
      const payload = buildAcademicYears(terms);
      return { payload, rowCount: payload.length, termKey: resolveTerms(terms).current.tradName };
    },
  },
  {
    key: "history.globalBalances",
    name: "Global receivables and credit balances",
    family: "historyBalances",
    defaultCron: "15 21 * * *",
    minIntervalMinutes: 60,
    async run(provider) {
      const [payload, termKey] = await Promise.all([provider.getGlobalBalances(), currentTermKey(provider)]);
      return { payload, rowCount: payload.positiveCount, termKey };
    },
  },
  {
    key: "history.receivablesBySemester",
    name: "Receivables by semester",
    family: "historyReceivables",
    defaultCron: "20 21 * * *",
    minIntervalMinutes: 60,
    // The raw per-term rows are captured; mapping codes to semesters happens at read time, so a later
    // fix to the resolver corrects the whole archive instead of needing every snapshot re-captured.
    async run(provider) {
      const [payload, termKey] = await Promise.all([provider.getReceivablesByTerm(), currentTermKey(provider)]);
      return { payload, rowCount: payload.length, termKey };
    },
  },
  {
    key: "dashboard.dnrDnc",
    name: "DNC / DNR summary",
    family: "dnrDnc",
    defaultCron: "0 * * * *",
    minIntervalMinutes: 15,
    async run(provider) {
      const [payload, termKey] = await Promise.all([provider.getDnrDncSummary(), currentTermKey(provider)]);
      return { payload, rowCount: payload.dnc.count + payload.dnr.count, termKey };
    },
  },
];

export function getJobDefinition(key: JobKey): JobDefinition {
  const def = JOB_DEFINITIONS.find((j) => j.key === key);
  if (!def) throw new Error(`Unknown job ${key}`);
  return def;
}

export function toRecord(def: JobDefinition): JobDefinitionRecord {
  return { key: def.key, name: def.name, cronExpression: def.defaultCron, isEnabled: true, minIntervalMinutes: def.minIntervalMinutes, lockedAt: null, lockedBy: null };
}
