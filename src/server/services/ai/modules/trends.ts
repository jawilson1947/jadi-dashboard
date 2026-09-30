import { getDataProvider } from "../../../repositories";
import { getAppStore } from "../../../store";
import { formatCount } from "../../../../lib/format";
import { promptBody, promptPreamble, type AnalysisDeps, type AnalysisModule, type ConfidenceNote, type GatheredAnalysis } from "./types";

/**
 * M1 — Enrolment and clearance trends (AI-ANALYSIS-PLAN §4.3, HISTORICAL-PLAN §7).
 *
 * MEASURED 2026-09-30 (FINDINGS §9.1): 26 of 28 tblOUSA rows carry census and FinanciallyCleared,
 * 2015 to 2026, and the shape is unambiguous — census down ~38%, clearance rate flat inside
 * 85–94%. So the module's job is NOT to look for a clearance problem. It is to establish that
 * clearance is holding while the student body shrinks, because three of the four mitigation levers
 * anyone reaches for first assume the opposite.
 *
 * Same-season pairs only (A-23 omits summer, and a Spring/Fall comparison is a different
 * population). Terms with no captured figure are excluded and counted, never read as zero.
 */

export interface TrendPoint {
  semesterName: string;
  season: "Fall" | "Spring";
  year: number;
  census: number;
  cleared: number;
  clearedPct: number;
}

export interface TrendFacts {
  termsCovered: number;
  termsUncaptured: number;
  firstTerm: string | null;
  lastTerm: string | null;
  fallCensusFirst: number | null;
  fallCensusLast: number | null;
  fallCensusChangePct: number | null;
  springCensusFirst: number | null;
  springCensusLast: number | null;
  springCensusChangePct: number | null;
  clearedPctMin: number | null;
  clearedPctMax: number | null;
  clearedPctFirst: number | null;
  clearedPctLast: number | null;
  /** The finding in one computed sentence — the model is given it, and cannot restate it wrongly. */
  shape: string;
  series: { term: string; census: number; clearedPct: number }[];
}

const SEASONS: Record<string, "Fall" | "Spring"> = { Fall: "Fall", Spring: "Spring" };

function pct(n: number, d: number): number {
  return d > 0 ? Math.round((1000 * n) / d) / 10 : 0;
}

export const trendsModule: AnalysisModule<TrendFacts> = {
  key: "enrolment-trends",
  ref: "M1",
  title: "Enrolment and clearance trends",
  blurb: "Eleven years of census against financial clearance, and what moved",
  darkUntil: "A-13",

  async gather(deps: AnalysisDeps): Promise<GatheredAnalysis<TrendFacts>> {
    const provider = deps.provider ?? getDataProvider();
    const now = deps.now ?? new Date();
    void (deps.store ?? getAppStore());

    const terms = await provider.getTermMetadata();
    const points: TrendPoint[] = [];
    let uncaptured = 0;

    for (const t of terms) {
      const season = SEASONS[t.semesterName.split(" ")[0]];
      // A-23: summer omitted. Its clearance behaves differently (55.6% in 2025) and would drag any
      // same-season comparison it was folded into.
      if (!season) continue;
      const census = t.census ?? 0;
      const cleared = t.financiallyCleared ?? 0;
      // "Not captured" is not "nobody enrolled" — future terms sit at 0 and must not enter a trend.
      if (census <= 0) { uncaptured += 1; continue; }
      const year = Number(t.semesterName.split(" ")[1]);
      points.push({ semesterName: t.semesterName, season, year, census, cleared, clearedPct: pct(cleared, census) });
    }
    points.sort((a, b) => a.year - b.year || (a.season === "Spring" ? -1 : 1));

    const falls = points.filter((p) => p.season === "Fall");
    const springs = points.filter((p) => p.season === "Spring");
    const change = (s: TrendPoint[]) =>
      s.length >= 2 ? Math.round(1000 * ((s[s.length - 1].census - s[0].census) / s[0].census)) / 10 : null;

    const pcts = points.map((p) => p.clearedPct);
    const clearedPctMin = pcts.length ? Math.min(...pcts) : null;
    const clearedPctMax = pcts.length ? Math.max(...pcts) : null;
    const fallChange = change(falls);
    const springChange = change(springs);

    /*
      The computed finding. This exists so the narrative cannot mis-state the direction: the model
      is handed the conclusion the arithmetic supports, and its job is why, not whether.
      It is a FACT (computed here), not a hypothesis — AI-D1.
    */
    const censusFalling = (fallChange ?? 0) < -5 || (springChange ?? 0) < -5;
    const clearanceSteady = clearedPctMin !== null && clearedPctMax !== null && clearedPctMax - clearedPctMin < 15;
    const shape = censusFalling && clearanceSteady
      ? "Census is falling materially while the clearance rate holds inside a narrow band — a demand movement, not a clearance-performance movement."
      : censusFalling
        ? "Census is falling and the clearance rate is also moving; the two need separating before either is attributed."
        : clearanceSteady
          ? "Census is broadly stable and the clearance rate holds."
          : "Neither census nor the clearance rate is stable; no single shape describes the period.";

    const facts: TrendFacts = {
      termsCovered: points.length,
      termsUncaptured: uncaptured,
      firstTerm: points[0]?.semesterName ?? null,
      lastTerm: points[points.length - 1]?.semesterName ?? null,
      fallCensusFirst: falls[0]?.census ?? null,
      fallCensusLast: falls[falls.length - 1]?.census ?? null,
      fallCensusChangePct: fallChange,
      springCensusFirst: springs[0]?.census ?? null,
      springCensusLast: springs[springs.length - 1]?.census ?? null,
      springCensusChangePct: springChange,
      clearedPctMin,
      clearedPctMax,
      clearedPctFirst: points[0]?.clearedPct ?? null,
      clearedPctLast: points[points.length - 1]?.clearedPct ?? null,
      shape,
      series: points.map((p) => ({ term: p.semesterName, census: p.census, clearedPct: p.clearedPct })),
    };

    const confidence: ConfidenceNote[] = [];
    if (uncaptured > 0) {
      confidence.push({
        subject: `${uncaptured} term${uncaptured === 1 ? "" : "s"} without a captured census`,
        effect: "Excluded from the series rather than read as zero; future terms and any term the nightly job missed fall here.",
      });
    }
    confidence.push({
      subject: "Summer terms (A-23)",
      effect: "Omitted. Summer clearance behaves differently and would distort a same-season comparison.",
    });
    confidence.push({
      subject: "Intra-term timing (open question 8)",
      effect: "Historical clearance dates do not exist, so nothing here can say WHEN in a term clearance happened. Any 'intervene earlier' reading is unsupported by this data.",
    });

    return {
      facts,
      confidence,
      citation: { sources: ["dbo.tblOUSA (census, FinanciallyCleared)"], capturedAt: null, readAt: now },
    };
  },

  present({ facts }) {
    const f = facts;
    return {
      headline: f.shape,
      figures: [
        { label: "Terms analysed", value: formatCount(f.termsCovered), hint: f.firstTerm && f.lastTerm ? `${f.firstTerm} to ${f.lastTerm}` : undefined },
        { label: "Fall census", value: f.fallCensusFirst !== null ? `${formatCount(f.fallCensusFirst)} → ${formatCount(f.fallCensusLast ?? 0)}` : "—", hint: f.fallCensusChangePct !== null ? `${f.fallCensusChangePct}%` : undefined },
        { label: "Spring census", value: f.springCensusFirst !== null ? `${formatCount(f.springCensusFirst)} → ${formatCount(f.springCensusLast ?? 0)}` : "—", hint: f.springCensusChangePct !== null ? `${f.springCensusChangePct}%` : undefined },
        { label: "Clearance rate", value: f.clearedPctMin !== null ? `${f.clearedPctMin}% – ${f.clearedPctMax}%` : "—", hint: "Range across every captured term" },
      ],
      tables: [
        {
          caption: "Census and clearance rate by term",
          columns: ["Term", "Census", "Cleared %"],
          rows: f.series.map((p) => [p.term, formatCount(p.census), `${p.clearedPct}%`]),
          note: "Summer omitted (A-23). Terms with no captured census are excluded, not shown as zero.",
        },
      ],
    };
  },

  prompt(g) {
    // The series is summarised rather than listed row by row: a long list invites the model to do
    // arithmetic over it, which is the one thing AI-D1 forbids.
    const { series, ...summary } = g.facts;
    return [
      promptPreamble(trendsModule.title),
      promptBody({ ...summary, termsInSeries: series.length }, g.confidence),
      "",
      "Note: the clearance rate is the share of the census that cleared financially. A falling census",
      "with a steady rate is a different institutional problem from a steady census with a falling rate.",
    ].join("\n");
  },
};
