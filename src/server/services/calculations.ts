/**
 * Pure calculation rules (Spec Appendix B, §6.3, §9.1, §15). No I/O, fully unit-tested.
 */

/**
 * Clearance percentage = cleared / enrolled * 100.
 * Returns null when enrolled is 0 so the UI can render "N/A" instead of a misleading 0 (App. B).
 */
export function clearancePercentage(cleared: number, enrolled: number): number | null {
  if (!Number.isFinite(cleared) || !Number.isFinite(enrolled) || enrolled <= 0) return null;
  return (cleared / enrolled) * 100;
}

/** Charges/credits delta = charges − expected credits (App. B). */
export function chargesCreditsDelta(charges: number, credits: number): number {
  return charges - credits;
}

export type DeltaTreatment = "neutral" | "positive" | "warning";

/**
 * Administrator-defined delta rule (Spec §6.3). Working rule:
 *   delta <= 0                      → positive (credits cover charges)
 *   delta / charges > warningRatio  → warning
 *   otherwise                       → neutral
 * The treatment is returned as a token; the UI pairs it with an icon and text, never color alone.
 */
export function deltaTreatment(charges: number, credits: number, warningRatio: number): DeltaTreatment {
  const delta = chargesCreditsDelta(charges, credits);
  if (delta <= 0) return "positive";
  if (charges > 0 && delta / charges > warningRatio) return "warning";
  return "neutral";
}

/**
 * Academic year for a semester code such as "FA2025" or "SP2026" (Spec §9.1):
 * Fall YYYY and the following Spring belong to "YYYY-YYYY+1".
 * Summer is grouped with the preceding academic year pending confirmation.
 */
export function academicYearForTerm(termCode: string): string | null {
  const m = /^(?:LEAP-)?(FA|SP|SU)(\d{4})$/i.exec(termCode.trim());
  if (!m) return null;
  const season = m[1].toUpperCase();
  const year = Number(m[2]);
  const start = season === "FA" ? year : year - 1;
  return `${start}-${start + 1}`;
}

/** Change between two snapshot values; null when the prior value is unknown. */
export function changeSincePrior(current: number, prior: number | null | undefined): number | null {
  if (prior === null || prior === undefined || !Number.isFinite(prior)) return null;
  return current - prior;
}

/**
 * Whether a refresh timestamp is stale relative to a threshold (Spec §19).
 */
export function isStale(capturedAt: Date, now: Date, staleAfterMinutes: number): boolean {
  return now.getTime() - capturedAt.getTime() > staleAfterMinutes * 60_000;
}
