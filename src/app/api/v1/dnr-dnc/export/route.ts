import { z } from "zod";
import { getPrincipal } from "@/server/auth/session";
import { requirePermission } from "@/server/authz/permissions";
import { exportDnrDnc } from "@/server/services/dnr-dnc";
import { csvHeaders } from "@/server/services/export";
import { handle } from "@/server/api/respond";
import { optionalFilter } from "@/server/api/query";

const bodySchema = z.object({
  category: optionalFilter(z.enum(["DNR", "DNC"])),
  classification: optionalFilter(z.string().max(10)),
  lastCleared: optionalFilter(z.string().max(50)),
  minBalance: optionalFilter(z.coerce.number().min(0)),
  maxBalance: optionalFilter(z.coerce.number().min(0)),
  sort: z.enum(["default", "category", "classification", "lastName", "firstName", "accountBalance", "idnumber", "lastCleared"]).default("default"),
  direction: z.enum(["asc", "desc"]).default("asc"),
});

/** Accepts the page's form POST as well as JSON, so the export works with or without JavaScript. */
async function readBody(req: Request): Promise<Record<string, unknown>> {
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("application/json")) return (await req.json()) as Record<string, unknown>;
  const form = await req.formData();
  return Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === "string" && v !== "")) as Record<string, unknown>;
}

/**
 * POST /api/v1/dnr-dnc/export — CSV of the filtered population (Spec §11, A-11).
 * Requires export.create in addition to student.view; the service writes the audit row.
 */
export const POST = handle(async (req, { correlationId }) => {
  const principal = requirePermission(await getPrincipal(), "student.view");
  requirePermission(principal, "export.create");
  const q = bodySchema.parse(await readBody(req));
  const result = await exportDnrDnc(
    principal,
    {
      filter: { category: q.category, classification: q.classification, lastCleared: q.lastCleared, minBalance: q.minBalance, maxBalance: q.maxBalance },
      sort: q.sort,
      direction: q.direction,
    },
    correlationId,
  );
  return new Response(result.body, { headers: { ...csvHeaders(result.filename), "x-row-count": String(result.rowCount), "x-truncated": String(result.truncated) } });
});
