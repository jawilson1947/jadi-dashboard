import { describe, expect, it } from "vitest";
import { MockDataProvider } from "@/server/repositories/mock/provider";
import { SearchInputError, buildSearchQuery, escapeLike, getStudentProfile, searchStudents } from "@/server/services/students";
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
    expect(result.truncated).toBe(result.rows.length >= result.limit);
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
