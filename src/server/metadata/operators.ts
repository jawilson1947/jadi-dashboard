import type { OperatorProfileRecord } from "../store/types";

/**
 * Operator resolution for Cleared by (Spec §7.2; PLAN §4 OperatorProfile).
 *
 * Source codes come from VIEW_OURM_CLEARED.USER_NAME. Names are NEVER invented here: a code with no
 * admin-entered profile renders as "Unmapped (CODE)" and appears in Administration → Operators for
 * someone to name. The one built-in is `sa`, which is not a person but the automatic-clearance
 * account (Spec §10.5, FINDINGS §4).
 */
export const SYSTEM_OPERATOR_CODE = "sa";

export interface ResolvedOperator {
  code: string;
  displayName: string;
  /** Automatic clearance rather than a person. */
  isSystem: boolean;
  /** False when no profile covers this code on this date — the row belongs in the Unknown/Unmapped bucket. */
  mapped: boolean;
  email: string | null;
  department: string | null;
}

/** A profile applies when the action date falls inside [effectiveFrom, effectiveTo]; null bounds are open. */
export function coversDate(profile: OperatorProfileRecord, isoDate: string | null): boolean {
  if (!isoDate) return profile.effectiveFrom === null && profile.effectiveTo === null;
  if (profile.effectiveFrom !== null && isoDate < profile.effectiveFrom) return false;
  if (profile.effectiveTo !== null && isoDate > profile.effectiveTo) return false;
  return true;
}

/**
 * Resolve one ClearedBy code as of a date. Dated profiles win over open-ended ones, so re-assigning a
 * code to a new person does not retroactively rename last semester's clearance actions.
 */
export function resolveOperator(code: string | null | undefined, isoDate: string | null, profiles: OperatorProfileRecord[]): ResolvedOperator {
  const raw = (code ?? "").trim();
  if (!raw) return { code: "", displayName: "Unknown", isSystem: false, mapped: false, email: null, department: null };

  const candidates = profiles.filter((p) => p.sourceCode.toLowerCase() === raw.toLowerCase() && coversDate(p, isoDate));
  const hit = candidates.sort((a, b) => (b.effectiveFrom ?? "").localeCompare(a.effectiveFrom ?? ""))[0];
  if (hit) {
    return { code: raw, displayName: hit.displayName, isSystem: hit.isSystem, mapped: true, email: hit.email, department: hit.department };
  }
  if (raw.toLowerCase() === SYSTEM_OPERATOR_CODE) {
    return { code: raw, displayName: "Automatic clearance (sa)", isSystem: true, mapped: true, email: null, department: null };
  }
  return { code: raw, displayName: `Unmapped (${raw})`, isSystem: false, mapped: false, email: null, department: null };
}
