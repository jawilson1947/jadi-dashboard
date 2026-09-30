import { z } from "zod";
import { getPrincipal } from "@/server/auth/session";
import { hasPermission, requirePermission, ForbiddenError } from "@/server/authz/permissions";
import { getReportDefinition, REPORT_KEYS, type ReportKey } from "@/server/reports/definitions";
import { reportParamsSchema, resolveReport } from "@/server/reports/views";
import { buildReportExport } from "@/server/services/report-export";
import { fail, handle } from "@/server/api/respond";

const bodySchema = reportParamsSchema.extend({ format: z.enum(["csv", "xlsx"]).default("csv") });

/** Accepts the page's form POST as well as JSON, so export works with or without JavaScript. */
async function readBody(req: Request): Promise<Record<string, unknown>> {
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("application/json")) return (await req.json()) as Record<string, unknown>;
  const form = await req.formData();
  return Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === "string" && v !== "")) as Record<string, unknown>;
}

/**
 * POST /api/v1/reports/{key}/export — CSV or XLSX of the report as displayed (A-11, A-31).
 *
 * Gate: student.view, plus EITHER export.create OR mailmerge.create (R-D3). These files are both
 * an export and a mail-merge source, and requiring both grants would lock out the people the
 * reports were specified for.
 *
 * The rows come from resolveReport — the same function the page uses — so the download always
 * matches what was on screen.
 */
export const POST = handle(async (req, { correlationId }) => {
  const principal = requirePermission(await getPrincipal(), "student.view");
  if (!hasPermission(principal, "export.create") && !hasPermission(principal, "mailmerge.create")) {
    throw new ForbiddenError("export.create");
  }

  const key = decodeURIComponent(new URL(req.url).pathname.split("/").at(-2) ?? "");
  if (!(REPORT_KEYS as readonly string[]).includes(key)) return fail(404, "not_found", "Unknown report.", correlationId);
  const def = getReportDefinition(key)!;

  const q = bodySchema.parse(await readBody(req));
  const resolved = await resolveReport(key as ReportKey, q, principal, correlationId);

  const result = await buildReportExport(principal, def, resolved.rows, resolved.columns, {
    format: q.format,
    meta: resolved.meta,
    readAt: resolved.readAt,
    filters: resolved.filters,
    correlationId,
  });

  return new Response(result.body as BodyInit, {
    headers: { ...result.headers, "x-row-count": String(result.rowCount), "x-truncated": String(result.truncated) },
  });
});
