import { describe, expect, it } from "vitest";
import { COLLECTIONS_DAYS, analyzePayments } from "@/server/services/payment-analysis";
import type { TransactionRow } from "@/server/repositories/types";

const tx = (postedOn: string, amount: number, sourceCode: string, description = "row"): TransactionRow => ({ postedOn, amount, sourceCode, description });
const TODAY = "2026-09-23";

describe("payment analysis (Spec §10.3, Bio Spec card 3; A-25)", () => {
  it("separates debits from credits and never nets them into one figure", () => {
    const a = analyzePayments([tx("2026-01-10", 5000, "CG"), tx("2026-02-01", -2000, "FA"), tx("2026-03-01", -500, "RC")], 2500, { today: TODAY });
    expect(a.totalDebits).toBe(5000);
    expect(a.totalCredits).toBe(2500);
    expect(a.transactionCount).toBe(3);
  });

  it("reports ratios as N/A rather than 0% when there are no credits to divide by", () => {
    const a = analyzePayments([tx("2026-01-10", 5000, "CG")], 5000, { today: TODAY });
    expect(a.cashRatio).toBeNull();
    expect(a.financialAidRatio).toBeNull();
    expect(a.noCreditsOnFile).toBe(true);
  });

  it("computes the cash and aid share of credits, not of all transactions", () => {
    const a = analyzePayments([tx("2026-01-10", 4000, "CG"), tx("2026-02-01", -3000, "FA"), tx("2026-02-02", -1000, "RC")], 0, { today: TODAY });
    expect(a.financialAidRatio).toBe(75);
    expect(a.cashRatio).toBe(25);
  });

  it("ages the balance by applying credits to the oldest charges first", () => {
    // Two charges, one old and one recent; the credit clears the old one entirely.
    const a = analyzePayments([tx("2025-01-01", 1000, "CG"), tx("2026-09-20", 400, "CG"), tx("2026-01-05", -1000, "RC")], 400, { today: TODAY });
    expect(a.outstanding).toBe(400);
    const buckets = Object.fromEntries(a.aging.map((b) => [b.label, b.amount]));
    expect(buckets["90+ days"]).toBe(0);
    expect(buckets["1–30 days"]).toBe(400);
  });

  it("flags collections only when money is owed AND the last credit is older than six months", () => {
    const stale = analyzePayments([tx("2025-01-01", 2000, "CG"), tx("2025-02-01", -100, "RC")], 1900, { today: TODAY });
    expect(stale.daysSinceLastCredit).toBeGreaterThan(COLLECTIONS_DAYS);
    expect(stale.collectionsRecommended).toBe(true);

    const recent = analyzePayments([tx("2025-01-01", 2000, "CG"), tx("2026-09-01", -100, "RC")], 1900, { today: TODAY });
    expect(recent.collectionsRecommended).toBe(false);

    const paidUp = analyzePayments([tx("2025-01-01", 2000, "CG"), tx("2025-02-01", -2000, "RC")], 0, { today: TODAY });
    expect(paidUp.collectionsRecommended).toBe(false);
  });

  it("distinguishes 'no credits on file' from 'the last credit was long ago'", () => {
    const never = analyzePayments([tx("2025-01-01", 2000, "CG")], 2000, { today: TODAY });
    expect(never.noCreditsOnFile).toBe(true);
    expect(never.daysSinceLastCredit).toBeNull();
    // With no payment date there is nothing to age against, so the cue does not fire on its own.
    expect(never.collectionsRecommended).toBe(false);
  });

  it("shows the difference from the authoritative balance instead of hiding it (A-18)", () => {
    const a = analyzePayments([tx("2026-01-10", 1000, "CG")], 1250, { today: TODAY });
    expect(a.reconciliationDifference).toBe(250);
    const matched = analyzePayments([tx("2026-01-10", 1000, "CG")], 1000, { today: TODAY });
    expect(matched.reconciliationDifference).toBe(0);
  });
});
