import { describe, expect, it } from "vitest";
import { ANALYSIS_MODULES, getAnalysisModule, splitNarrative } from "@/server/services/ai/analysis";
import { trendsModule } from "@/server/services/ai/modules/trends";
import { receivableSemestersModule } from "@/server/services/ai/modules/receivable-semesters";
import { dataQualityModule } from "@/server/services/ai/modules/data-quality";
import { promptBody, promptPreamble, type AnalysisModule } from "@/server/services/ai/modules/types";

/**
 * §6 of the plan is a promise about what leaves the network. These tests are what makes it a
 * guarantee rather than a comment — the same technique as tests/unit/collection-notice.test.ts,
 * applied module by module.
 */

/** Values that must never appear in any analysis prompt, whatever a fact object contains. */
const POISON = {
  studentName: "Wilhelmina Poisonsworth",
  idnumber: "900412",
  email: "poison@example.edu",
  phone: "555-0100",
  address: "14 Poison Lane",
  dob: "1998-04-12",
};

describe("the prompt can only carry aggregates (§6)", () => {
  it("promptBody renders whatever it is given — so the guarantee must live in the facts type", () => {
    // Stated as a test because it is the load-bearing design point: nothing sanitises the prompt
    // at the end. The facts objects are aggregate BY CONSTRUCTION, and these tests check that.
    const leaked = promptBody({ studentName: POISON.studentName }, []);
    expect(leaked).toContain(POISON.studentName);
  });

  // Typed as the shared contract: the point of the registry is that every module is interchangeable
  // here, and each has a different fact type.
  const modules: AnalysisModule<unknown>[] = [trendsModule, receivableSemestersModule, dataQualityModule];
  for (const m of modules) {
    it(`${m.ref} builds its prompt from aggregate facts only`, async () => {
      const { MockDataProvider } = await import("@/server/repositories/mock/provider");
      const { MemoryAppStore } = await import("@/server/store/memory");
      const provider = new MockDataProvider();
      const store = new MemoryAppStore();
      const gathered = await m.gather({ provider, store, now: new Date("2026-09-30T12:00:00Z") });
      const prompt = m.prompt(gathered);

      for (const [field, value] of Object.entries(POISON)) {
        expect(prompt, `${m.ref} prompt contains ${field}`).not.toContain(value);
      }
      /*
        And no REAL student id from the fixture. Checking "any 6-9 digit run" was the first version
        of this and it was a proxy, not the invariant: it fired on a legitimate money total
        ($651,070). The invariant is that no student's identifier reaches the prompt, so the test
        compares against the actual ids. Tokenised on non-digits, so a figure that merely CONTAINS
        an id as a substring does not false-positive.
      */
      const page = await provider.getStudentsForPopulation("receivable", { page: 1, pageSize: 500 });
      const ids = new Set(page.rows.map((r) => r.idnumber));
      expect(ids.size, "fixture must hold students for this test to mean anything").toBeGreaterThan(0);
      const tokens = new Set(prompt.match(/\d+/g) ?? []);
      for (const id of ids) expect(tokens.has(id), `${m.ref} prompt contains student id ${id}`).toBe(false);

      expect(prompt).not.toMatch(/[\w.]+@[\w.]+/);
    });

    it(`${m.ref} never hands the model a conclusion to confirm (AI-D8)`, async () => {
      const { MockDataProvider } = await import("@/server/repositories/mock/provider");
      const { MemoryAppStore } = await import("@/server/store/memory");
      const gathered = await m.gather({ provider: new MockDataProvider(), store: new MemoryAppStore(), now: new Date() });
      const prompt = m.prompt(gathered).toLowerCase();
      // The Spring hypothesis in the user's own words, and its near neighbours. A prompt that
      // names a suspected cause gets that cause argued back, whatever the data says.
      expect(prompt).not.toContain("dnr attrition may be the cause");
      expect(prompt).not.toContain("suggesting attrition");
      expect(prompt).not.toMatch(/because of (dnr )?attrition/);
    });
  }
});

describe("the shared preamble states the AI-D1 rules to the model as well as enforcing them", () => {
  const p = promptPreamble("Anything");
  it("forbids producing or recomputing figures", () => {
    expect(p).toMatch(/do not compute, estimate, restate or round any number/i);
  });
  it("asks for the two Spec §12 sections and no others", () => {
    expect(p).toContain("HYPOTHESES");
    expect(p).toContain("QUESTIONS");
  });
  it("requires competing explanations rather than a settled cause", () => {
    expect(p).toMatch(/competing explanations/i);
  });
});

describe("the module registry", () => {
  it("exposes exactly the 8a modules, each resolvable by key", () => {
    expect(ANALYSIS_MODULES.map((m) => m.ref).sort()).toEqual(["M1", "M2", "M5"]);
    for (const m of ANALYSIS_MODULES) expect(getAnalysisModule(m.key), m.key).toBeTruthy();
  });

  it("names an assumption row for every module, so the dark state can say what would fix it", () => {
    for (const m of ANALYSIS_MODULES) expect(m.darkUntil, m.key).toMatch(/^A-\d+$/);
  });

  it("returns null for an unknown key rather than throwing", () => {
    expect(getAnalysisModule("not-a-module")).toBeNull();
  });
});

describe("splitting the model's reply into the §12 sections", () => {
  it("separates the two headed sections", () => {
    const r = splitNarrative("HYPOTHESES\n\nFirst idea.\n\nSecond idea.\n\nQUESTIONS\n\n- Ask A\n- Ask B");
    expect(r.hypotheses).toEqual(["First idea.", "Second idea."]);
    expect(r.questions).toEqual(["Ask A", "Ask B"]);
  });

  it("discards anything before HYPOTHESES — a preamble is where an invented figure would sit", () => {
    const r = splitNarrative("Sure! Here is my analysis of the $9,999 figure.\n\nHYPOTHESES\n\nReal content.");
    expect(r.hypotheses).toEqual(["Real content."]);
    expect(r.hypotheses.join(" ")).not.toContain("9,999");
  });

  it("degrades to readable output when the model ignores the headings", () => {
    const r = splitNarrative("Just one paragraph.\n\nAnd another.");
    expect(r.hypotheses.length).toBe(2);
    expect(r.questions).toEqual([]);
  });
});
