import { audit } from "../../audit/audit";
import type { Principal } from "../../authz/permissions";
import { trendsModule } from "./modules/trends";
import { receivableSemestersModule } from "./modules/receivable-semesters";
import { dataQualityModule } from "./modules/data-quality";
import {
  ANALYSIS_DARK_MESSAGES,
  analysisUnavailableReason,
  getAnalysisModel,
  type AiUnavailableReason,
} from "./model";
import type {
  AnalysisCitation,
  AnalysisDeps,
  AnalysisModule,
  AnalysisNarrative,
  AnalysisPresentation,
  ConfidenceNote,
} from "./modules/types";

/**
 * Phase 8a orchestration (docs/AI-ANALYSIS-PLAN.md).
 *
 * One path for every module: gather (deterministic), present (from facts only), then — if and only
 * if a model is wired — narrate. The dark path is not an error branch; it is the normal one today,
 * and it returns a complete page with the prose replaced by the reason it is missing.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a heterogeneous registry of modules with different fact types; each is internally sound.
const MODULES: AnalysisModule<any>[] = [trendsModule, receivableSemestersModule, dataQualityModule];

export const ANALYSIS_MODULES = MODULES.map((m) => ({
  key: m.key,
  ref: m.ref,
  title: m.title,
  blurb: m.blurb,
  darkUntil: m.darkUntil,
}));

export type AnalysisModuleSummary = (typeof ANALYSIS_MODULES)[number];

export function getAnalysisModule(key: string): AnalysisModule<unknown> | null {
  return MODULES.find((m) => m.key === key) ?? null;
}

export interface AnalysisView {
  key: string;
  ref: string;
  title: string;
  blurb: string;
  presentation: AnalysisPresentation;
  confidence: ConfidenceNote[];
  citation: AnalysisCitation;
  narrative: AnalysisNarrative | null;
  /** Set when the prose is absent. Carries the message and the assumption row that would fix it. */
  dark: { reason: AiUnavailableReason; message: string; assumption: string } | null;
}

/**
 * Split the model's reply into the two Spec §12 sections.
 *
 * Tolerant by design: a model that ignores the headings still produces readable output rather than
 * an empty page, and everything before HYPOTHESES is discarded rather than shown, because a
 * preamble is exactly where an invented figure would appear.
 */
export function splitNarrative(text: string): { hypotheses: string[]; questions: string[] } {
  const upper = text.toUpperCase();
  const hIdx = upper.indexOf("HYPOTHESES");
  const qIdx = upper.indexOf("QUESTIONS");
  const paras = (s: string) =>
    s
      .split(/\n{2,}|\n(?=[-•*]\s)/)
      .map((p) => p.replace(/^[-•*]\s*/, "").replace(/^HYPOTHESES[:\s-]*/i, "").replace(/^QUESTIONS[:\s-]*/i, "").trim())
      .filter(Boolean);

  if (hIdx === -1 && qIdx === -1) return { hypotheses: paras(text), questions: [] };
  if (qIdx === -1) return { hypotheses: paras(text.slice(hIdx)), questions: [] };
  if (hIdx === -1 || hIdx > qIdx) return { hypotheses: [], questions: paras(text.slice(qIdx)) };
  return { hypotheses: paras(text.slice(hIdx, qIdx)), questions: paras(text.slice(qIdx)) };
}

export async function getAnalysisView(key: string, deps: AnalysisDeps = {}): Promise<AnalysisView | null> {
  // Named `mod`, not `module`: Next forbids assigning to `module` (no-assign-module-variable).
  const mod = getAnalysisModule(key);
  if (!mod) return null;

  // Always runs, model or not. This is the half that ships.
  const gathered = await mod.gather(deps);
  const presentation = mod.present(gathered);

  const base: AnalysisView = {
    key: mod.key,
    ref: mod.ref,
    title: mod.title,
    blurb: mod.blurb,
    presentation,
    confidence: gathered.confidence,
    citation: gathered.citation,
    narrative: null,
    dark: null,
  };

  const reason = analysisUnavailableReason();
  if (reason) {
    return { ...base, dark: { reason, message: ANALYSIS_DARK_MESSAGES[reason], assumption: mod.darkUntil } };
  }

  const model = getAnalysisModel()!;
  const text = await model.complete(mod.prompt(gathered));
  const { hypotheses, questions } = splitNarrative(text);
  return {
    ...base,
    narrative: { hypotheses, questions, model: model.name, generatedAt: deps.now ?? new Date() },
  };
}

/**
 * Audited like a report view: the module and whether prose was produced, never the figures.
 *
 * `narrated` matters after the fact — "was this reading the model's or the arithmetic's?" is the
 * first question anyone will ask about a decision taken from one of these pages.
 */
export async function auditAnalysisView(actor: Principal, view: AnalysisView, correlationId: string): Promise<void> {
  await audit(actor, "ai.analysis_view", {
    correlationId,
    targetType: "ai-analysis",
    targetId: view.key,
    metadata: {
      ref: view.ref,
      narrated: view.narrative !== null,
      model: view.narrative?.model ?? null,
      dark: view.dark?.reason ?? null,
    },
  });
}
