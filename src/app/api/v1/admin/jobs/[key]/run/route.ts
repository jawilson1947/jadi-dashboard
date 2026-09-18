import { z } from "zod";
import { getPrincipal } from "@/server/auth/session";
import { requirePermission } from "@/server/authz/permissions";
import { manualRun } from "@/server/services/admin";
import { JOB_DEFINITIONS } from "@/server/jobs/definitions";
import { fail, handle, ok } from "@/server/api/respond";
import type { JobKey } from "@/server/store/types";

const keySchema = z.enum(JOB_DEFINITIONS.map((j) => j.key) as [JobKey, ...JobKey[]]);

/** POST /api/v1/admin/jobs/{key}/run — manual refresh via the audited pipeline. */
export const POST = handle(async (req, { correlationId }) => {
  const principal = requirePermission(await getPrincipal(), "schedule.manage");
  const key = decodeURIComponent(new URL(req.url).pathname.split("/").at(-2) ?? "");
  const parsed = keySchema.safeParse(key);
  if (!parsed.success) return fail(404, "not_found", "Unknown job.", correlationId);
  const run = await manualRun(parsed.data, principal, correlationId);
  return ok(run, { correlationId }, { status: run.status === "FAILED" ? 502 : 200 });
});
