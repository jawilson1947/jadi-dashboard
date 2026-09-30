import { describe, expect, it } from "vitest";
import { parseReturnTo, rowAnchorId, withReturnTo } from "@/lib/return-to";

describe("parseReturnTo", () => {
  it("accepts a lookup result URL", () => {
    const href = "/students?by=name&last=smith&page=2&pageSize=25&sel=1234#row-1234";
    expect(parseReturnTo(href)).toBe(href);
  });

  it("rejects anything that is not the lookup page", () => {
    expect(parseReturnTo("/dashboard?x=1")).toBeNull();
    expect(parseReturnTo("/students")).toBeNull();
    expect(parseReturnTo("https://evil.example/students?a=1")).toBeNull();
  });

  it("rejects protocol-relative paths and control characters", () => {
    expect(parseReturnTo("//evil.example/students?a=1")).toBeNull();
    expect(parseReturnTo("/students?last=a\nb")).toBeNull();
  });

  it("rejects non-strings, empties and over-long values", () => {
    expect(parseReturnTo(undefined)).toBeNull();
    expect(parseReturnTo("")).toBeNull();
    expect(parseReturnTo(`/students?last=${"a".repeat(500)}`)).toBeNull();
  });
});

describe("withReturnTo", () => {
  const from = "/students?by=name&last=smith&sel=9#row-9";

  it("is a no-op without a return URL", () => {
    expect(withReturnTo("/students/9?tab=bio", null)).toBe("/students/9?tab=bio");
  });

  it("appends with the separator the href needs", () => {
    expect(withReturnTo("/students/9?tab=bio", from)).toBe(`/students/9?tab=bio&from=${encodeURIComponent(from)}`);
    expect(withReturnTo("/students/9", from)).toBe(`/students/9?from=${encodeURIComponent(from)}`);
  });

  it("round-trips through a URL", () => {
    const url = new URL(withReturnTo("/students/9?tab=bio", from), "http://x.test");
    expect(parseReturnTo(url.searchParams.get("from"))).toBe(from);
  });
});

describe("rowAnchorId", () => {
  it("matches the prefix the table renders", () => {
    expect(rowAnchorId("1234")).toBe("row-1234");
  });
});
