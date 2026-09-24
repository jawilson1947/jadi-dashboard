import type { TermKey, TermMetadata } from "../repositories/types";
import { academicYearOf } from "./terms";

/**
 * Semester resolver (ASSUMPTIONS A-22, decided 2026-09-18).
 *
 * `tblStudent.LastCleared` carries a term code that matches `tblOUSA.JADI_TradName` or
 * `JADI_LeapName` on ANY row — not only the current/previous pair the dashboard uses. Resolving it
 * gives that semester's whole metadata, which is what Historical Analysis (§9.3), the DNR/DNC
 * "last cleared" column (§8) and the student profile (§10) all need.
 *
 * Two codes never resolve, and both are reported rather than dropped:
 *   - `XX0000`, the never-cleared sentinel (19,803 rows on staging — FINDINGS §3);
 *   - anything else with no matching row, which means the metadata table and the student table
 *     have drifted apart and someone should know.
 */

/** The sentinel written when a student has never been cleared. */
export const NEVER_CLEARED = "XX0000";

export interface ResolvedSemester {
  matched: true;
  /** The identifier that matched — Traditional or LEAP. */
  termKey: TermKey;
  /**
   * The semester itself, identified by its Traditional key. Both identifiers of a row resolve to the
   * same value, so a caller that wants one row per semester (rather than one per programme) groups
   * on this and the LEAP codes fold into their Fall/Spring row.
   */
  semesterKey: TermKey;
  semesterName: string;
  academicYear: string;
  /** Which identifier matched: the Traditional or the LEAP name of the row (A-16). */
  program: "TRADITIONAL" | "LEAP";
  isCurrent: boolean;
  isPrevious: boolean;
  /** Summer terms are omitted from historical analysis (A-23) but still resolve. */
  isSummer: boolean;
  semesterBegins: Date;
  semesterEnds: Date;
  dropClassesDate: Date | null;
  /** Nightly figures — the official historical numbers (A-2). Null when never captured. */
  census: number | null;
  financiallyCleared: number | null;
}

export interface UnresolvedSemester {
  matched: false;
  termKey: TermKey;
  reason: "never-cleared" | "unknown";
}

export type SemesterLookup = ResolvedSemester | UnresolvedSemester;

/** Summer terms are `SU####` (Traditional) / `SL####` (LEAP), and their row is named "Summer …". */
export function isSummerTerm(term: TermMetadata): boolean {
  return term.semesterName.trim().toLowerCase().startsWith("summer") || /^S[UL]\d{4}$/i.test(term.tradName);
}

export function isSummerCode(code: string | null | undefined): boolean {
  return /^S[UL]\d{4}$/i.test((code ?? "").trim());
}

/** One entry per term code — both the Traditional and the LEAP name of every row. */
export function buildSemesterIndex(terms: TermMetadata[]): Map<string, ResolvedSemester> {
  const index = new Map<string, ResolvedSemester>();
  for (const t of terms) {
    const base = {
      matched: true as const,
      semesterName: t.semesterName,
      academicYear: academicYearOf(t),
      isCurrent: t.isCurrent,
      isPrevious: t.wasCurrent,
      isSummer: isSummerTerm(t),
      semesterBegins: t.semesterBegins,
      semesterEnds: t.semesterEnds,
      dropClassesDate: t.dropClassesDate,
      census: t.census,
      financiallyCleared: t.financiallyCleared,
    };
    if (t.tradName) index.set(key(t.tradName), { ...base, termKey: t.tradName, semesterKey: t.tradName, program: "TRADITIONAL" });
    // A row carries both names; the LEAP entry must not overwrite the Traditional one, but it points
    // at the same semester.
    if (t.leapName && key(t.leapName) !== key(t.tradName)) index.set(key(t.leapName), { ...base, termKey: t.leapName, semesterKey: t.tradName, program: "LEAP" });
  }
  return index;
}

export function resolveSemester(code: string | null | undefined, index: Map<string, ResolvedSemester>): SemesterLookup {
  const raw = (code ?? "").trim();
  if (!raw || raw.toUpperCase() === NEVER_CLEARED) return { matched: false, termKey: raw || NEVER_CLEARED, reason: "never-cleared" };
  const hit = index.get(key(raw));
  return hit ?? { matched: false, termKey: raw, reason: "unknown" };
}

/**
 * Display form for any term code: the semester name when it resolves, the code itself when it does not.
 * The Traditional/LEAP programme is deliberately NOT shown (J. Wilson, 2026-09-18): a term's two
 * identifiers name one semester, and LEAP is only a distinction where student classifications are
 * broken out — where it appears as the classification `AE`, not as a property of the term.
 */
export function semesterLabel(code: string | null | undefined, index: Map<string, ResolvedSemester>): string {
  if (!code) return "—";
  const r = resolveSemester(code, index);
  if (r.matched) return r.semesterName;
  // XX0000 means no term of record at all — not "was never cleared", which the column name invites
  // (J. Wilson, 2026-09-24). Clearance is the ClearedCurrentSession flag, never this code alone.
  return r.reason === "never-cleared" ? "No semester on record" : `${r.termKey} (unknown term)`;
}

function key(code: string): string {
  return code.trim().toUpperCase();
}
