import { z } from "zod";
import { getPrincipal } from "@/server/auth/session";
import { requirePermission } from "@/server/authz/permissions";
import { reclaimStudent } from "@/server/services/reclaim";
import { fail, handle, ok } from "@/server/api/respond";

const bodySchema = z.object({
  id: z.string().min(1).max(20),
  // Only set by the button that says "Add incomplete record", never a default. A user must have
  // seen which source records are missing before this can be true.
  allowPartial: z
    .union([z.literal("1"), z.literal("true"), z.literal("on"), z.undefined()])
    .transform((v) => v === "1" || v === "true" || v === "on")
    .optional(),
});

async function readBody(req: Request): Promise<Record<string, unknown>> {
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("application/json")) return (await req.json()) as Record<string, unknown>;
  const form = await req.formData();
  return Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === "string" && v !== "")) as Record<string, unknown>;
}

/**
 * POST /api/v1/students/reclaim — create a tblStudent record from Jenzabar (A-32).
 *
 * The application's only write to source data. Requires `student.create`, which no role but
 * ADMINISTRATOR holds by default, and which exists precisely so this action is distinguishable in
 * the audit log from every other kind of change.
 *
 * POST rather than a link: it is state-changing, and it must not be reachable by prefetch, browser
 * history, or a pasted URL. `handle` rejects cross-origin requests before the handler runs.
 */
export const POST = handle(async (req, { correlationId }) => {
  const principal = requirePermission(await getPrincipal(), "student.create");
  const q = bodySchema.parse(await readBody(req));

  const attempt = await reclaimStudent(principal, q.id, Boolean(q.allowPartial), correlationId);
  const id = q.id.trim();

  /**
   * The panel posts a plain HTML form, with no JavaScript. Answering it with JSON makes the browser
   * navigate to this endpoint and render the response body — which is what happened on the first
   * successful reclaim: the record was created, and the user was shown a page of JSON that reads
   * like a crash. A form post gets a redirect; JSON clients still get JSON.
   *
   * 303 specifically, so the browser follows with GET and a refresh cannot re-submit the write.
   */
  const wantsRedirect = !(req.headers.get("content-type") ?? "").includes("application/json");
  if (wantsRedirect) {
    const url = attempt.landOnProfile
      ? // Step 5: land on the Bio Card, which carries the incomplete-record banner when there are gaps.
        new URL(`/students/${encodeURIComponent(id)}`, req.url)
      : // A refusal goes back to the lookup, which re-runs the diagnostic and shows why.
        new URL(`/students?by=id&id=${encodeURIComponent(id)}&reclaim=${attempt.outcome}`, req.url);
    return new Response(null, { status: 303, headers: { location: url.toString() } });
  }

  if (attempt.outcome === "unavailable") {
    return fail(503, "reclaim_unavailable", attempt.message, correlationId);
  }
  return ok(
    { outcome: attempt.outcome, message: attempt.message, idnumber: id, landOnProfile: attempt.landOnProfile },
    { correlationId },
    // A refusal is a 200 with an outcome, not an error: the page shows the reason and the user
    // decides what to do. Only an unavailable procedure is a failure of the request itself.
    { status: 200 },
  );
});
