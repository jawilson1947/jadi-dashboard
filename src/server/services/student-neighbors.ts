import { rowAnchorId } from "@/lib/return-to";
import { PAGE_SIZE_DEFAULT, PAGE_SIZE_OPTIONS, SearchInputError, searchStudents } from "./students";

/** One step away from the student being viewed — the link and who is on the other end of it. */
export interface StudentStep {
  idnumber: string;
  /** Shown in the control's title so a step is a considered move, not a blind one. */
  name: string;
  href: string;
}

export interface StudentNeighbors {
  /** 1-based position of the current student in the whole match set. */
  position: number;
  total: number;
  prev: StudentStep | null;
  next: StudentStep | null;
}

const blank = (v: string | null): string | undefined => (v === null || v.trim() === "" ? undefined : v);

/**
 * Previous/Next across a Student Lookup result set (Bio Spec 1.1).
 *
 * The result card's URL is the only state there is, so the neighbours are recovered by re-running
 * the same search rather than by smuggling a row list through the query string. searchStudents
 * pages in memory over one bounded round trip, so asking for the whole match set costs the same as
 * asking for a page — and it makes stepping across a page boundary ordinary rather than special.
 *
 * Not audited: it renders no result set, only two adjacent IDs, from a search the user already ran
 * and which was audited then. The profile each step opens is audited on arrival, as always.
 *
 * Returns null whenever the neighbours cannot be trusted — the search no longer validates, or the
 * student is no longer in it because the data moved underneath. The profile then renders without
 * the control instead of offering a step to the wrong record.
 */
export async function getStudentNeighbors(returnTo: string, currentId: string, tab: string): Promise<StudentNeighbors | null> {
  const params = new URL(returnTo, "http://student-neighbors.invalid").searchParams;
  const by = params.get("by") === "id" ? "id" : "name";
  const lastName = blank(params.get("last"));
  const firstName = blank(params.get("first"));
  const idnumber = blank(params.get("id"));

  // Page size decides which page each neighbour sits on, so the return link stays consistent with
  // the list the user left. Anything unrecognised falls back rather than inventing a page size.
  const requested = Number(params.get("pageSize"));
  const pageSize = (PAGE_SIZE_OPTIONS as readonly number[]).includes(requested) ? requested : PAGE_SIZE_DEFAULT;

  let rows;
  try {
    // No pageSize: every match, in the provider's order — the same order the list showed.
    rows = (await searchStudents({ by, lastName, firstName, idnumber })).rows;
  } catch (err) {
    if (err instanceof SearchInputError) return null;
    throw err;
  }

  const index = rows.findIndex((r) => r.idnumber === currentId);
  if (index === -1) return null;

  const terms = new URLSearchParams({ by });
  for (const [key, value] of Object.entries({ last: lastName, first: firstName, id: idnumber })) {
    if (value !== undefined) terms.set(key, value);
  }

  const step = (at: number): StudentStep | null => {
    const row = rows[at];
    if (!row) return null;
    const page = Math.floor(at / pageSize) + 1;
    const from = `/students?${terms.toString()}&page=${page}&pageSize=${pageSize}&sel=${encodeURIComponent(row.idnumber)}#${rowAnchorId(row.idnumber)}`;
    return {
      idnumber: row.idnumber,
      name: `${row.firstName} ${row.lastName}`.trim() || row.idnumber,
      href: `/students/${encodeURIComponent(row.idnumber)}?tab=${tab}&from=${encodeURIComponent(from)}`,
    };
  };

  return { position: index + 1, total: rows.length, prev: step(index - 1), next: step(index + 1) };
}
