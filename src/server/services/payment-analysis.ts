import type { TransactionRow } from "../repositories/types";

/**
 * Global History Payment Analysis (Spec §10.3, Bio Spec card 3).
 *
 * Two different things could be called "aging" here, and the Bio Spec asks for both without naming
 * them apart (A-25), so this module computes and labels each separately:
 *
 *   • AGE OF THE BALANCE — credits are applied to the oldest charges first, and whatever debit is
 *     left unpaid is bucketed by its own age (A-6 buckets). This is what a collections conversation
 *     is actually about.
 *   • DAYS SINCE LAST CREDIT — recency of payment, which is what drives the six-month cue.
 *
 * Every ratio carries the count it was computed from: a "100% financial aid" built on one
 * transaction is not the same claim as one built on forty, and the card says which it is.
 */

export const DEFAULT_AGING_BUCKETS = [
  { label: "Current", from: 0, to: 0 },
  { label: "1–30 days", from: 1, to: 30 },
  { label: "31–60 days", from: 31, to: 60 },
  { label: "61–90 days", from: 61, to: 90 },
  { label: "90+ days", from: 91, to: null as number | null },
] as const;

/** A-25: six months of silence on an account that still owes money. 183 days, admin-configurable. */
export const COLLECTIONS_DAYS = 183;

export interface AgingBucketRow {
  label: string;
  amount: number;
  transactions: number;
}

export interface PaymentAnalysis {
  /** Sum of positive TRANS_AMT (charges) and of |negative| (credits) over the whole history. */
  totalDebits: number;
  totalCredits: number;
  transactionCount: number;
  creditCount: number;
  lastCreditOn: string | null;
  daysSinceLastCredit: number | null;
  /** |credits where SOURCE_CDE = 'RC'| ÷ |all credits|. null when there are no credits (N/A, never 0%). */
  cashRatio: number | null;
  /** |credits where SOURCE_CDE = 'FA'| ÷ |all credits|. */
  financialAidRatio: number | null;
  aging: AgingBucketRow[];
  /** Unpaid debit remaining after credits are applied oldest-first. */
  outstanding: number;
  /**
   * The account balance this analysis was compared against (A-18) and the difference from the
   * transaction history. A non-zero difference is DISPLAYED, not hidden: the two figures come from
   * different systems and a silent mismatch is how a collections letter goes out for the wrong sum.
   */
  balance: number;
  reconciliationDifference: number;
  /** True only when there is money owed AND the last credit is older than COLLECTIONS_DAYS. */
  collectionsRecommended: boolean;
  /** Distinct from "last credit was long ago" — the account has never had a credit at all. */
  noCreditsOnFile: boolean;
}

export function analyzePayments(
  rows: TransactionRow[],
  accountBalance: number,
  opts: { today?: string; collectionsDays?: number } = {},
): PaymentAnalysis {
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const collectionsDays = opts.collectionsDays ?? COLLECTIONS_DAYS;
  const debits = rows.filter((r) => r.amount > 0);
  const credits = rows.filter((r) => r.amount < 0);

  const totalDebits = round2(debits.reduce((t, r) => t + r.amount, 0));
  const totalCredits = round2(credits.reduce((t, r) => t + Math.abs(r.amount), 0));

  const creditsBySource = (code: string) => round2(credits.filter((r) => norm(r.sourceCode) === code).reduce((t, r) => t + Math.abs(r.amount), 0));
  const ratio = (part: number) => (totalCredits === 0 ? null : round2((part / totalCredits) * 100));

  const lastCredit = credits.map((r) => r.postedOn).sort().at(-1) ?? null;
  const daysSinceLastCredit = lastCredit ? daysBetween(lastCredit, today) : null;

  const { aging, outstanding } = ageTheBalance(debits, totalCredits, today);

  return {
    totalDebits,
    totalCredits,
    transactionCount: rows.length,
    creditCount: credits.length,
    lastCreditOn: lastCredit,
    daysSinceLastCredit,
    cashRatio: ratio(creditsBySource("RC")),
    financialAidRatio: ratio(creditsBySource("FA")),
    aging,
    outstanding,
    balance: round2(accountBalance),
    reconciliationDifference: round2(accountBalance - (totalDebits - totalCredits)),
    collectionsRecommended: accountBalance > 0 && daysSinceLastCredit !== null && daysSinceLastCredit > collectionsDays,
    noCreditsOnFile: credits.length === 0,
  };
}

/**
 * Apply credits to the oldest charges first, then bucket whatever debit is still unpaid by its own
 * age. Oldest-first is the convention that makes "90+ days" mean an old unpaid charge rather than
 * an arithmetic artefact of a recent one.
 */
function ageTheBalance(debits: TransactionRow[], creditPool: number, today: string): { aging: AgingBucketRow[]; outstanding: number } {
  let pool = creditPool;
  const buckets: AgingBucketRow[] = DEFAULT_AGING_BUCKETS.map((b) => ({ label: b.label, amount: 0, transactions: 0 }));
  let outstanding = 0;

  for (const d of [...debits].sort((a, b) => a.postedOn.localeCompare(b.postedOn))) {
    const applied = Math.min(pool, d.amount);
    pool = round2(pool - applied);
    const unpaid = round2(d.amount - applied);
    if (unpaid <= 0) continue;
    outstanding = round2(outstanding + unpaid);
    const age = daysBetween(d.postedOn, today);
    const i = DEFAULT_AGING_BUCKETS.findIndex((b) => age >= b.from && (b.to === null || age <= b.to));
    const bucket = buckets[i === -1 ? 0 : i];
    bucket.amount = round2(bucket.amount + unpaid);
    bucket.transactions += 1;
  }
  return { aging: buckets, outstanding };
}

function norm(code: string | null | undefined): string {
  return (code ?? "").trim().toUpperCase();
}

function daysBetween(from: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
