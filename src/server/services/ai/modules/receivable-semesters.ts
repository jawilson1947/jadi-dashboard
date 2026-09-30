import { getDataProvider } from "../../../repositories";
import { formatCount, formatCurrency } from "../../../../lib/format";
import { promptBody, promptPreamble, type AnalysisDeps, type AnalysisModule, type ConfidenceNote, type GatheredAnalysis } from "./types";

/**
 * M2 — Outstanding balances by semester (AI-ANALYSIS-PLAN §4.2, §4.2a; A-39).
 *
 * THE THING THIS MODULE EXISTS TO GET RIGHT. Spec §9.3 groups today's debit balances by
 * tblStudent.LastCleared, which is overwritten on every roll, so a balance rests under a term only
 * while that record stopped there. Measured on staging: stillEnrolled is 0 for every past term.
 * The buckets are LEAVER buckets, and "the receivable for Spring 2023" was never what they showed.
 *
 * That does not refute the proposed cause (DNR attrition) — it sharpens it. If the buckets only
 * ever hold leavers, the Fall/Spring ratio measures WHERE IN THE YEAR students stop owing money,
 * and Spring ran 2.06x Fall over the last five years in both money and headcount.
 *
 * AI-D8 IS LOAD-BEARING HERE. The hypothesis is never written into the prompt. The decomposition
 * is computed and handed over, and the model is asked what it suggests. Told "Spring is higher
 * because of attrition", a model will argue it persuasively whichever column the money is in.
 */

export interface SeasonPair {
  academicYear: string;
  fallOwed: number;
  fallStudents: number;
  springOwed: number;
  springStudents: number;
  ratio: number | null;
}

export interface ReceivableFacts {
  totalOwed: number;
  totalStudents: number;
  termsWithBalance: number;
  owedByCurrentlyEnrolled: number;
  owedByNotEnrolled: number;
  shareNotEnrolledPct: number;
  owedClearedNotReturned: number;
  owedNeverClearedGone: number;
  shareClearedNotReturnedPct: number;
  pairs: SeasonPair[];
  fallTotalPaired: number;
  springTotalPaired: number;
  springToFallRatio: number | null;
  /** Terms whose leaver money is entirely one category — an anomaly, not a reading (A-41). */
  singleCategoryTerms: string[];
  shape: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const pct = (n: number, d: number) => (d > 0 ? Math.round((1000 * n) / d) / 10 : 0);

function seasonOf(semesterName: string): { season: "Fall" | "Spring" | null; year: number } {
  const [word, y] = semesterName.split(" ");
  const season = word === "Fall" ? "Fall" : word === "Spring" ? "Spring" : null;
  return { season, year: Number(y) };
}

export const receivableSemestersModule: AnalysisModule<ReceivableFacts> = {
  key: "receivable-by-semester",
  ref: "M2",
  title: "Outstanding balances by semester",
  blurb: "Where the receivable rests, and what kind of money each bucket is",
  darkUntil: "A-13",

  async gather(deps: AnalysisDeps): Promise<GatheredAnalysis<ReceivableFacts>> {
    const provider = deps.provider ?? getDataProvider();
    const now = deps.now ?? new Date();
    const rows = await provider.getReceivableDecomposition();

    const totalOwed = round2(rows.reduce((t, r) => t + r.owed, 0));
    const totalStudents = rows.reduce((t, r) => t + r.students, 0);
    const owedByCurrentlyEnrolled = round2(rows.reduce((t, r) => t + r.owedByEnrolled, 0));
    const owedByNotEnrolled = round2(rows.reduce((t, r) => t + r.owedByNotEnrolled, 0));
    const owedClearedNotReturned = round2(rows.reduce((t, r) => t + r.owedClearedNotReturned, 0));
    const owedNeverClearedGone = round2(rows.reduce((t, r) => t + r.owedNeverClearedGone, 0));

    /*
      Same-season pairs: Fall YYYY with the FOLLOWING Spring, which is one academic year (A-23's
      pairing rule). Comparing Spring to the Fall beside it in the calendar would pair two
      different cohorts.
    */
    const byKey = new Map<string, (typeof rows)[number]>();
    for (const r of rows) byKey.set(r.semesterName, r);
    const years = [...new Set(rows.map((r) => seasonOf(r.semesterName).year).filter((y) => Number.isFinite(y)))].sort();
    const pairs: SeasonPair[] = [];
    for (const y of years) {
      const fall = byKey.get(`Fall ${y}`);
      const spring = byKey.get(`Spring ${y + 1}`);
      if (!fall || !spring) continue;
      pairs.push({
        academicYear: `${y}–${String(y + 1).slice(2)}`,
        fallOwed: fall.owed,
        fallStudents: fall.students,
        springOwed: spring.owed,
        springStudents: spring.students,
        ratio: fall.owed > 0 ? Math.round((100 * spring.owed) / fall.owed) / 100 : null,
      });
    }
    const fallTotalPaired = round2(pairs.reduce((t, p) => t + p.fallOwed, 0));
    const springTotalPaired = round2(pairs.reduce((t, p) => t + p.springOwed, 0));

    // A term whose leaver money is 100% one category is A-41's shape. Flagged, not smoothed over.
    const singleCategoryTerms = rows
      .filter((r) => r.owedByNotEnrolled > 0 && (r.owedClearedNotReturned === 0 || r.owedNeverClearedGone === 0))
      .map((r) => r.semesterName);

    const ratio = fallTotalPaired > 0 ? Math.round((100 * springTotalPaired) / fallTotalPaired) / 100 : null;
    const shape =
      owedByNotEnrolled > owedByCurrentlyEnrolled
        ? `${pct(owedByNotEnrolled, totalOwed)}% of the balance is owed by students who are no longer enrolled, so these buckets record where students stopped rather than what each semester billed (A-39).`
        : "Most of the balance is owed by currently enrolled students, so the buckets are live debt rather than residue.";

    const facts: ReceivableFacts = {
      totalOwed,
      totalStudents,
      termsWithBalance: rows.length,
      owedByCurrentlyEnrolled,
      owedByNotEnrolled,
      shareNotEnrolledPct: pct(owedByNotEnrolled, totalOwed),
      owedClearedNotReturned,
      owedNeverClearedGone,
      shareClearedNotReturnedPct: pct(owedClearedNotReturned, owedByNotEnrolled),
      pairs,
      fallTotalPaired,
      springTotalPaired,
      springToFallRatio: ratio,
      singleCategoryTerms,
      shape,
    };

    const confidence: ConfidenceNote[] = [
      {
        subject: "What a semester bucket means (A-39)",
        effect:
          "Balances are grouped by tblStudent.LastCleared, which is overwritten on every roll. A bucket holds what students whose record RESTS on that term owe today — not what that semester billed.",
      },
      {
        subject: "Age of the debt",
        effect:
          "Not available. tblStudent holds no balance-as-of-date and global trans_hist is off (A-24 unsigned), so a bucket cannot be split into this term's charges versus years of residue.",
      },
      {
        subject: "Historical DNR (A-40)",
        effect:
          "Not reconstructible: LastCleared is overwritten, so 'cleared in term X, did not return in X+1' cannot be recovered for past terms. Cleared-and-gone below is a present-tense proxy.",
      },
    ];
    if (singleCategoryTerms.length) {
      confidence.push({
        subject: `Single-category terms (A-41): ${singleCategoryTerms.join(", ")}`,
        effect:
          "All leaver money in these terms falls in one category where neighbouring terms are mixed. Likely a roll that did not run or a reset flag; no trend should be drawn through them until explained.",
      });
    }

    return {
      facts,
      confidence,
      citation: { sources: ["dbo.tblStudent", "dbo.tblOUSA", "dbo.VIEW_OURM"], capturedAt: null, readAt: now },
    };
  },

  present({ facts: f }) {
    return {
      headline: f.shape,
      figures: [
        { label: "Balance across matched terms", value: formatCurrency(f.totalOwed), hint: `${formatCount(f.totalStudents)} students` },
        { label: "Owed by students no longer enrolled", value: formatCurrency(f.owedByNotEnrolled), hint: `${f.shareNotEnrolledPct}% of the total` },
        { label: "Cleared, then did not return", value: formatCurrency(f.owedClearedNotReturned), hint: `${f.shareClearedNotReturnedPct}% of the leaver balance — the DNR shape` },
        { label: "Spring vs Fall", value: f.springToFallRatio !== null ? `${f.springToFallRatio}×` : "—", hint: "Paired same academic year" },
      ],
      tables: [
        {
          caption: "Fall against the following Spring, by academic year",
          columns: ["Academic year", "Fall owed", "Fall students", "Spring owed", "Spring students", "Spring ÷ Fall"],
          rows: f.pairs.map((p) => [
            p.academicYear,
            formatCurrency(p.fallOwed),
            formatCount(p.fallStudents),
            formatCurrency(p.springOwed),
            formatCount(p.springStudents),
            p.ratio !== null ? `${p.ratio}×` : "—",
          ]),
          note: "A bucket is what students whose record rests on that term owe today, not what the semester billed (A-39).",
        },
      ],
    };
  },

  prompt(g) {
    const { pairs, singleCategoryTerms, ...summary } = g.facts;
    /*
      AI-D8: the model gets the decomposition and the ratio. It is NOT told that attrition is the
      suspected cause, and it is not told which reading to prefer — the last line asks it to keep
      the competing explanations apart rather than pick one.
    */
    return [
      promptPreamble(receivableSemestersModule.title),
      promptBody(
        {
          ...summary,
          pairedAcademicYears: pairs.map((p) => `${p.academicYear}: Fall ${p.fallOwed} (${p.fallStudents}), Spring ${p.springOwed} (${p.springStudents}), ratio ${p.ratio ?? "n/a"}`),
          termsFlaggedAnomalous: singleCategoryTerms.length ? singleCategoryTerms : "none",
        },
        g.confidence,
      ),
      "",
      "Context you must hold on to: a balance sits in a semester bucket because that student's record",
      "STOPPED at that term, not because the debt arose then. Two readings of any Fall/Spring difference",
      "are therefore available — one about when students leave, one about how the figure is assembled —",
      "and they lead to different actions. Set out both; do not choose between them.",
    ].join("\n");
  },
};
