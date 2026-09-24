import { getConfig } from "../../db/config";
import type { PaymentAnalysis } from "../payment-analysis";
import type { StudentProfile } from "../students";

/**
 * AI-drafted collection notice (Spec §12, Bio Spec 3.5; sub-phase 5f).
 *
 * This is the first path in the application that sends IDENTIFIED student data to an external model:
 * a collection notice has to carry a name, a student ID and a sum owed. A-13 approved aggregates
 * only, so A-26 exists for this and it is unsigned. Consequences, enforced here rather than left to
 * the caller:
 *
 *   • two switches must both be on — AI_ENABLED and AI_IDENTIFIED_DATA_ENABLED (A-26)
 *   • the caller needs ai.notice.create, which no role holds by default except Administrator
 *   • the prompt is built server-side from a fixed field list; no transaction rows, no PID, no CNP,
 *     no date of birth, no address ever enter it
 *   • every draft is returned with a citation block naming what it was computed from
 *
 * The draft is a STARTING POINT for a person to review and send, never an automatic action: nothing
 * here emails anybody.
 */

export class AiUnavailableError extends Error {
  constructor(public readonly reason: "disabled" | "identified-data-not-approved" | "no-model") {
    super(
      reason === "disabled"
        ? "AI analyses are turned off."
        : reason === "identified-data-not-approved"
          ? "Drafting a collection notice sends identified student data to an external model, which has not been approved (ASSUMPTIONS A-13, A-26)."
          : "No approved model is configured for this deployment.",
    );
    this.name = "AiUnavailableError";
  }
}

/** Exactly what may be sent. Anything not on this list is not in the prompt. */
export interface CollectionNoticeFacts {
  studentName: string;
  idnumber: string;
  balanceOwed: number;
  lastPaymentOn: string | null;
  daysSinceLastPayment: number | null;
  oldestUnpaidBucket: string | null;
  institutionName: string;
  semesterLabel: string;
}

export function buildFacts(
  profile: Pick<StudentProfile, "idnumber" | "firstName" | "lastName" | "accountBalance">,
  analysis: PaymentAnalysis,
  context: { institutionName: string; semesterLabel: string },
): CollectionNoticeFacts {
  const oldest = [...analysis.aging].reverse().find((b) => b.amount > 0) ?? null;
  return {
    studentName: `${profile.firstName} ${profile.lastName}`.trim(),
    idnumber: profile.idnumber,
    balanceOwed: profile.accountBalance,
    lastPaymentOn: analysis.lastCreditOn,
    daysSinceLastPayment: analysis.daysSinceLastCredit,
    oldestUnpaidBucket: oldest ? oldest.label : null,
    institutionName: context.institutionName,
    semesterLabel: context.semesterLabel,
  };
}

/**
 * The prompt. Deterministic and pure, so a test can assert what it does and does not contain
 * (tests/unit/collection-notice.test.ts) — the guarantee about what leaves the network is a test,
 * not a comment.
 */
export function buildPrompt(facts: CollectionNoticeFacts): string {
  const money = (n: number) => `$${n.toFixed(2)}`;
  return [
    "Draft a short, courteous first-contact collection notice from a university student accounts office.",
    "Requirements: state the amount owed and how to pay or arrange a payment plan; offer a contact point;",
    "do not threaten legal action; do not mention credit reporting; do not state or imply any consequence",
    "for enrollment or transcripts that is not listed below; keep it under 200 words.",
    "",
    "Facts you may use (use no others, and invent nothing):",
    `- Student: ${facts.studentName} (ID ${facts.idnumber})`,
    `- Institution: ${facts.institutionName}`,
    `- Semester of record: ${facts.semesterLabel}`,
    `- Balance owed: ${money(facts.balanceOwed)}`,
    `- Last payment received: ${facts.lastPaymentOn ?? "none on file"}${facts.daysSinceLastPayment !== null ? ` (${facts.daysSinceLastPayment} days ago)` : ""}`,
    `- Oldest unpaid amount falls in: ${facts.oldestUnpaidBucket ?? "not determined"}`,
  ].join("\n");
}

export interface CollectionNoticeDraft {
  text: string;
  model: string;
  /** Spec §12: every AI output names what it was built from. */
  citation: { facts: CollectionNoticeFacts; generatedAt: string; retentionDays: number };
}

/** A model adapter. None is configured until A-13/A-26 are signed and a provider is chosen. */
export interface NoticeModel {
  readonly name: string;
  complete(prompt: string): Promise<string>;
}

let model: NoticeModel | null = null;

/** Wired once a model is approved; also the seam the tests use. */
export function setNoticeModel(next: NoticeModel | null): void {
  model = next;
}

/** Throws AiUnavailableError unless both switches are on and a model is wired. */
export function assertNoticeAvailable(): NoticeModel {
  const cfg = getConfig();
  if (!cfg.AI_ENABLED) throw new AiUnavailableError("disabled");
  if (!cfg.AI_IDENTIFIED_DATA_ENABLED) throw new AiUnavailableError("identified-data-not-approved");
  if (!model) throw new AiUnavailableError("no-model");
  return model;
}

export async function draftCollectionNotice(facts: CollectionNoticeFacts): Promise<CollectionNoticeDraft> {
  const active = assertNoticeAvailable();
  const text = await active.complete(buildPrompt(facts));
  return {
    text,
    model: active.name,
    citation: { facts, generatedAt: new Date().toISOString(), retentionDays: getConfig().AI_RETENTION_DAYS },
  };
}
