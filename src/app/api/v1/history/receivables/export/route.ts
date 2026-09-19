import { z } from "zod";
import { getPrincipal } from "@/server/auth/session";
import { requirePermission } from "@/server/authz/permissions";
import { audit } from "@/server/audit/audit";
import { getConfig } from "@/server/db/config";
import { getHistoryView } from "@/server/services/history";
import { csvHeaders, exportFilename, toCsv, type CsvColumn } from "@/server/services/export";
import { getCurrentTerms } from "@/server/metadata/terms";
import { handle, fail } from "@/server/api/respond";

const bodySchema = z.object({ groupBy: z.enum(["semester", "schoolYear"]).default("semester") });

type Row = { label: string; students: number; positiveBalance: number };
const COLUMNS: CsvColumn<Row>[] = [
  { header: "Period", value: (r) => r.label },
  { header: "Students with a debit balance", value: (r) => r.students },
  { header: "Debit balance", value: (r) => r.positiveBalance.toFixed(2) },
];

async function readBody(req: Request): Promise<Record<string, unknown>> {
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("application/json")) return (await req.json()) as Record<string, unknown>;
  const form = await req.formData();
  return Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === "string" && v !== "")) as Record<string, unknown>;
}

/**
 * POST /api/v1/history/receivables/export — aggregate rows only, no student data (Spec §9.3, §11).
 * The reconciliation lines are exported too: a file that omits them would not add up to the total.
 */
export const POST = handle(async (req, { correlationId }) => {
  const principal = requirePermission(await getPrincipal(), "history.view");
  requirePermission(principal, "export.create");
  const { groupBy } = bodySchema.parse(await readBody(req));
  const view = await getHistoryView({ groupBy });
  const r = view.receivables.value;
  if (!r) return fail(503, "metric_unavailable", "Receivables by semester have not been captured yet.", correlationId);

  const rows: Row[] = [
    ...r.rows.map((x) => ({ label: x.label, students: x.students, positiveBalance: x.positiveBalance })),
    { label: "Excluded terms (summer)", students: r.excluded.students, positiveBalance: r.excluded.positiveBalance },
    { label: "Never cleared", students: r.neverCleared.students, positiveBalance: r.neverCleared.positiveBalance },
    { label: "Unmatched term codes", students: r.unknown.students, positiveBalance: r.unknown.positiveBalance },
    { label: "Total", students: r.totalStudents, positiveBalance: r.total },
  ];
  const terms = await getCurrentTerms();
  const result = toCsv(rows, COLUMNS, exportFilename(`receivables-by-${groupBy === "semester" ? "semester" : "school-year"}`, terms.current.tradName, new Date(), getConfig().APP_TIMEZONE));
  await audit(principal, "export.create", {
    correlationId,
    targetType: "historyReceivables",
    targetId: groupBy,
    metadata: { kind: "csv", rowCount: result.rowCount, groupBy, total: r.total, reconciles: view.reconciles },
  });
  return new Response(result.body, { headers: { ...csvHeaders(result.filename), "x-row-count": String(result.rowCount) } });
});
