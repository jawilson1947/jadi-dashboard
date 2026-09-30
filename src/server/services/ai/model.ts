import { getConfig } from "../../db/config";

/**
 * The model seam shared by every AI output (docs/AI-ANALYSIS-PLAN.md §5.1, AI-D4).
 *
 * `collection-notice.ts` proved this shape in Phase 5f; this lifts it so the analysis modules use
 * the same one interface. Deliberately minimal — a prompt in, text out — because AI-D4 leaves the
 * hosting decision open and anything richer would encode an assumption about the provider.
 *
 * TWO LEVELS OF PERMISSION, and they are not the same:
 *
 *   • ANALYSIS modules (M1, M2, M5) send aggregates only — counts, sums, percentages, term labels.
 *     That is what A-13 covers as drafted, so `AI_ENABLED` alone gates them.
 *   • The COLLECTION NOTICE sends a name, an ID and a balance, which A-13 does not cover. It keeps
 *     its own second switch (A-26) in collection-notice.ts.
 *
 * Nothing here relaxes that. An analysis module physically cannot send identified data, because
 * §6's deny-list is enforced by the facts object it builds its prompt from — see modules/types.ts.
 */

export interface AiModel {
  readonly name: string;
  complete(prompt: string): Promise<string>;
}

export type AiUnavailableReason = "disabled" | "no-model";

export class AnalysisUnavailableError extends Error {
  constructor(public readonly reason: AiUnavailableReason) {
    super(
      reason === "disabled"
        ? "AI analyses are turned off for this deployment."
        : "No approved model is configured, so the written analysis is unavailable (ASSUMPTIONS A-13).",
    );
    this.name = "AnalysisUnavailableError";
  }
}

let model: AiModel | null = null;

/** Wired once A-13 is signed and a provider chosen (AI-D4). Also the seam the tests use. */
export function setAnalysisModel(next: AiModel | null): void {
  model = next;
}

export function getAnalysisModel(): AiModel | null {
  return model;
}

/**
 * Why the prose is missing, or null when it is available.
 *
 * Returns a reason rather than throwing, because a missing model is the NORMAL state of this
 * deployment, not an error: the page renders every computed figure and says why the narrative is
 * absent. Throwing would make the ordinary case an exception path.
 */
export function analysisUnavailableReason(): AiUnavailableReason | null {
  if (!getConfig().AI_ENABLED) return "disabled";
  if (!model) return "no-model";
  return null;
}

export const ANALYSIS_DARK_MESSAGES: Record<AiUnavailableReason, string> = {
  disabled: "AI analyses are turned off for this deployment. Every figure below is computed and current; only the written interpretation is absent.",
  "no-model":
    "No approved model is configured yet — ASSUMPTIONS A-13 (model hosting and data-sharing approval) is unsigned. Every figure below is computed and current; only the written interpretation is absent.",
};
