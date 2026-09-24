import { describe, expect, it } from "vitest";
import { MockDataProvider } from "@/server/repositories/mock/provider";
import { PAGE_SIZE_DEFAULT, SearchInputError, buildSearchQuery, clearanceState, escapeLike, getStudentProfile, searchStudents } from "@/server/services/students";
import type { Principal } from "@/server/authz/permissions";

const provider = new MockDataProvider();

const principal = (extra: Principal["extraPermissions"] = []): Principal => ({
  userId: "u-1",
  displayName: "Test User",
  email: "t@example.edu",
  roles: ["VIEWER"],
  extraPermissions: ["student.view", ...extra],
});

describe("student search guards (Spec §10.1, Bio Spec 1.1–1.2)", () => {
  it("refuses a search that would match the whole student body", () => {
    expect(() => buildSearchQuery({ by: "name", lastName: "" })).toThrow(SearchInputError);
    expect(() => buildSearchQuery({ by: "name", lastName: "a" })).toThrow(SearchInputError);
    expect(() => buildSearchQuery({ by: "name", lastName: "%" })).toThrow(SearchInputError);
    expect(() => buildSearchQuery({ by: "name", lastName: "%%%" })).toThrow(SearchInputError);
  });

  it("requires a numeric ID of at least two digits", () => {
    expect(() => buildSearchQuery({ by: "id", idnumber: "1" })).toThrow(SearchInputError);
    expect(() => buildSearchQuery({ by: "id", idnumber: "abc" })).toThrow(SearchInputError);
    expect(() => buildSearchQuery({ by: "id", idnumber: "10' OR 1=1--" })).toThrow(SearchInputError);
    expect(buildSearchQuery({ by: "id", idnumber: "176941" }).idnumber).toBe("176941");
  });

  it("escapes LIKE metacharacters so a name is matched literally", () => {
    expect(escapeLike("100%")).toBe("100\\%");
    expect(escapeLike("a_b")).toBe("a\\_b");
    expect(escapeLike("[abc]")).toBe("\\[abc\\]");
    // The query carries the validated term; the provider that speaks SQL builds and escapes the pattern.
    expect(buildSearchQuery({ by: "name", lastName: " Smith " }).lastName).toBe("Smith");
  });

  it("caps the result set however large a limit is asked for", () => {
    expect(buildSearchQuery({ by: "name", lastName: "smith", limit: 10_000 }).limit).toBe(200);
  });

  it("finds students by partial last name and reports truncation honestly", async () => {
    const result = await searchStudents({ by: "name", lastName: "an" }, provider);
    expect(result.rows.length).toBeGreaterThan(0);
    expect(result.rows.every((r) => r.lastName.toLowerCase().includes("an"))).toBe(true);
    expect(result.truncated).toBe(result.totalRows >= result.limit);
  });

  it("returns every match when no page size is asked for, so an unpaged caller is not quietly cut off", async () => {
    const result = await searchStudents({ by: "name", lastName: "an" }, provider);
    expect(result.rows.length).toBe(result.totalRows);
    expect(result.page).toBe(1);
    expect(result.pageCount).toBe(1);
  });
});

describe("the clearance flag belongs to the LastCleared term, not to today (2026-09-24)", () => {
  const CURRENT = ["FA2026", "FL2026"];
  const base = { enrolledCurrentTerm: true, clearedCurrentSession: true, lastCleared: "FA2026" };

  it("calls a student cleared only when the flag is set AND the record sits in the current term", () => {
    expect(clearanceState(base, CURRENT)).toBe("cleared");
    expect(clearanceState({ ...base, lastCleared: "FL2026" }, CURRENT)).toBe("cleared");
  });

  it("does not let a flag against an older semester claim the current one", () => {
    expect(clearanceState({ ...base, lastCleared: "SP2026" }, CURRENT)).toBe("cleared-prior");
  });

  it("treats the no-term sentinel as a past clearance at best, never a current one", () => {
    expect(clearanceState({ ...base, lastCleared: "XX0000" }, CURRENT)).toBe("cleared-prior");
    expect(clearanceState({ ...base, lastCleared: null }, CURRENT)).toBe("cleared-prior");
  });

  it("keeps an unset flag and a missing enrollment as they were", () => {
    expect(clearanceState({ ...base, clearedCurrentSession: false }, CURRENT)).toBe("not-cleared");
    expect(clearanceState({ ...base, enrolledCurrentTerm: false }, CURRENT)).toBe("not-enrolled");
    expect(clearanceState({ lastCleared: "SP2026", clearedCurrentSession: true, enrolledCurrentTerm: false }, CURRENT)).toBe("not-enrolled");
  });

  it("derives the state on every search row rather than leaving it to the provider", async () => {
    const result = await searchStudents({ by: "name", lastName: "an" }, provider);
    for (const row of result.rows) {
      expect(row.state).toBe(clearanceState(row, row.currentTermRecord ? [row.lastCleared!] : []));
      if (row.state === "cleared") expect(row.currentTermRecord).toBe(true);
    }
  });
});

describe("paged search results (10 per page)", () => {
  it("serves one page of the matches while counting all of them", async () => {
    const all = await searchStudents({ by: "name", lastName: "an" }, provider);
    const first = await searchStudents({ by: "name", lastName: "an", pageSize: PAGE_SIZE_DEFAULT }, provider);

    expect(PAGE_SIZE_DEFAULT).toBe(10);
    expect(first.totalRows).toBe(all.totalRows);
    expect(first.rows.length).toBe(Math.min(PAGE_SIZE_DEFAULT, all.totalRows));
    expect(first.rows.map((r) => r.idnumber)).toEqual(all.rows.slice(0, PAGE_SIZE_DEFAULT).map((r) => r.idnumber));
    expect(first.pageCount).toBe(Math.max(1, Math.ceil(all.totalRows / PAGE_SIZE_DEFAULT)));
  });

  it("walks the pages without repeating or dropping a student", async () => {
    const all = await searchStudents({ by: "name", lastName: "an" }, provider);
    const seen: string[] = [];
    const pageCount = Math.max(1, Math.ceil(all.totalRows / PAGE_SIZE_DEFAULT));
    for (let page = 1; page <= pageCount; page++) {
      const p = await searchStudents({ by: "name", lastName: "an", page, pageSize: PAGE_SIZE_DEFAULT }, provider);
      expect(p.page).toBe(page);
      expect(p.rows.length).toBeLessThanOrEqual(PAGE_SIZE_DEFAULT);
      seen.push(...p.rows.map((r) => r.idnumber));
    }
    expect(seen).toEqual(all.rows.map((r) => r.idnumber));
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("lands on the last page rather than on nothing when the page number runs past the end", async () => {
    const all = await searchStudents({ by: "name", lastName: "an", pageSize: PAGE_SIZE_DEFAULT }, provider);
    const far = await searchStudents({ by: "name", lastName: "an", page: 9_999, pageSize: PAGE_SIZE_DEFAULT }, provider);
    expect(far.page).toBe(all.pageCount);
    expect(far.rows.length).toBeGreaterThan(0);
  });

  it("reports one empty page rather than zero pages when nothing matches", async () => {
    const none = await searchStudents({ by: "name", lastName: "zzqx", pageSize: PAGE_SIZE_DEFAULT }, provider);
    expect(none.totalRows).toBe(0);
    expect(none.rows).toEqual([]);
    expect(none.page).toBe(1);
    expect(none.pageCount).toBe(1);
  });
});

describe("masking happens on the server, not in the component (A-3, A-29)", () => {
  it("never puts an unmasked date of birth in a payload the caller is not entitled to", async () => {
    const all = await searchStudents({ by: "name", lastName: "an" }, provider);
    const id = all.rows[0].idnumber;
    const raw = await provider.getStudentBio(id);
    expect(raw?.dob).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const plain = await getStudentProfile(id, principal(), { revealDob: true }, provider);
    expect(plain!.dobRevealed).toBe(false);
    expect(JSON.stringify(plain)).not.toContain(raw!.dob!);
    expect(plain!.dob).toBe(`${raw!.dob!.slice(0, 4)} (year only)`);
  });

  it("reveals the full date only when the permission is held AND the reveal is asked for", async () => {
    const all = await searchStudents({ by: "name", lastName: "an" }, provider);
    const id = all.rows[0].idnumber;
    const raw = await provider.getStudentBio(id);

    const notAsked = await getStudentProfile(id, principal(["student.pii.view"]), {}, provider);
    expect(notAsked!.dobRevealed).toBe(false);
    expect(JSON.stringify(notAsked)).not.toContain(raw!.dob!);

    const asked = await getStudentProfile(id, principal(["student.pii.view"]), { revealDob: true }, provider);
    expect(asked!.dobRevealed).toBe(true);
    expect(asked!.dob).toBe(raw!.dob);
  });

  it("masks the PID unless student.pid.view is held (A-3)", async () => {
    const all = await searchStudents({ by: "name", lastName: "an" }, provider);
    const id = all.rows[0].idnumber;
    const raw = await provider.getStudentBio(id);

    const masked = await getStudentProfile(id, principal(), {}, provider);
    expect(masked!.pid).toMatch(/^•+\d{4}$/);
    expect(JSON.stringify(masked)).not.toContain(raw!.pid);

    const full = await getStudentProfile(id, principal(["student.pid.view"]), {}, provider);
    expect(full!.pid).toBe(raw!.pid);
  });

  it("returns null for an unknown student rather than an empty profile", async () => {
    expect(await getStudentProfile("no-such-id", principal(), {}, provider)).toBeNull();
  });
});
