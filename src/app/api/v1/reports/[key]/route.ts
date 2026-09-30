import { getPrincipal } from "@/server/auth/session";
import { requirePermission } from "@/server/authz/permissions";
import { getReportDefinition, REPORT_KEYS, type ReportKey } from "@/server/reports/definitions";
import { reportParamsSchema, resolveReport } from "@/server/reports/views";
import { fail, handle, ok } from "@/server/api/respond";

/**
 * GET /api/v1/reports/{key} — the report's rows as JSON.
 *
 * Student-level, so student.view is required and the read is audited by resolveReport. The two
 * timestamps are both in `meta`: `capturedAt` is the population's, `readAt` is the live half's
 * (A-30). A client that shows one of them and not the other is misreporting the data.
 */
export const GET = handle(async (req, { correlationId }) => {
  const principal = requirePermission(await getPrincipal(), "student.view");
  const url = new URL(req.url);
  const key = decodeURIComponent(url.pathname.split("/").at(-1) ?? "");
  if (!(REPORT_KEYS as readonly string[]).includes(key)) return fail(404, "not_found", "Unknown report.", correlationId);
  const def = getReportDefinition(key)!;

  const q = reportParamsSchema.parse(Object.fromEntries(url.searchParams));
  const resolved = await resolveReport(key as ReportKey, q, principal, correlationId);

  return ok(
    { report: { key: def.key, ref: def.ref, title: def.title, termScope: def.termScope }, rows: resolved.rows },
    {
      correlationId,
      capturedAt: resolved.meta.capturedAt?.toISOString() ?? null,
      readAt: resolved.readAt.toISOString(),
      rowCount: resolved.rows.length,
      stale: resolved.meta.stale,
    },
  );
});
