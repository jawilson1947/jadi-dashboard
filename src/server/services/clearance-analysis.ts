import { getDataProvider } from "../repositories";
import { getCurrentTerms } from "../metadata/terms";
import type { CostAnalysisRow, DataProvider, StudentKey, WorksheetItemRow } from "../repositories/types";
import { toIsoDate } from "@/lib/dates";
import { getConfig } from "../db/config";

/**
 * Financial Clearance Analysis and Status (Spec §10.4–10.5, Bio Spec cards 4 and 5).
 *
 * Authority (D-2, 2026-09-23): the institution's own `dbo.fn_CostAnalysis` decides what a student
 * must pay to clear. The Bio Spec's inline formula — AccountBalance + (net × 0.80) — is treated as a
 * paraphrase of it and is implemented HERE ONLY as a test oracle (`docFormulaNeeded`): the two are
 * compared in tests and any divergence on real data is reported as a validation defect for sign-off.
 * It is never rendered to a user, because two different "amount needed to clear" figures on one
 * screen is worse than one figure with a known provenance.
 */

export const CLEARANCE_THRESHOLD = 0.8;

/**
 * D-3 (2026-09-24, confirmed by Jim): `Sp_GetFCWorksheetItems` returns ABS(TRANS_AMT) — the amount
 * carries NO sign. The item-type column is the only thing that says which direction a row runs:
 * 'Credit' reduces what the student owes, 'Debit' increases it. The sign is therefore applied here,
 * never inferred from the number.
 */
export type WorksheetDirection = "credit" | "debit";

/**
 * Normalise the procedure's item-type value. Only a value that reads as a credit is treated as one;
 * anything else — 'Debit', an unexpected spelling, a missing column — counts as a debit, so a value
 * this app does not recognise can never quietly turn a charge into a credit.
 */
export function itemDirection(item: Pick<WorksheetItemRow, "itemType">): WorksheetDirection {
  return (item.itemType ?? "").trim().toLowerCase().startsWith("cr") ? "credit" : "debit";
}

/** What the card prints in the Type column: the institution's two categories, title-cased. */
export function itemTypeLabel(item: Pick<WorksheetItemRow, "itemType">): string {
  return itemDirection(item) === "credit" ? "Credit" : "Debit";
}

/** The amount a row contributes to the net: credits negative, debits positive, magnitude only. */
export function signedItemAmount(item: Pick<WorksheetItemRow, "itemType" | "amount">): number {
  const magnitude = Math.abs(item.amount);
  return itemDirection(item) === "credit" ? -magnitude : magnitude;
}

/** Debit and credit subtotals and the net they produce (Bio Spec 1.5.2). */
export interface WorksheetTotals {
  debitCount: number;
  creditCount: number;
  /** Sum of the debit magnitudes — positive. */
  debits: number;
  /** Sum of the credit magnitudes — positive, and subtracted to reach the net. */
  credits: number;
  /** debits − credits. */
  net: number;
}

export function worksheetTotals(items: WorksheetItemRow[]): WorksheetTotals {
  let debits = 0;
  let credits = 0;
  let debitCount = 0;
  let creditCount = 0;
  for (const r of items) {
    const magnitude = Math.abs(r.amount);
    if (itemDirection(r) === "credit") {
      credits += magnitude;
      creditCount += 1;
    } else {
      debits += magnitude;
      debitCount += 1;
    }
  }
  return { debitCount, creditCount, debits: round2(debits), credits: round2(credits), net: round2(debits - credits) };
}

export class NotCurrentTermError extends Error {
  constructor(public readonly lastCleared: string | null) {
    super("Financial clearance analysis is available for current enrollees only.");
    this.name = "NotCurrentTermError";
  }
}

export interface ClearanceAnalysis {
  idnumber: StudentKey;
  /** Bio Spec 1.5.2 — debits less credits across the worksheet recordset (D-3). */
  worksheetNetAmount: number;
  /** Bio Spec 1.5.3 — AccountBalance (A-18) + the net amount. */
  totalMoniesDue: number;
  accountBalance: number;
  items: WorksheetItemRow[];
  /** Debit and credit subtotals; `totals.net` is `worksheetNetAmount`. */
  totals: WorksheetTotals;
  /**
   * 80% of the worksheet NET (debits − credits) — "80% of current charges" on the card.
   * Negative when credits exceed debits; the floor is applied to the amount owed, not to this.
   */
  eightyPercentOfCharges: number;
  /**
   * AccountBalance + 80% of the net, floored at zero: a student whose credits and balance more than
   * cover the 80% owes nothing to clear, and a negative figure there would read as a refund the
   * clearance desk cannot make. Computed from the worksheet's own rows so it can be checked against
   * the table beneath it — distinct from `costAnalysis.needed`, which fn_CostAnalysis derives from
   * VIEW_OURM_CHARGES / _CREDITS.
   */
  amountNeededToClearComputed: number;
  /** From fn_CostAnalysis (D-2); null when the function returns no row for this student. */
  costAnalysis: CostAnalysisRow | null;
  /**
   * What the student must pay. `needed` from fn_CostAnalysis. Null when the net amount is negative
   * (Bio Spec 1.5.5 "if netamount < 0 then exit") or when the function has no row — in which case
   * the card says so rather than showing a zero that reads as "nothing to pay".
   */
  amountNeededToClear: number | null;
  /** Why `amountNeededToClear` is null, for the card's wording. */
  status: "ok" | "no-amount-outstanding" | "cost-analysis-unavailable";
  dropClassesDate: string | null;
}

/** The Bio Spec's literal formula (1.5.5). Test oracle only — never rendered (D-2). */
export function docFormulaNeeded(accountBalance: number, netAmount: number): number | null {
  if (netAmount < 0) return null;
  return round2(accountBalance + netAmount * CLEARANCE_THRESHOLD);
}

/**
 * Bio Spec 1.4.4 — the eligibility gate. A student whose record has not been rolled to the current
 * semester gets a plain notice, not an empty analysis. Per A-16, a term's Traditional and LEAP
 * identifiers name the same semester, so the gate never distinguishes them.
 */
export function isEligible(lastCleared: string | null, currentKeys: string[]): boolean {
  return lastCleared !== null && currentKeys.includes(lastCleared);
}

export async function getClearanceAnalysis(
  id: StudentKey,
  provider: DataProvider = getDataProvider(),
): Promise<ClearanceAnalysis> {
  const bio = await provider.getStudentBio(id);
  if (!bio) throw new NotCurrentTermError(null);
  const terms = await getCurrentTerms(undefined, provider);
  if (!isEligible(bio.lastCleared, terms.currentKeys)) throw new NotCurrentTermError(bio.lastCleared);

  // The drop date comes from tblOUSA's current row (A-20) — never from the client.
  const dropClassesDate = terms.current.dropClassesDate ? toIsoDate(terms.current.dropClassesDate, getConfig().APP_TIMEZONE) : null;
  const [items, costAnalysis] = await Promise.all([
    dropClassesDate ? provider.getClearanceWorksheetItems(id, dropClassesDate) : Promise.resolve([] as WorksheetItemRow[]),
    provider.getCostAnalysis(id),
  ]);

  const totals = worksheetTotals(items);
  const worksheetNetAmount = totals.net;
  const totalMoniesDue = round2(bio.accountBalance + worksheetNetAmount);
  const eightyPercentOfCharges = round2(worksheetNetAmount * CLEARANCE_THRESHOLD);
  const amountNeededToClearComputed = Math.max(0, round2(bio.accountBalance + eightyPercentOfCharges));

  let status: ClearanceAnalysis["status"] = "ok";
  let amountNeededToClear: number | null = null;
  if (worksheetNetAmount < 0) status = "no-amount-outstanding";
  else if (!costAnalysis) status = "cost-analysis-unavailable";
  else amountNeededToClear = round2(costAnalysis.needed);

  return {
    idnumber: id,
    worksheetNetAmount,
    totalMoniesDue,
    accountBalance: bio.accountBalance,
    items,
    totals,
    eightyPercentOfCharges,
    amountNeededToClearComputed,
    costAnalysis,
    amountNeededToClear,
    status,
    dropClassesDate,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
