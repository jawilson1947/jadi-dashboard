import { getPrincipal } from "@/server/auth/session";
import { requirePermission } from "@/server/authz/permissions";
import { audit } from "@/server/audit/audit";
import { handle, ok, fail } from "@/server/api/respond";
import { idFromUrl } from "@/server/api/params";
import { getDataProvider } from "@/server/repositories";
import { analyzePayments } from "@/server/services/payment-analysis";

/**
 * GET /api/v1/students/{id}/payment-analysis (Spec §10.3, Bio Spec card 3).
 * Computed over the WHOLE global history, never over a page, so the ratios describe the account
 * rather than whatever happened to be on screen.
 */
export const GET = handle(async (req, { correlationId }) => {
  const principal = requirePermission(await getPrincipal(), "student.transactions.view");
  const id = idFromUrl(req, 2);
  const provider = getDataProvider();
  const bio = await provider.getStudentBio(id);
  if (!bio) return fail(404, "not_found", "No student with that ID.", correlationId);
  const rows = await provider.getStudentTransactions(id, "global");
  const analysis = analyzePayments(rows, bio.accountBalance);
  await audit(principal, "student.transactions_view", {
    correlationId,
    targetType: "student",
    targetId: id,
    metadata: { scope: "payment-analysis", transactions: analysis.transactionCount, collectionsRecommended: analysis.collectionsRecommended },
  });
  return ok(analysis, { correlationId });
});
