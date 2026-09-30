import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MockDataProvider } from "@/server/repositories/mock/provider";
import { MemoryAppStore } from "@/server/store/memory";
import { getAnalysisView } from "@/server/services/ai/analysis";
import { setAnalysisModel, type AiModel } from "@/server/services/ai/model";
import { getMemoryAuditEvents } from "@/server/audit/audit";
import { auditAnalysisView } from "@/server/services/ai/analysis";
import type { Principal } from "@/server/authz/permissions";
import { resetConfigCache } from "@/server/db/config";

const provider = new MockDataProvider();
const store = new MemoryAppStore();
const T0 = new Date("2026-09-30T12:00:00Z");
const deps = { provider, store, now: T0 };
const actor: Principal = { userId: "u", displayName: "A", email: "a@example.edu", roles: ["ADMINISTRATOR"], extraPermissions: [] };

/*
  AI_ENABLED is off by default (A-13), which is the deployment's real state. These tests turn the
  switch on so they exercise the "switch on, no model approved" case — the one the application will
  actually sit in once someone flips the flag before A-13 is signed. The switch-off case has its own
  test at the bottom.
*/
beforeEach(() => {
  setAnalysisModel(null);
  process.env.AI_ENABLED = "true";
  resetConfigCache();
});

afterEach(() => {
  setAnalysisModel(null);
  delete process.env.AI_ENABLED;
  resetConfigCache();
});

describe("running dark is the normal path, not an error path (AI-13 unsigned)", () => {
  for (const key of ["enrolment-trends", "receivable-by-semester", "data-quality"]) {
    it(`${key} produces every computed figure with no model wired`, async () => {
      const view = (await getAnalysisView(key, deps))!;
      expect(view.dark?.reason).toBe("no-model");
      expect(view.narrative).toBeNull();
      // The half that ships: a headline, figures, and a citation — all present without a model.
      expect(view.presentation.headline.length).toBeGreaterThan(0);
      expect(view.presentation.figures.length).toBeGreaterThan(0);
      expect(view.citation.sources.length).toBeGreaterThan(0);
      // And it names what would turn the prose on, rather than just saying "unavailable".
      expect(view.dark?.assumption).toMatch(/^A-\d+$/);
    });
  }
});

describe("determinism (AI-D1)", () => {
  it("gathering twice over unchanged data gives identical figures", async () => {
    const a = (await getAnalysisView("receivable-by-semester", deps))!;
    const b = (await getAnalysisView("receivable-by-semester", deps))!;
    expect(JSON.stringify(a.presentation)).toBe(JSON.stringify(b.presentation));
  });
});

describe("M2 — the decomposition (A-39, plan §4.2)", () => {
  it("splits every bucket without losing or double-counting a dollar", async () => {
    const rows = await provider.getReceivableDecomposition();
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      // enrolled + not-enrolled must be the whole bucket...
      expect(Math.abs(r.owedByEnrolled + r.owedByNotEnrolled - r.owed), r.semesterName).toBeLessThan(0.01);
      // ...and the leaver half must split exactly into cleared-and-gone plus never-cleared.
      expect(
        Math.abs(r.owedClearedNotReturned + r.owedNeverClearedGone - r.owedByNotEnrolled),
        r.semesterName,
      ).toBeLessThan(0.01);
    }
  });

  it("reconciles the matched buckets and the unmatched residue to the global receivable", async () => {
    // FINDINGS §9.4 did this on staging; this keeps it true in the fixture, so a change to the
    // attribution rule cannot quietly lose money.
    const rows = await provider.getReceivableDecomposition();
    const residue = await provider.getUnmatchedTermResidue();
    const global = await provider.getGlobalBalances();
    const summed = rows.reduce((t, r) => t + r.owed, 0) + residue.reduce((t, r) => t + r.owed, 0);
    expect(Math.abs(summed - global.positiveTotal)).toBeLessThan(0.05);
  });

  it("says in the confidence notes what a semester bucket actually means", async () => {
    const view = (await getAnalysisView("receivable-by-semester", deps))!;
    const subjects = view.confidence.map((c) => c.subject).join(" ");
    expect(subjects).toMatch(/A-39/);
    // The plan's central caveat must reach the screen, not just the source comments.
    expect(view.confidence.map((c) => c.effect).join(" ")).toMatch(/overwritten/i);
  });
});

describe("M1 — trends (plan §4.3)", () => {
  it("excludes uncaptured terms instead of reading them as zero enrolment", async () => {
    const view = (await getAnalysisView("enrolment-trends", deps))!;
    const table = view.presentation.tables[0];
    expect(table.rows.every((r) => r[1] !== "0")).toBe(true);
    expect(table.note).toMatch(/excluded, not shown as zero/i);
  });

  it("states the shape as a computed fact, so the narrative cannot invert it", async () => {
    const view = (await getAnalysisView("enrolment-trends", deps))!;
    expect(view.presentation.headline).toMatch(/census|clearance/i);
  });
});

describe("M5 — data quality (A-42)", () => {
  it("leads with the balance that resolves to no semester", async () => {
    const view = (await getAnalysisView("data-quality", deps))!;
    expect(view.presentation.figures[0].label).toMatch(/unresolved/i);
  });
});

describe("narration, once a model exists", () => {
  it("fills the two §12 sections and names the model in the citation", async () => {
    const fake: AiModel = {
      name: "test-model",
      async complete() {
        return "HYPOTHESES\n\nThe first explanation.\n\nQUESTIONS\n\n- Ask the registrar\n- Check the roll";
      },
    };
    setAnalysisModel(fake);
    const view = (await getAnalysisView("data-quality", deps))!;
    expect(view.dark).toBeNull();
    expect(view.narrative?.hypotheses).toEqual(["The first explanation."]);
    expect(view.narrative?.questions).toEqual(["Ask the registrar", "Check the roll"]);
    expect(view.narrative?.model).toBe("test-model");
  });

  it("a model that invents a figure cannot change the Facts section", async () => {
    // The guarantee AI-D1 exists for: prose and figures come from different places.
    const liar: AiModel = { name: "liar", async complete() { return "HYPOTHESES\n\nThe total is $1.\n"; } };
    setAnalysisModel(null);
    const honest = (await getAnalysisView("receivable-by-semester", deps))!;
    setAnalysisModel(liar);
    const lied = (await getAnalysisView("receivable-by-semester", deps))!;
    expect(JSON.stringify(lied.presentation)).toBe(JSON.stringify(honest.presentation));
  });
});

describe("audit", () => {
  it("records the module and whether the reading was narrated or arithmetic", async () => {
    setAnalysisModel(null);
    const view = (await getAnalysisView("enrolment-trends", deps))!;
    await auditAnalysisView(actor, view, "c1");
    const event = getMemoryAuditEvents().filter((e) => e.action === "ai.analysis_view").at(-1)!;
    expect(event.targetId).toBe("enrolment-trends");
    expect(event.metadata).toMatchObject({ ref: "M1", narrated: false, dark: "no-model" });
  });
});

describe("the master switch", () => {
  it("reports 'disabled' rather than 'no model' when AI is simply turned off", async () => {
    // Two different states with two different remedies: one is a config flag, the other is a
    // signature on A-13. Collapsing them would send someone to the wrong place.
    delete process.env.AI_ENABLED;
    resetConfigCache();
    const view = (await getAnalysisView("data-quality", deps))!;
    expect(view.dark?.reason).toBe("disabled");
    expect(view.presentation.figures.length).toBeGreaterThan(0);
  });
});
