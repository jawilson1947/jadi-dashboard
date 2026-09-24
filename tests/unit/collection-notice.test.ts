import { afterEach, describe, expect, it } from "vitest";
import { AiUnavailableError, assertNoticeAvailable, buildFacts, buildPrompt, draftCollectionNotice, setNoticeModel } from "@/server/services/ai/collection-notice";
import { analyzePayments } from "@/server/services/payment-analysis";
import { resetConfigCache } from "@/server/db/config";

const profile = { idnumber: "176941", firstName: "Avery", lastName: "Brooks", accountBalance: 1840.5 };
const analysis = analyzePayments(
  [
    { postedOn: "2025-01-05", description: "Tuition", amount: 4000, sourceCode: "CG" },
    { postedOn: "2025-02-05", description: "Payment", amount: -2159.5, sourceCode: "RC" },
  ],
  1840.5,
  { today: "2026-09-23" },
);

const facts = buildFacts(profile, analysis, { institutionName: "the university", semesterLabel: "Fall 2026" });

afterEach(() => {
  setNoticeModel(null);
  delete process.env.AI_ENABLED;
  delete process.env.AI_IDENTIFIED_DATA_ENABLED;
  resetConfigCache();
});

describe("what the prompt may contain (A-26)", () => {
  it("carries only the approved fields", () => {
    const prompt = buildPrompt(facts);
    expect(prompt).toContain("Avery Brooks");
    expect(prompt).toContain("176941");
    expect(prompt).toContain("$1840.50");
    expect(prompt).toContain("Fall 2026");
  });

  it("never carries transaction rows, PID, CNP, date of birth or an address", () => {
    const prompt = buildPrompt(facts);
    for (const leak of ["Tuition", "SOURCE_CDE", "CG", "pid", "PID", "CNP", "dob", "Oak St"]) {
      expect(prompt, `prompt contains ${leak}`).not.toContain(leak);
    }
  });

  it("tells the model what it may not say", () => {
    const prompt = buildPrompt(facts);
    expect(prompt).toMatch(/do not threaten legal action/i);
    expect(prompt).toMatch(/do not mention credit reporting/i);
  });
});

describe("the notice ships disabled (A-13, A-26)", () => {
  it("refuses while AI is off", () => {
    resetConfigCache();
    expect(() => assertNoticeAvailable()).toThrowError(AiUnavailableError);
    try {
      assertNoticeAvailable();
    } catch (err) {
      expect((err as AiUnavailableError).reason).toBe("disabled");
    }
  });

  it("refuses when AI is on but identified data has not been approved", () => {
    process.env.AI_ENABLED = "true";
    resetConfigCache();
    try {
      assertNoticeAvailable();
      throw new Error("should have refused");
    } catch (err) {
      expect((err as AiUnavailableError).reason).toBe("identified-data-not-approved");
    }
  });

  it("refuses when both switches are on but no approved model is wired", () => {
    process.env.AI_ENABLED = "true";
    process.env.AI_IDENTIFIED_DATA_ENABLED = "true";
    resetConfigCache();
    try {
      assertNoticeAvailable();
      throw new Error("should have refused");
    } catch (err) {
      expect((err as AiUnavailableError).reason).toBe("no-model");
    }
  });

  it("drafts, and cites what it was built from, once everything is approved", async () => {
    process.env.AI_ENABLED = "true";
    process.env.AI_IDENTIFIED_DATA_ENABLED = "true";
    resetConfigCache();
    setNoticeModel({ name: "test-model", complete: async (p) => `DRAFT[${p.length}]` });
    const draft = await draftCollectionNotice(facts);
    expect(draft.model).toBe("test-model");
    expect(draft.text).toMatch(/^DRAFT\[/);
    expect(draft.citation.facts.idnumber).toBe("176941");
    expect(draft.citation.retentionDays).toBe(90);
  });
});
