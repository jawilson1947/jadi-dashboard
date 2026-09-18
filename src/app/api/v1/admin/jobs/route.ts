import { getPrincipal } from "@/server/auth/session";
import { requirePermission } from "@/server/authz/permissions";
import { getJobStatuses } from "@/server/services/admin";
import { getAppStore } from "@/server/store";
import { handle, ok } from "@/server/api/respond";

/** GET /api/v1/admin/jobs — job configuration, last/next run, recent history (Spec §14.6, §17). */
export const GET = handle(async (_req, { correlationId }) => {
  requirePermission(await getPrincipal(), "schedule.manage");
  const jobs = await getJobStatuses();
  const runs = await getAppStore().listRuns(undefined, 100);
  return ok({ jobs, runs }, { correlationId });
});
