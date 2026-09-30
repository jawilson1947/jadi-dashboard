import { getDataProvider } from "../../../repositories";
import { getAppStore } from "../../../store";
import { formatCount, formatCurrency } from "../../../../lib/format";
import { requireReport } from "../../../reports/definitions";
import { loadSnapshotRows } from "../../../reports/snapshot";
import type { FreshmanAnalysisRow, UnclassifiedRow } from "../../../repositories/types";
import { promptBody, promptPreamble, type AnalysisDeps, type AnalysisModule, type ConfidenceNote, type GatheredAnalysis } from "./types";

/**
 * M5 — Data-quality briefing (AI-ANALYSIS-PLAN §3.4, AI-D6).
 *
 * The other modules each carry their own confidence notes; this one is about the defects
 * themselves and what they cost. It LEADS WITH A-42 — the debit balances resting on term codes
 * that resolve to no tblOUSA row — because that residue is absent from every semester figure in
 * the application, and was measured at 7.9% of the global receivable. A footnote was the wrong
 * place for nearly a million dollars.
 *
 * Reads the Phase 7a report snapshots rather than re-querying: R1 and R2 already measure the
 * classification defects, and this module's job is to say what they mean, not to count again.
 */

export interface UnmatchedCode {
  termKey: string;
  students: number;
  owed: number;
}

export interface DataQualityFacts {
  residueOwed: number;
  residueStudents: number;
  residueCodes: number;
  sentinelOwed: number;
  largestNonSentinel: UnmatchedCode[];
  unrecognisedShapes: string[];
  unclassifiedStudents: number | null;
  unclassifiedCaptured: boolean;
  freshmanMismatches: number | null;
  freshmanPopulation: number | null;
  freshmanCaptured: boolean;
  shape: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Term codes follow Trad/Leap (SP/FA/LS/LF) or Summer (SU/SL) plus four digits; XX0000 is the
 * never-cleared sentinel (A-16). Anything else is a family nobody has documented — LM2025 on
 * staging — and is worth naming rather than lumping into "other".
 */
const KNOWN_SHAPE = /^(SP|FA|LS|LF|SU|SL)\d{4}$/;

export const dataQualityModule: AnalysisModule<DataQualityFacts> = {
  key: "data-quality",
  ref: "M5",
  title: "Data-quality briefing",
  blurb: "What is wrong with the data, and what it costs the other analyses",
  darkUntil: "A-13",

  async gather(deps: AnalysisDeps): Promise<GatheredAnalysis<DataQualityFacts>> {
    const provider = deps.provider ?? getDataProvider();
    const store = deps.store ?? getAppStore();
    const now = deps.now ?? new Date();

    const residue = await provider.getUnmatchedTermResidue();
    const unclassified = await loadSnapshotRows<UnclassifiedRow>(requireReport("unclassified"), { provider, store, now });
    const freshman = await loadSnapshotRows<FreshmanAnalysisRow>(requireReport("freshman-analysis"), { provider, store, now });

    const residueOwed = round2(residue.reduce((t, r) => t + r.owed, 0));
    const sentinel = residue.find((r) => r.termKey.toUpperCase() === "XX0000");
    const nonSentinel = residue.filter((r) => r.termKey.toUpperCase() !== "XX0000");
    const unrecognisedShapes = [
      ...new Set(nonSentinel.filter((r) => r.termKey && !KNOWN_SHAPE.test(r.termKey.toUpperCase())).map((r) => r.termKey)),
    ];

    const facts: DataQualityFacts = {
      residueOwed,
      residueStudents: residue.reduce((t, r) => t + r.students, 0),
      residueCodes: residue.length,
      sentinelOwed: sentinel?.owed ?? 0,
      largestNonSentinel: nonSentinel.slice(0, 5).map((r) => ({ termKey: r.termKey, students: r.students, owed: r.owed })),
      unrecognisedShapes,
      unclassifiedStudents: unclassified.meta.missing ? null : unclassified.rows.length,
      unclassifiedCaptured: !unclassified.meta.missing,
      freshmanMismatches: freshman.meta.missing ? null : freshman.rows.filter((r) => r.mismatch).length,
      freshmanPopulation: freshman.meta.missing ? null : freshman.rows.length,
      freshmanCaptured: !freshman.meta.missing,
      shape:
        residueOwed > 0
          ? `${formatCurrency(residueOwed)} of debit balance rests on term codes that resolve to no semester, so it is absent from every by-semester figure in the application (A-42).`
          : "Every debit balance resolves to a semester; no residue is unaccounted for.",
    };

    const confidence: ConfidenceNote[] = [];
    if (!facts.unclassifiedCaptured) {
      confidence.push({ subject: "R1 Unclassified", effect: "Not captured yet, so the classification gap is unknown rather than zero." });
    }
    if (!facts.freshmanCaptured) {
      confidence.push({ subject: "R2 Freshman analysis", effect: "Not captured yet, so the FF/FR mismatch count is unknown rather than zero." });
    }
    confidence.push({
      subject: "This briefing measures what is visible",
      effect: "It counts defects the reports already detect. A defect no report looks for does not appear here, and its absence is not evidence.",
    });

    return {
      facts,
      confidence,
      citation: {
        sources: ["dbo.tblStudent", "dbo.tblOUSA", "R1 snapshot", "R2 snapshot"],
        capturedAt: unclassified.meta.capturedAt,
        readAt: now,
      },
    };
  },

  present({ facts: f }) {
    const tables = [
      {
        caption: "Debit balances on term codes that resolve to no semester (A-42)",
        columns: ["Term code", "Students", "Owed"],
        rows: [
          ...(f.sentinelOwed > 0 ? [["XX0000 (never-cleared sentinel)", "—", formatCurrency(f.sentinelOwed)]] : []),
          ...f.largestNonSentinel.map((r) => [r.termKey || "(blank)", formatCount(r.students), formatCurrency(r.owed)]),
        ],
        note:
          f.residueCodes > f.largestNonSentinel.length + 1
            ? `Largest codes shown; ${formatCount(f.residueCodes)} distinct codes in total.`
            : undefined,
      },
    ];
    return {
      headline: f.shape,
      figures: [
        { label: "Unresolved balance", value: formatCurrency(f.residueOwed), hint: `${formatCount(f.residueStudents)} students across ${formatCount(f.residueCodes)} codes` },
        { label: "On the XX0000 sentinel", value: formatCurrency(f.sentinelOwed), hint: "No semester on record" },
        { label: "Unclassified students (R1)", value: f.unclassifiedStudents !== null ? formatCount(f.unclassifiedStudents) : "not captured" },
        { label: "Freshman code mismatches (R2)", value: f.freshmanMismatches !== null ? `${formatCount(f.freshmanMismatches)} of ${formatCount(f.freshmanPopulation ?? 0)}` : "not captured" },
      ],
      tables,
    };
  },

  prompt(g) {
    const { largestNonSentinel, ...summary } = g.facts;
    return [
      promptPreamble(dataQualityModule.title),
      promptBody(
        { ...summary, largestUnresolvedCodes: largestNonSentinel.map((r) => `${r.termKey}: ${r.students} students, ${r.owed}`) },
        g.confidence,
      ),
      "",
      "Write for someone deciding whether to trust the other analyses. Say what each defect makes",
      "uncertain and by roughly how much, and separate defects that are being fixed from defects that",
      "are simply unmeasured.",
    ].join("\n");
  },
};
