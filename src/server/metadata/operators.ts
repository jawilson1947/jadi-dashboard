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

/**
 * Why a code did or did not resolve. `no-profile` and `out-of-range` are both unmapped, but they are
 * different problems and must not wear the same label (J. Wilson, 2026-09-24): one needs a profile
 * created, the other has one whose effective dates exclude the actions in front of you.
 */
export type OperatorResolution = "mapped" | "system" | "no-profile" | "out-of-range" | "blank-code";

export interface OperatorRange {
  displayName: string;
  effectiveFrom: string | null;
  effectiveTo: string | null;
}

export interface ResolvedOperator {
  code: string;
  displayName: string;
  /** Automatic clearance rather than a person. */
  isSystem: boolean;
  /** False when no profile covers this code on this date — the row belongs in the Unknown/Unmapped bucket. */
  mapped: boolean;
  reason: OperatorResolution;
  /**
   * Populated only for `out-of-range`: the profiles that exist for this code but do not cover the
   * date, so the screen can say what the range actually is instead of "needs a profile".
   */
  ranges: OperatorRange[];
  email: string | null;
  department: string | null;
}

/** Human-readable effective range, for a message that has to explain why a profile did not apply. */
export function formatRange(r: OperatorRange): string {
  if (r.effectiveFrom && r.effectiveTo) return `${r.effectiveFrom} to ${r.effectiveTo}`;
  if (r.effectiveFrom) return `from ${r.effectiveFrom}`;
  if (r.effectiveTo) return `until ${r.effectiveTo}`;
  return "open-ended";
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
  if (!raw) return { code: "", displayName: "Unknown", isSystem: false, mapped: false, reason: "blank-code", ranges: [], email: null, department: null };

  const forCode = profiles.filter((p) => p.sourceCode.trim().toLowerCase() === raw.toLowerCase());
  const candidates = forCode.filter((p) => coversDate(p, isoDate));
  const hit = candidates.sort((a, b) => (b.effectiveFrom ?? "").localeCompare(a.effectiveFrom ?? ""))[0];
  if (hit) {
    return { code: raw, displayName: hit.displayName, isSystem: hit.isSystem, mapped: true, reason: "mapped", ranges: [], email: hit.email, department: hit.department };
  }
  if (raw.toLowerCase() === SYSTEM_OPERATOR_CODE) {
    return { code: raw, displayName: "Automatic clearance (sa)", isSystem: true, mapped: true, reason: "system", ranges: [], email: null, department: null };
  }
  // A profile exists for the code but not for this date. Saying "needs a profile" here sends an
  // administrator to create a duplicate; naming the range sends them to fix the one that is there.
  if (forCode.length > 0) {
    return {
      code: raw,
      displayName: `Outside profile dates (${raw})`,
      isSystem: false,
      mapped: false,
      reason: "out-of-range",
      ranges: forCode.map((p) => ({ displayName: p.displayName, effectiveFrom: p.effectiveFrom, effectiveTo: p.effectiveTo })),
      email: null,
      department: null,
    };
  }
  return { code: raw, displayName: `Unmapped (${raw})`, isSystem: false, mapped: false, reason: "no-profile", ranges: [], email: null, department: null };
}
