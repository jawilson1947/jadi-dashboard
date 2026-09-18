import { describe, expect, it } from "vitest";
import { decodeSessionCookie, encodeSessionCookie } from "@/server/auth/session";

const SID = "0f1e2d3c-4b5a-4978-8a9b-0c1d2e3f4a5b";

describe("signed session cookie (carries only the session id)", () => {
  it("round-trips", () => {
    expect(decodeSessionCookie(encodeSessionCookie(SID, "secret-secret-secret"), "secret-secret-secret")).toBe(SID);
  });
  it("rejects tampering, wrong secrets and malformed ids", () => {
    const value = encodeSessionCookie(SID, "secret-secret-secret");
    expect(decodeSessionCookie(value, "other-secret-other")).toBeNull();
    const sig = value.split(".")[1];
    expect(decodeSessionCookie(`11111111-2222-4333-8444-555555555555.${sig}`, "secret-secret-secret")).toBeNull();
    expect(decodeSessionCookie(`not-a-uuid.${sig}`, "secret-secret-secret")).toBeNull();
    expect(decodeSessionCookie(undefined, "secret-secret-secret")).toBeNull();
    expect(decodeSessionCookie("", "secret-secret-secret")).toBeNull();
  });
});
