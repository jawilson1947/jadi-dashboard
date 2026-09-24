import { getDashPool, sql } from "../db/mssql";
import { randomUUID } from "node:crypto";
import type { AppStore, JobDefinitionRecord, JobKey, JobRunRecord, MetricFamily, OperatorProfileRecord, SnapshotRecord, SprintWindowRecord } from "./types";

/** SQL Server AppStore over ousadb schema [dash] (db/migrations/001_init.sql), login jadi_dash. */
export class MssqlAppStore implements AppStore {
  private async pool() {
    return getDashPool();
  }

  async listJobs(): Promise<JobDefinitionRecord[]> {
    const r = await (await this.pool()).request().query<JobDefinitionRecord>("SELECT [key], name, cronExpression, isEnabled, minIntervalMinutes, lockedAt, lockedBy FROM dash.Job ORDER BY [key]");
    return r.recordset.map(mapJob);
  }
  async getJob(key: JobKey) {
    const r = await (await this.pool()).request().input("key", sql.VarChar(100), key).query<JobDefinitionRecord>("SELECT [key], name, cronExpression, isEnabled, minIntervalMinutes, lockedAt, lockedBy FROM dash.Job WHERE [key] = @key");
    return r.recordset[0] ? mapJob(r.recordset[0]) : null;
  }
  async upsertJob(job: JobDefinitionRecord) {
    await (await this.pool())
      .request()
      .input("key", sql.VarChar(100), job.key)
      .input("name", sql.NVarChar(200), job.name)
      .input("cron", sql.VarChar(100), job.cronExpression)
      .input("enabled", sql.Bit, job.isEnabled)
      .input("min", sql.Int, job.minIntervalMinutes)
      .query(`MERGE dash.Job AS t USING (SELECT @key AS [key]) AS s ON t.[key] = s.[key]
              WHEN MATCHED THEN UPDATE SET name = @name, cronExpression = @cron, isEnabled = @enabled, minIntervalMinutes = @min
              WHEN NOT MATCHED THEN INSERT ([key], name, cronExpression, isEnabled, minIntervalMinutes) VALUES (@key, @name, @cron, @enabled, @min);`);
  }
  async tryLockJob(key: JobKey, owner: string, now: Date, staleAfterMs: number) {
    // Single UPDATE with the lock predicate = atomic compare-and-set (Spec §14.6 "prevent overlapping executions").
    const r = await (await this.pool())
      .request()
      .input("key", sql.VarChar(100), key)
      .input("owner", sql.VarChar(200), owner)
      .input("now", sql.DateTime2, now)
      .input("staleBefore", sql.DateTime2, new Date(now.getTime() - staleAfterMs))
      .query(`UPDATE dash.Job SET lockedAt = @now, lockedBy = @owner
              WHERE [key] = @key AND (lockedAt IS NULL OR lockedAt < @staleBefore OR lockedBy = @owner)`);
    return (r.rowsAffected[0] ?? 0) === 1;
  }
  async unlockJob(key: JobKey, owner: string) {
    await (await this.pool()).request().input("key", sql.VarChar(100), key).input("owner", sql.VarChar(200), owner)
      .query("UPDATE dash.Job SET lockedAt = NULL, lockedBy = NULL WHERE [key] = @key AND lockedBy = @owner");
  }

  async createRun(run: JobRunRecord) {
    await (await this.pool())
      .request()
      .input("id", sql.UniqueIdentifier, run.id)
      .input("jobKey", sql.VarChar(100), run.jobKey)
      .input("status", sql.VarChar(20), run.status)
      .input("triggeredBy", sql.VarChar(200), run.triggeredBy)
      .input("startedAt", sql.DateTime2, run.startedAt)
      .query("INSERT INTO dash.JobRun (id, jobKey, status, triggeredBy, startedAt) VALUES (@id, @jobKey, @status, @triggeredBy, @startedAt)");
  }
  async finishRun(id: string, p: Pick<JobRunRecord, "status" | "finishedAt" | "durationMs" | "rowsProcessed" | "errorSummary">) {
    await (await this.pool())
      .request()
      .input("id", sql.UniqueIdentifier, id)
      .input("status", sql.VarChar(20), p.status)
      .input("finishedAt", sql.DateTime2, p.finishedAt)
      .input("durationMs", sql.Int, p.durationMs)
      .input("rows", sql.Int, p.rowsProcessed)
      .input("err", sql.NVarChar(1000), p.errorSummary)
      .query("UPDATE dash.JobRun SET status = @status, finishedAt = @finishedAt, durationMs = @durationMs, rowsProcessed = @rows, errorSummary = @err WHERE id = @id");
  }
  async listRuns(jobKey?: JobKey, limit = 50) {
    const req = (await this.pool()).request().input("limit", sql.Int, limit);
    const where = jobKey ? "WHERE jobKey = @jobKey" : "";
    if (jobKey) req.input("jobKey", sql.VarChar(100), jobKey);
    const r = await req.query<JobRunRecord>(`SELECT TOP (@limit) id, jobKey, status, triggeredBy, startedAt, finishedAt, durationMs, rowsProcessed, errorSummary FROM dash.JobRun ${where} ORDER BY startedAt DESC`);
    return r.recordset;
  }

  async saveSnapshot(s: SnapshotRecord) {
    await (await this.pool())
      .request()
      .input("id", sql.UniqueIdentifier, s.id)
      .input("jobRunId", sql.UniqueIdentifier, s.jobRunId)
      .input("family", sql.VarChar(50), s.metricFamily)
      .input("termKey", sql.VarChar(50), s.termKey)
      .input("capturedAt", sql.DateTime2, s.capturedAt)
      .input("provider", sql.VarChar(10), s.sourceProvider)
      .input("payload", sql.NVarChar(sql.MAX), JSON.stringify(s.payload))
      .input("rc", sql.Int, s.rowCount)
      .query("INSERT INTO dash.Snapshot (id, jobRunId, metricFamily, termKey, capturedAt, sourceProvider, payload, [rowCount]) VALUES (@id, @jobRunId, @family, @termKey, @capturedAt, @provider, @payload, @rc)");
  }
  async latestSnapshot<T>(family: MetricFamily) {
    const r = await (await this.pool()).request().input("family", sql.VarChar(50), family)
      .query<SnapshotRow>("SELECT TOP 1 * FROM dash.Snapshot WHERE metricFamily = @family ORDER BY capturedAt DESC");
    return r.recordset[0] ? mapSnapshot<T>(r.recordset[0]) : null;
  }
  async previousSnapshot<T>(family: MetricFamily, before: Date) {
    const r = await (await this.pool()).request().input("family", sql.VarChar(50), family).input("before", sql.DateTime2, before)
      .query<SnapshotRow>("SELECT TOP 1 * FROM dash.Snapshot WHERE metricFamily = @family AND capturedAt < @before ORDER BY capturedAt DESC");
    return r.recordset[0] ? mapSnapshot<T>(r.recordset[0]) : null;
  }

  /**
   * Newest snapshot per termKey (Spec §7.4 prior-semester overlay). The current term's snapshot is
   * refreshed constantly, so ROW_NUMBER per termKey keeps one row each instead of scanning history.
   */
  async latestSnapshotsByTerm<T>(family: MetricFamily, limit = 12) {
    const r = await (await this.pool()).request().input("family", sql.VarChar(50), family).input("limit", sql.Int, limit)
      .query<SnapshotRow>(`WITH ranked AS (
           SELECT *, ROW_NUMBER() OVER (PARTITION BY termKey ORDER BY capturedAt DESC) AS rn
           FROM dash.Snapshot WHERE metricFamily = @family)
         SELECT TOP (@limit) id, jobRunId, metricFamily, termKey, capturedAt, sourceProvider, payload, [rowCount]
         FROM ranked WHERE rn = 1 ORDER BY capturedAt DESC`);
    return r.recordset.map((row) => mapSnapshot<T>(row));
  }

  async listSprintWindows(): Promise<SprintWindowRecord[]> {
    const r = await (await this.pool()).request().query<SprintRow>("SELECT termKey, sprintStart, sprintEnd, updatedAt, updatedBy FROM dash.SemesterSprint ORDER BY sprintStart DESC");
    return r.recordset.map(mapSprint);
  }
  async getSprintWindow(termKey: string): Promise<SprintWindowRecord | null> {
    const r = await (await this.pool()).request().input("termKey", sql.VarChar(50), termKey)
      .query<SprintRow>("SELECT termKey, sprintStart, sprintEnd, updatedAt, updatedBy FROM dash.SemesterSprint WHERE termKey = @termKey");
    return r.recordset[0] ? mapSprint(r.recordset[0]) : null;
  }
  async setSprintWindow(termKey: string, start: string, end: string, updatedBy: string | null) {
    await (await this.pool())
      .request()
      .input("termKey", sql.VarChar(50), termKey)
      .input("start", sql.Date, start)
      .input("end", sql.Date, end)
      .input("by", sql.VarChar(200), updatedBy)
      .query(`MERGE dash.SemesterSprint AS t USING (SELECT @termKey AS termKey) AS s ON t.termKey = s.termKey
              WHEN MATCHED THEN UPDATE SET sprintStart = @start, sprintEnd = @end, updatedAt = SYSUTCDATETIME(), updatedBy = @by
              WHEN NOT MATCHED THEN INSERT (termKey, sprintStart, sprintEnd, updatedBy) VALUES (@termKey, @start, @end, @by);`);
  }

  async listOperatorProfiles(): Promise<OperatorProfileRecord[]> {
    const r = await (await this.pool()).request()
      .query<OperatorRow>("SELECT id, sourceCode, displayName, email, department, isActive, isSystem, effectiveFrom, effectiveTo, updatedAt, updatedBy FROM dash.OperatorProfile ORDER BY sourceCode, effectiveFrom");
    return r.recordset.map(mapOperator);
  }
  async upsertOperatorProfile(o: OperatorProfileRecord) {
    await (await this.pool())
      .request()
      .input("id", sql.UniqueIdentifier, o.id || randomUUID())
      .input("code", sql.VarChar(50), o.sourceCode)
      .input("name", sql.NVarChar(200), o.displayName)
      .input("email", sql.VarChar(320), o.email)
      .input("dept", sql.NVarChar(200), o.department)
      .input("active", sql.Bit, o.isActive)
      .input("system", sql.Bit, o.isSystem)
      .input("from", sql.Date, o.effectiveFrom)
      .input("to", sql.Date, o.effectiveTo)
      .input("by", sql.VarChar(200), o.updatedBy)
      // effectiveFrom IS updated on a match. It used to be left alone, which meant a wrong
      // effective-from could not be corrected from the UI at all: re-submitting the code with the
      // date cleared missed the (code, from) key and inserted a second row instead (J. Wilson,
      // 2026-09-24). Matching on the id first makes the edit an edit.
      .query(`MERGE dash.OperatorProfile AS t
              USING (SELECT @id AS id, @code AS sourceCode, @from AS effectiveFrom) AS s
                ON t.id = s.id OR (t.sourceCode = s.sourceCode AND ((t.effectiveFrom IS NULL AND s.effectiveFrom IS NULL) OR t.effectiveFrom = s.effectiveFrom))
              WHEN MATCHED THEN UPDATE SET displayName = @name, email = @email, department = @dept, isActive = @active,
                                           isSystem = @system, effectiveFrom = @from, effectiveTo = @to,
                                           updatedAt = SYSUTCDATETIME(), updatedBy = @by
              WHEN NOT MATCHED THEN INSERT (id, sourceCode, displayName, email, department, isActive, isSystem, effectiveFrom, effectiveTo, updatedBy)
                                   VALUES (@id, @code, @name, @email, @dept, @active, @system, @from, @to, @by);`);
  }
  async deleteOperatorProfile(id: string): Promise<boolean> {
    const r = await (await this.pool()).request().input("id", sql.UniqueIdentifier, id).query("DELETE FROM dash.OperatorProfile WHERE id = @id");
    return (r.rowsAffected[0] ?? 0) > 0;
  }

  async getSetting<T>(key: string) {
    const r = await (await this.pool()).request().input("key", sql.VarChar(100), key).query<{ value: string }>("SELECT value FROM dash.Setting WHERE [key] = @key");
    return r.recordset[0] ? (JSON.parse(r.recordset[0].value) as T) : null;
  }
  async setSetting<T>(key: string, value: T, updatedBy: string | null) {
    await (await this.pool())
      .request()
      .input("key", sql.VarChar(100), key)
      .input("value", sql.NVarChar(sql.MAX), JSON.stringify(value))
      .input("by", sql.VarChar(200), updatedBy)
      .query(`MERGE dash.Setting AS t USING (SELECT @key AS [key]) AS s ON t.[key] = s.[key]
              WHEN MATCHED THEN UPDATE SET value = @value, updatedAt = SYSUTCDATETIME(), updatedBy = @by
              WHEN NOT MATCHED THEN INSERT ([key], value, updatedBy) VALUES (@key, @value, @by);`);
  }
}

type SnapshotRow = Omit<SnapshotRecord, "payload"> & { payload: string };
type SprintRow = { termKey: string; sprintStart: Date | string; sprintEnd: Date | string; updatedAt: Date | string; updatedBy: string | null };
type OperatorRow = Omit<OperatorProfileRecord, "effectiveFrom" | "effectiveTo" | "updatedAt"> & { effectiveFrom: Date | string | null; effectiveTo: Date | string | null; updatedAt: Date | string };

/** SQL `date` arrives as a Date at UTC midnight; keep the calendar date, never a local-time shift. */
function isoDate(v: Date | string | null): string | null {
  if (v === null) return null;
  return typeof v === "string" ? v.slice(0, 10) : v.toISOString().slice(0, 10);
}
function mapSprint(r: SprintRow): SprintWindowRecord {
  return { termKey: r.termKey, start: isoDate(r.sprintStart)!, end: isoDate(r.sprintEnd)!, updatedAt: new Date(r.updatedAt), updatedBy: r.updatedBy };
}
function mapOperator(r: OperatorRow): OperatorProfileRecord {
  return { ...r, isActive: Boolean(r.isActive), isSystem: Boolean(r.isSystem), effectiveFrom: isoDate(r.effectiveFrom), effectiveTo: isoDate(r.effectiveTo), updatedAt: new Date(r.updatedAt) };
}

function mapJob(r: JobDefinitionRecord): JobDefinitionRecord {
  return { ...r, isEnabled: Boolean(r.isEnabled), lockedAt: r.lockedAt ? new Date(r.lockedAt) : null };
}
function mapSnapshot<T>(r: SnapshotRow): SnapshotRecord<T> {
  return { ...r, capturedAt: new Date(r.capturedAt), payload: JSON.parse(r.payload) as T };
}
