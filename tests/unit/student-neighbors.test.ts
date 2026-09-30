import { describe, expect, it } from "vitest";
import { PAGE_SIZE_DEFAULT, searchStudents } from "@/server/services/students";
import { getStudentNeighbors } from "@/server/services/student-neighbors";
import { parseReturnTo } from "@/lib/return-to";

/** The search the lookup page would have run, and the ordered IDs it would have listed. */
async function listing(term: string) {
  const rows = (await searchStudents({ by: "name", lastName: term })).rows;
  return rows.map((r) => r.idnumber);
}

const from = (term: string, page: number, sel: string, pageSize = 10) =>
  `/students?by=name&last=${term}&page=${page}&pageSize=${pageSize}&sel=${sel}#row-${sel}`;

describe("student pager neighbours (Bio Spec 1.1)", () => {
  it("steps forward and back through the match set in list order", async () => {
    const ids = await listing("an");
    expect(ids.length).toBeGreaterThan(2);

    const middle = await getStudentNeighbors(from("an", 1, ids[1]), ids[1], "bio");
    expect(middle).not.toBeNull();
    expect(middle!.position).toBe(2);
    expect(middle!.total).toBe(ids.length);
    expect(middle!.prev?.idnumber).toBe(ids[0]);
    expect(middle!.next?.idnumber).toBe(ids[2]);
  });

  it("renders the ends of the list as ends, not as wraparound", async () => {
    const ids = await listing("an");

    const first = await getStudentNeighbors(from("an", 1, ids[0]), ids[0], "bio");
    expect(first!.prev).toBeNull();
    expect(first!.next?.idnumber).toBe(ids[1]);

    const lastId = ids[ids.length - 1];
    const last = await getStudentNeighbors(from("an", 1, lastId), lastId, "bio");
    expect(last!.next).toBeNull();
    expect(last!.position).toBe(ids.length);
  });

  it("names the page each step lands on, so Return to results goes back to the right page", async () => {
    const ids = await listing("an");
    const pageSize = 10; // must be one the lookup page offers; anything else falls back (below)

    const atEdge = await getStudentNeighbors(`/students?by=name&last=an&page=1&pageSize=${pageSize}&sel=${ids[1]}`, ids[1], "bio");
    expect(atEdge!.next?.idnumber).toBe(ids[2]); // the step ignores page edges; the list is one sequence

    const next = new URL(atEdge!.next!.href, "http://x.test");
    const returnTo = parseReturnTo(next.searchParams.get("from"));
    expect(returnTo).not.toBeNull();

    const back = new URL(returnTo!, "http://x.test");
    expect(back.searchParams.get("sel")).toBe(ids[2]);
    expect(back.searchParams.get("pageSize")).toBe(String(pageSize));
    expect(back.searchParams.get("page")).toBe(String(Math.floor(2 / pageSize) + 1));
    expect(back.hash).toBe(`#row-${ids[2]}`);
  });

  it("falls back to the default page size rather than inventing one", async () => {
    const ids = await listing("an");
    const n = await getStudentNeighbors(`/students?by=name&last=an&page=1&pageSize=3&sel=${ids[0]}`, ids[0], "bio");
    const back = new URL(parseReturnTo(new URL(n!.next!.href, "http://x.test").searchParams.get("from"))!, "http://x.test");
    expect(back.searchParams.get("pageSize")).toBe(String(PAGE_SIZE_DEFAULT));
  });

  it("keeps the tab the reader is on", async () => {
    const ids = await listing("an");
    const n = await getStudentNeighbors(from("an", 1, ids[0]), ids[0], "transactions");
    expect(new URL(n!.next!.href, "http://x.test").searchParams.get("tab")).toBe("transactions");
  });

  it("offers nothing rather than a wrong step when the student is not in the search", async () => {
    expect(await getStudentNeighbors(from("an", 1, "000000"), "000000", "bio")).toBeNull();
  });

  it("offers nothing when the carried search no longer validates", async () => {
    expect(await getStudentNeighbors("/students?by=name&last=&page=1&pageSize=10", "176941", "bio")).toBeNull();
    expect(await getStudentNeighbors("/students?by=id&id=1&page=1&pageSize=10", "176941", "bio")).toBeNull();
  });
});
