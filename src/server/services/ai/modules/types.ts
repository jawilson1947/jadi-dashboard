import type { DataProvider } from "../../../repositories/types";
import type { AppStore } from "../../../store/types";

/**
 * The analysis module contract (docs/AI-ANALYSIS-PLAN.md §5.1).
 *
 * AI-D1 — THE MODEL NARRATES, IT NEVER COMPUTES — is enforced by the shape of this type rather
 * than by discipline:
 *
 *   gather()   deterministic. Reads snapshots and the source, returns a typed `facts` object.
 *   present()  turns facts into what the page draws. It takes ONLY facts, so every number on
 *              screen provably came from the computation and not from the model.
 *   prompt()   takes ONLY facts. The model therefore cannot be handed a row, a name or an id,
 *              and cannot be handed a conclusion either (AI-D8).
 *
 * gather() and present() work with no model wired, which is what "runs dark" means and is this
 * deployment's normal state while A-13 is unsigned.
 */

export interface AnalysisDeps {
  provider?: DataProvider;
  store?: AppStore;
  now?: Date;
}

/** A headline number. `value` is pre-formatted: formatting is presentation, not fact. */
export interface AnalysisFigure {
  label: string;
  value: string;
  hint?: string;
}

export interface AnalysisTable {
  caption: string;
  columns: string[];
  /** Pre-formatted cells, in column order. */
  rows: string[][];
  /** Shown under the table — the caveat that belongs with this specific table. */
  note?: string;
}

/**
 * What the data cannot support (AI-D6). Goes into the facts object AND onto the page, so the model
 * is told about the gaps rather than left to write around them, and the reader sees the same list.
 */
export interface ConfidenceNote {
  /** Short label, e.g. "Spring 2025 (A-41)". */
  subject: string;
  /** What it does to this analysis, in one sentence. */
  effect: string;
}

export interface AnalysisCitation {
  /** Where the figures came from — table, view or snapshot family, never a row. */
  sources: string[];
  /** Snapshot capture time when the module read one, else null for a live read. */
  capturedAt: Date | null;
  readAt: Date;
}

/** The generated half. Null whenever no model is wired — the normal state today. */
export interface AnalysisNarrative {
  hypotheses: string[];
  questions: string[];
  model: string;
  generatedAt: Date;
}

export interface GatheredAnalysis<F> {
  facts: F;
  confidence: ConfidenceNote[];
  citation: AnalysisCitation;
}

export interface AnalysisPresentation {
  figures: AnalysisFigure[];
  tables: AnalysisTable[];
  /** The one-sentence computed finding. Stated by the code, not the model. */
  headline: string;
}

export interface AnalysisModule<F = unknown> {
  key: string;
  ref: "M1" | "M2" | "M5";
  title: string;
  blurb: string;
  /** The assumption row that must be signed before the prose appears. Shown in the dark state. */
  darkUntil: string;
  gather(deps: AnalysisDeps): Promise<GatheredAnalysis<F>>;
  present(gathered: GatheredAnalysis<F>): AnalysisPresentation;
  prompt(gathered: GatheredAnalysis<F>): string;
}

/**
 * Shared prompt preamble. Every module's prompt starts here, so the rules the model is held to are
 * written once and asserted once.
 *
 * The last two lines are AI-D1 and AI-D8 stated to the model as well as enforced by the types: it
 * must not produce figures, and it is not told what to conclude.
 */
export function promptPreamble(title: string): string {
  return [
    `You are writing the interpretation section of a university student-accounts analysis: "${title}".`,
    "",
    "Write exactly two sections, in this order, using these headings:",
    "HYPOTHESES — what could explain the figures below. Two to four short paragraphs.",
    "QUESTIONS — what someone should check next, or ask a colleague who knows the institution. Three to five bullets.",
    "",
    "Rules:",
    "- Use only the figures given below. Do not compute, estimate, restate or round any number, and",
    "  do not introduce a figure that is not listed.",
    "- Where the confidence notes say the data is incomplete, let that weaken the claim rather than",
    "  writing around it.",
    "- Offer competing explanations where the figures admit more than one. Do not settle on a cause",
    "  the figures cannot distinguish.",
    "- No recommendations that this data cannot support, and no advice about individual students.",
    "",
  ].join("\n");
}

/** Render facts and confidence into the prompt body. Shared so the format is identical per module. */
export function promptBody(facts: Record<string, unknown>, confidence: ConfidenceNote[]): string {
  const lines: string[] = ["FIGURES:"];
  for (const [k, v] of Object.entries(facts)) lines.push(`- ${k}: ${renderFact(v)}`);
  if (confidence.length) {
    lines.push("", "WHAT THE DATA CANNOT SUPPORT:");
    for (const c of confidence) lines.push(`- ${c.subject}: ${c.effect}`);
  }
  return lines.join("\n");
}

function renderFact(v: unknown): string {
  if (v === null || v === undefined) return "not available";
  if (Array.isArray(v)) return v.map((x) => renderFact(x)).join("; ");
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    return Object.entries(v as Record<string, unknown>)
      .map(([k, x]) => `${k}=${renderFact(x)}`)
      .join(", ");
  }
  return String(v);
}
