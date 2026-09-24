import { getDataProvider } from "../repositories";
import type { DataProvider, StudentBio, StudentSearchQuery, StudentSearchRow, StudentSearchState, StudentKey } from "../repositories/types";
import { getCurrentTerms } from "../metadata/terms";
import { classificationDisplayName } from "../metadata/classifications";
import { buildSemesterIndex, semesterLabel } from "../metadata/semesters";
import { maskDob, maskPid } from "@/lib/format";
export { escapeLike } from "@/lib/search";
import type { Principal } from "../authz/permissions";
import { hasPermission } from "../authz/permissions";

/**
 * Student Lookup and Profile (Spec §10.1–10.2, Bio Spec cards 1).
 *
 * Two responsibilities live here and nowhere else:
 *   1. SEARCH GUARDS — minimum lengths, digits-only IDs, and escaping of LIKE metacharacters, so no
 *      provider can be handed a pattern that matches the whole table (Spec §10.1).
 *   2. MASKING — dob and pid are masked here, before the data leaves the server, so an unprivileged
 *      response never carries the real value at all (A-3, A-29). A component cannot be trusted to be
 *      the only renderer of a field.
 */

export const NAME_MIN_LENGTH = 2;
export const SEARCH_LIMIT = 200;

/** Rows per page on the Student Lookup results table, and the sizes a user may choose instead. */
export const PAGE_SIZE_DEFAULT = 10;
export const PAGE_SIZE_OPTIONS = [10, 25, 50] as const;

export class SearchInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SearchInputError";
  }
}

export interface SearchInput {
  by: "name" | "id";
  lastName?: string;
  firstName?: string;
  idnumber?: string;
  limit?: number;
  /** 1-based page number. Ignored unless `pageSize` is given; clamped to the last page that exists. */
  page?: number;
  /** Rows per page. Omit to receive the whole (capped) result set — callers that want every match,
   *  such as the masking sweep in the integration tests, must not be silently handed ten rows. */
  pageSize?: number;
}

/**
 * Validate and normalise the search terms. Rejects anything that would match everything: an empty
 * last name, one character, or a bare wildcard. The rejection is a message for the user, not a 500.
 */
export function buildSearchQuery(input: SearchInput): StudentSearchQuery {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), SEARCH_LIMIT);
  if (input.by === "id") {
    const id = (input.idnumber ?? "").trim();
    if (!/^\d{2,}$/.test(id)) throw new SearchInputError("Enter at least two digits of a student ID. IDs are numeric.");
    return { by: "id", idnumber: id, limit };
  }
  const last = (input.lastName ?? "").trim();
  const first = (input.firstName ?? "").trim();
  if (last.length < NAME_MIN_LENGTH) {
    throw new SearchInputError(`Enter at least ${NAME_MIN_LENGTH} characters of a last name.`);
  }
  if (/^[%_*]+$/.test(last)) throw new SearchInputError("A wildcard on its own would match every student. Enter part of a name.");
  // Raw, validated terms: the provider decides how to match them (LIKE for SQL, includes() for the
  // mock). Wrapping them in % here would make the query shape a SQL detail leaking through the seam.
  return { by: "name", lastName: last, firstName: first.length > 0 ? first : undefined, limit };
}

/**
 * The clearance rule, in one place (J. Wilson, 2026-09-24).
 *
 * `tblStudent.ClearedCurrentSession` is a flag on the `LastCleared` term despite its name: it says
 * the student was cleared for THAT semester, which is only the current one while their record sits
 * in the current term. So a flag of 1 against an older `LastCleared` is a past clearance, not a
 * present one, and the two must never render the same way.
 */
export function clearanceState(row: { clearedCurrentSession: boolean; enrolledCurrentTerm: boolean; lastCleared: string | null }, currentTermKeys: readonly string[]): StudentSearchState {
  if (!row.enrolledCurrentTerm) return "not-enrolled";
  if (!row.clearedCurrentSession) return "not-cleared";
  const recordIsCurrent = row.lastCleared !== null && currentTermKeys.includes(row.lastCleared);
  return recordIsCurrent ? "cleared" : "cleared-prior";
}

export interface StudentSearchResultRow extends StudentSearchRow {
  /** Resolved classification name for display (A-19 rules live in one place). */
  classification: string;
  /** Semester label for lastCleared, or "No semester on record" for the XX0000 sentinel (A-22). */
  lastClearedLabel: string;
  /** Derived here, not in the provider: the rule needs the current term. */
  state: StudentSearchState;
  /** True when `lastCleared` is the current term — what makes the flag mean "cleared now". */
  currentTermRecord: boolean;
}

export interface StudentSearchResult {
  /** The requested page of matches, or every match when the caller asked for no page size. */
  rows: StudentSearchResultRow[];
  /** Matches the provider returned, before slicing — what the pager counts and the page reports. */
  totalRows: number;
  /** The page actually served: an out-of-range request lands on the last page, never on nothing. */
  page: number;
  pageSize: number;
  pageCount: number;
  /** True when the provider returned exactly `limit` rows — there may be more (Spec §10.1). */
  truncated: boolean;
  limit: number;
}

/**
 * Run the search and hand back one page of it.
 *
 * Paging is applied here rather than in SQL on purpose: the search is already bounded at
 * `SEARCH_LIMIT` by one round trip, so slicing that bounded set costs nothing, keeps the honest
 * "first 200 matches" warning meaning what it always meant, and leaves `truncated` about the query
 * being too broad rather than about the page being full. `totalRows` is therefore the number of
 * matches *fetched*, which is the whole population unless `truncated` is true and says otherwise.
 */
export async function searchStudents(input: SearchInput, provider: DataProvider = getDataProvider()): Promise<StudentSearchResult> {
  const query = buildSearchQuery(input);
  const rows = await provider.searchStudents(query);
  const terms = await getCurrentTerms(undefined, provider);
  const index = buildSemesterIndex(terms.all);
  const all = rows.map((r) => ({
    ...r,
    classification: classificationDisplayName(r.classificationCode).displayName,
    lastClearedLabel: semesterLabel(r.lastCleared, index),
    state: clearanceState(r, terms.currentKeys),
    currentTermRecord: r.lastCleared !== null && terms.currentKeys.includes(r.lastCleared),
  }));

  const pageSize = input.pageSize === undefined ? all.length : Math.max(1, Math.trunc(input.pageSize));
  const pageCount = Math.max(1, Math.ceil(all.length / Math.max(1, pageSize)));
  const page = Math.min(Math.max(Math.trunc(input.page ?? 1), 1), pageCount);
  const paged = input.pageSize === undefined ? all : all.slice((page - 1) * pageSize, page * pageSize);

  return {
    rows: paged,
    totalRows: all.length,
    page,
    pageSize,
    pageCount,
    truncated: rows.length >= query.limit,
    limit: query.limit,
  };
}

/** What the profile page renders. `dob` and `pid` are already display strings — masked or not. */
export interface StudentProfile extends Omit<StudentBio, "dob" | "pid"> {
  classification: string;
  lastClearedLabel: string;
  /** Display string: the full date for student.pii.view holders, otherwise the birth year (A-29). */
  dob: string;
  /** True when the value above is the real one; drives the "revealed" state and its audit row. */
  dobRevealed: boolean;
  /** Masked to its last four characters unless student.pid.view (A-3). */
  pid: string;
  pidRevealed: boolean;
  /** Whether the student's record is rolled to the current semester (Bio Spec 1.4.4 eligibility). */
  currentTermRecord: boolean;
  /** Derived here, not in the provider: the rule needs the current term. */
  state: StudentSearchState;
}

/**
 * The bio card. Masking is applied according to the caller's permissions, and the unmasked value is
 * dropped from the object entirely rather than carried alongside a flag — what is not in the payload
 * cannot leak from it.
 */
export async function getStudentProfile(
  id: StudentKey,
  principal: Principal,
  opts: { revealDob?: boolean } = {},
  provider: DataProvider = getDataProvider(),
): Promise<StudentProfile | null> {
  const bio = await provider.getStudentBio(id);
  if (!bio) return null;
  const terms = await getCurrentTerms(undefined, provider);
  const index = buildSemesterIndex(terms.all);
  const maySeeDob = hasPermission(principal, "student.pii.view") && opts.revealDob === true;
  const maySeePid = hasPermission(principal, "student.pid.view");
  return {
    ...bio,
    dob: maySeeDob ? (bio.dob ?? "—") : maskDob(bio.dob),
    dobRevealed: maySeeDob,
    pid: maySeePid ? bio.pid : maskPid(bio.pid),
    pidRevealed: maySeePid,
    classification: classificationDisplayName(bio.classificationCode).displayName,
    lastClearedLabel: semesterLabel(bio.lastCleared, index),
    currentTermRecord: bio.lastCleared !== null && terms.currentKeys.includes(bio.lastCleared),
    state: clearanceState(bio, terms.currentKeys),
  };
}
