import { getPrincipal } from "@/server/auth/session";
import { requirePermission } from "@/server/authz/permissions";
import { audit } from "@/server/audit/audit";
import { handle, ok, fail } from "@/server/api/respond";
import { idFromUrl } from "@/server/api/params";
import { getDataProvider } from "@/server/repositories";
import { getCurrentTerms } from "@/server/metadata/terms";
import { analyzePayments } from "@/server/services/payment-analysis";
import { AiUnavailableError, buildFacts, draftCollectionNotice } from "@/server/services/ai/collection-notice";
import { AI_NOTICE_RULE, takeToken } from "@/server/identity/rate-limit";

/**
 * POST /api/v1/students/{id}/collection-notice (Spec §12, Bio Spec 3.5; sub-phase 5f).
 *
 * Disabled by default and 503 with the reason until A-13 and A-26 are signed — this path sends
 * identified student data to an external model. It drafts text for a person to review; it sends
 * nothing to anybody.
 */
export const POST = handle(async (req, { correlationId }) => {
  const principal = requirePermission(await getPrincipal(), "ai.notice.create");
  const id = idFromUrl(req, 2);
  if (!takeToken(`ai-notice:${principal.userId}`, AI_NOTICE_RULE)) {
    return fail(429, "rate_limited", "Too many notice drafts in the last hour.", correlationId);
  }
  const provider = getDataProvider();
  const bio = await provider.getStudentBio(id);
  if (!bio) return fail(404, "not_found", "No student with that ID.", correlationId);
  if (bio.accountBalance <= 0) {
    return fail(409, "no_balance", "This student does not owe a debit balance, so there is nothing to collect.", correlationId);
  }

  const [rows, terms] = await Promise.all([provider.getStudentTransactions(id, "global"), getCurrentTerms(undefined, provider)]);
  const analysis = analyzePayments(rows, bio.accountBalance);
  const facts = buildFacts(bio, analysis, { institutionName: "the university", semesterLabel: terms.label });

  try {
    const draft = await draftCollectionNotice(facts);
    await audit(principal, "ai.notice_draft", {
      correlationId,
      targetType: "student",
      targetId: id,
      metadata: { model: draft.model, balanceOwed: bio.accountBalance, daysSinceLastPayment: analysis.daysSinceLastCredit },
    });
    return ok(draft, { correlationId });
  } catch (err) {
    if (err instanceof AiUnavailableError) {
      await audit(principal, "ai.notice_draft", { correlationId, targetType: "student", targetId: id, metadata: { refused: err.reason } });
      return fail(503, "ai_unavailable", err.message, correlationId);
    }
    throw err;
  }
});
