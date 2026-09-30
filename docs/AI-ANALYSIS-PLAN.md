# AI-ANALYSIS-PLAN.md — Phase 8: AI Analyses

Status: Draft for review · 2026-09-30
Baseline: `PLAN.md` P9 · Spec §12 · `ASSUMPTIONS.md` A-13, A-26
Companions: `HISTORICAL-PLAN.md` §7 (already hands this phase a module), `REPORTS-PLAN.md`
(snapshot architecture and A-30), `STUDENT-PLAN.md` D-3 (the collection notice, built in 5f)

---

## 0. The constraint everything else hangs off

**A-13 is unsigned and A-26 is unsigned.** No external model is approved, no data-sharing
agreement exists, and `setNoticeModel()` has never been called with anything but a test double.
That is not an obstacle to planning — it is the shape of the plan:

- Every module is built so it runs **dark**: the deterministic half computes and renders, the
  narration is absent and the page says why, naming the assumption row.
- The deterministic half is therefore **useful on its own**. If A-13 is never signed, this phase
  still ships the analysis; what it loses is the prose.
- This document is written to be the thing that **gets A-13 signed** — §6 states exactly what
  would leave the network, field by field, so the signature is over a list rather than a promise.

**Verified 2026-09-30.** The two things this plan depended on and could not assert have been
measured on staging (FINDINGS §9, via `scripts/run-sql.mjs` and the diagnostics in `db/sql/`):
M1 has eleven years of series, not three points (§4.3), and the Spring hypothesis is supported by a
sharper mechanism than it was offered with (§4.2a). Two data anomalies were found in the process and
are now A-41 and A-42. Nothing below rests on an unverified claim about the data.

A plan that assumed the model were available would be unbuildable today and would put the most
consequential decision — what data an outside party sees — in an appendix. It goes first instead.

---

## 1. Decisions

| # | Decision | Source | Consequence |
|---|---|---|---|
| **AI-D1** | **The model narrates; it never computes.** Every number that reaches the screen is produced by SQL or TypeScript first and handed to the model as a fixed fact list. The model writes the prose, the hypotheses and the questions — it cannot change a figure, and it is never asked for one. | Claude's call, 2026-09-30 (no preference given) — **for sign-off** | Output is reproducible, unit-testable and cheap. No figure on a JADI screen can be a hallucination. See §2. |
| **AI-D2** | **"Personnel" means clearance operators, analysed at team level.** Workload, pace through the sprint, automatic (`sa`) share versus human actions, coverage gaps. **Per-person comparison is deferred** behind its own approval row (A-37) because it is employee performance monitoring. | Claude's call, 2026-09-30 (no preference given) — **for sign-off** | M3 ships as staffing-and-process analysis. Naming individuals is a separate, later, signed decision. See §3.2. |
| **AI-D3** | **Per-student output is an analyst cue, never a determination.** Flags come from explicit deterministic rules a person can read and change, carry the Spec §13 Red Flag framing verbatim, and no model score decides anything about a student. | J. Wilson, 2026-09-30 | M4 is a rules engine with a narrated summary. Every flag can answer "why me?" with a rule name and a threshold. |
| **AI-D4** | **The model adapter stays provider-agnostic.** Hosting — hosted API or on-premises — is decided when A-13 is signed, not now. | J. Wilson, 2026-09-30 | One `AiModel` interface; §5.2 prices both options so the decision is informed rather than defaulted. |
| **AI-D5** | **Modules are built in order of how little approval they need.** Aggregate-only modules first (they sit inside A-13 as already drafted), then personnel, then per-student. | Claude's call | Work is not blocked behind the hardest signature. M1, M2, M5, M6 need only A-13. |
| **AI-D6** | **Every analysis states the quality of the data underneath it.** Unclassified students, `XX0000` semesters, reclaimed records and R2 mismatches are inputs to the narrative, not footnotes. | Claude's call | See §3.4. An analysis that is confidently wrong because 300 students had no classification is worse than no analysis. |
| **AI-D8** | **A stated hypothesis becomes a computed test, never a prompt instruction.** When someone proposes a cause — "Spring receivables are higher because of DNR attrition" — the deterministic layer decomposes the figure and reports what the data supports. The hypothesis is never written into the prompt as context. | Claude's call, 2026-09-30 (from J. Wilson's Spring/DNR hypothesis) — **for sign-off** | Put a hypothesis in a prompt and the model will argue for it persuasively whether or not it is true. See §4.2. |
| **AI-D7** | **Nothing acts.** No module sends an email, flags an account, changes a balance or writes to `dbo`. Every output is a draft or a reading for a person. | Spec §12, A-32/A-33 precedent | The `DENY ... ON SCHEMA::dbo` guarantee is untouched by this phase. |

---

## 2. Why "narrate, don't compute" (AI-D1)

The alternative — hand the model the rows and ask what it notices — is genuinely more interesting,
and it is the wrong trade for this application.

Consider the receivable. Ask a model to analyse 4,800 balance rows and it will write something like
*"receivables are up 12% on last Fall, driven by the freshman cohort."* Three things are wrong with
that sentence as a deliverable here:

1. **The 12% may be invented.** Models arithmetic poorly over long lists, and a plausible wrong
   percentage is indistinguishable from a right one on screen.
2. **It is not reproducible.** Asked again tomorrow it may say 11%, or name a different cohort. A
   figure that changes when nothing changed destroys trust in every other figure on the page —
   including the ones that are right.
3. **It cannot be tested.** This codebase asserts its guarantees (`tests/unit/collection-notice.test.ts`
   already asserts what the prompt does and does not contain). "The narrative is accurate" is not
   an assertion anyone can write.

Under AI-D1 the 12% is computed by the same code that draws the chart, passed in as a fact, and the
model's job is the part it is actually good at: saying *what it might mean*, what would explain it,
and what to check next. The figure and the prose can then never disagree, because there is only one
figure.

This also matches what Spec §12 already asks each output to look like — **Facts / Hypotheses /
Questions to ask**. Facts are computed. Only the other two are generated. The spec had the right
shape before this plan existed; AI-D1 is just taking it literally.

**Deferred, not rejected:** an exploratory "ask anything" mode (M7, §4) where non-reproducibility is
acceptable *and stated on screen*. It is out of the first release because the standing modules must
establish that JADI's numbers are trustworthy before a mode exists that can put an untrustworthy one
next to them.

---

## 3. The factors worth considering

The brief asked for financial, personnel "and any other factors worth consideration". There are four
families, and the fourth is the one usually left out.

### 3.1 Financial

| Factor | Source | Why it matters — and the trap |
|---|---|---|
| Account balance | `tblStudent.AccountBalance` (A-18, authoritative) | The headline. Positive = owed. |
| **Credits Not Posted (CNP)** | `tblStudent.CNP` (`money`) | **The most important correction in this phase.** A student owing $4,000 with $3,800 of CNP is not the same risk as one owing $4,000 with none — the aid is awarded and simply not applied yet. A flag built on balance alone will chase students who owe nothing. Every financial module nets CNP and says it is doing so. |
| Age of the balance | A-6 buckets via `Setting.agingBuckets` | How old the debt is. |
| Days since last credit | A-25 | Recency of payment — a *different* question from age of debt, and the one that drives the six-month collections cue. Both are carried, both labelled. |
| Charges vs credits | `VIEW_OURM_CHARGES` / `_CREDITS`, delta rule §6.3 | Whether the term's billing is internally consistent. Past `DropClassesDate` these read the frozen copy (FINDINGS §5) — a movement across that date is an artefact, not a trend, and the narrative must not read it as one. |
| Clearance worksheet / 80% rule | `fn_CostAnalysis` (authoritative per D-2) | Whether a student *can* clear, not just whether they have. |
| Global payment history | `TMSEPRD` linked server, behind `TRANS_HIST_GLOBAL_ENABLED` | Multi-year behaviour. **Unavailable by default** (A-24 unsigned, the host may be production), so every module treats it as optional and says when it is missing rather than silently analysing one term. |

### 3.2 Personnel — clearance operators (AI-D2)

The system holds no HR data. What it holds is a record of who cleared whom:

| Factor | Source |
|---|---|
| Clearance actions with operator and timestamp | `VIEW_OURM_CLEARED.USER_NAME`, `.DateCleared` |
| Automatic vs human clearance | `USER_NAME = 'sa'` means automatic |
| Operator roster, active flags, effective dates | the Operators admin table (P10) |
| Dashboard usage and audited actions | `dash` audit log |

Analysed at **team level**: how clearance volume moves through the sprint window, what share is
automatic, where the human effort concentrates, whether a queue is building against the drop date.
That is a staffing and process question, and it is the one that changes decisions — "we need two
more people on the counter in week three" is actionable in a way that "Operator B is slower than
Operator A" mostly is not.

**Per-person comparison is deliberately held back (A-37).** The moment an analysis names individuals
and ranks them it is employee performance monitoring, generated by a system the individuals did not
agree to be measured by, possibly summarised by an outside model. That needs HR review, probably a
conversation with the staff concerned, and — depending on the institution — union consultation. It
is a decision for the institution, not a feature to ship quietly because the column happens to exist.
The data is already there and the module is designed so that turning it on later is a permission and
a signature, not a rewrite.

One more thing worth saying plainly: `USER_NAME` values in a clearance view are *not* reliable
identities for judging people. An operator who inherits a queue of difficult accounts, or who covers
a colleague's caseload for a week, looks slow. Any per-person module needs that caveat in the output
itself, not in a document nobody reads.

### 3.3 Temporal and process factors

| Factor | Why |
|---|---|
| Day-of-sprint | Clearance is not uniform; it spikes near deadlines. A count is meaningless without where in the window it was taken. Same-point comparison (A-10) already exists and every trend module must use it rather than comparing calendar dates. |
| `DropClassesDate`, census date | Structural dates that change what the underlying views return (FINDINGS §5). Crossing one changes the data's meaning, not the students' behaviour. |
| Fall vs Spring seasonality | A-23 omits summer. Comparisons are same-season (Fall to Fall) — Spring against Fall is a different population, and A-22 already established this for the sprint benchmark. |
| Term scope of the source | Most `VIEW_OURM_*` views are `isCurrent = 1` only (R-D2). A module that claims a multi-term trend must read `tblStudent.LastCleared` / `tblOUSA` or a captured snapshot, never those views. |

### 3.4 Data quality as a first-class input (AI-D6)

This phase has an advantage most analytics projects don't: the report catalog already measures the
data's own defects. Phase 7a produces exactly the inputs an honest analysis needs about itself.

| Signal | From | What it does to an analysis |
|---|---|---|
| Unclassified students | R1 | Cohort analysis is incomplete by exactly this many students, and they are not a random sample. |
| FF/FR vs derived class mismatches | R2 | Freshman figures are uncertain while these are unresolved — and the remedy may be a wrong `SemesterBegins` rather than wrong records (R-D7). |
| Students cleared more than once | R3 | Clearance counts need the dedup key; a naive count double-counts. |
| `XX0000` / unresolvable `LastCleared` | `tblStudent` | These students sit outside every current-term population, so they are invisible to term-scoped analysis unless counted separately. |
| Reclaimed records | `dash.ReclaimedStudent` (A-32) | Built from Jenzabar analogs; some fields are absent by construction. |
| Snapshot age | `dash.Snapshot` | A narrative over a 14-hour-old population, presented beside live balances, must say so. |

Every module emits a **confidence line** built from these, and it goes in the facts block, so the
model is told about the gaps rather than left to write around them. An analysis that says
*"receivables rose 8%, though 312 students have no classification and are excluded from the cohort
split"* is worth more than a cleaner-looking sentence that hides it.

---

## 4. Modules

| # | Module | Reads | Output | Approval needed | Sub-phase |
|---|---|---|---|---|---|
| **M1** | **Enrolment and clearance trends** — direction and size of movement in `tblOUSA.census` and `FinanciallyCleared`, clearance *rate* as the derived series, terms breaking the pattern, how the receivable tracked enrolment, **and what can be done about it** (§4.3) | `tblOUSA` via `historyEnrollment` snapshots | Aggregate narrative + mitigation levers | A-13 only | 8a |
| **M2** | **Outstanding balances by semester** — the Spring/Fall question, decomposed into stale debt vs term charges before any cause is named (§4.2), with contributing factors and mitigation options | `historyReceivables` snapshots, `tblStudent`, DNR/DNC population | Aggregate narrative | A-13 only | 8a |
| **M2a** | **Clearance-threshold what-if** — what changes if the 80% rule moves, in students and in money, both directions (§4.4) | `fn_CostAnalysis`, worksheet items, current term only | Deterministic table + narrative | A-13 only | 8b |
| **M3** | **Clearance sprint and operator workload** — throughput against the window, automatic vs human share, queue build against the drop date | sprint snapshots, `VIEW_OURM_CLEARED` aggregates | Team-level narrative | A-13 + **A-36** | 8b |
| **M4** | **Red Flag student cues** — per-student deterministic rules, narrated summary of the *population* they select | `tblStudent`, payment analysis, worksheet | Rule-derived flags + aggregate narrative | A-13 + **A-38** | 8c |
| **M5** | **Data-quality briefing** — what is wrong with the data and what it costs the other analyses. **Leads with A-42**: $971,656 on unmatched term codes, which every semester figure silently omits | R1/R2/R3 snapshots, unmatched-code residue, `dash` write logs | Aggregate narrative | A-13 only | 8a |
| **M6** | **Cohort comparison** — same-season, same-point comparison across terms by classification | history + report snapshots | Aggregate narrative | A-13 only | 8b |
| **M7** | **Ad-hoc question mode** | — | Exploratory, non-reproducible | **Out of v1** (§2) | — |
| — | *Collection notice* | *already built, 5f* | *Identified draft* | *A-26* | *shipped dark* |

M1 is not new work invented here — `HISTORICAL-PLAN.md` §7 already specified and handed it over.
This plan adopts that specification unchanged.

### 4.2 The Spring receivable question, worked (M2)

The brief offers a hypothesis: **higher receivables occur in the Spring semesters, suggesting DNR
attrition may be the cause.** It is plausible, and it is exactly the kind of statement AI-D8 exists
for. Before it can be tested, two facts about the data have to be on the table.

**Fact one: `receivablesByTerm` is not a per-semester receivable.** The query behind §9.3 is

```sql
SELECT ISNULL(LastCleared,'') AS termKey, COUNT(*), SUM(AccountBalance)
FROM dbo.tblStudent WHERE AccountBalance > 0 GROUP BY ISNULL(LastCleared,'');
```

That is **today's** outstanding debit balances, bucketed by whichever term each record was last
rolled to. `LastCleared` holds one value per student and is overwritten on every roll (A-1: "term
the record was rolled to", not "last cleared date"). So:

- A student who ran up a balance in Fall 2024, still owes it, and has since been rolled forward
  appears under their *current* term — not under the term the debt came from.
- A balance lands under an **older** term only when that student's record stopped there. The further
  back the term, the more purely the bucket is made of people who left owing money.

**This alone would produce the Spring pattern, with no attrition effect whatsoever.** If records
tend to come to rest on Spring terms — which is what you would expect when the academic year ends in
Spring and leavers' last roll is therefore a Spring code — then every Spring bucket accumulates
residual debt from students who stopped, while Fall buckets are relatively swept clean by the next
roll. The chart would show higher Spring receivables year after year as a **structural artefact of
how `LastCleared` is maintained**.

Note that this is not a rival explanation so much as a *measurement* of the same thing by accident:
"records that stopped at a Spring term" and "students who did not return after Spring" overlap
heavily. The hypothesis may well be right. But as the data stands the chart cannot distinguish
"Spring generates more debt" from "Spring is where leavers' debt comes to rest", and those two
readings lead to opposite actions — the first says fix Spring billing, the second says fix
retention.

**Fact two: historical DNR is not reconstructible.** A-1 defines DNR against the `wasCurrent = 1`
row, so it is computable for the current previous-term pair only. Because `LastCleared` is
overwritten, "who was cleared in Fall 2023 and did not return in Spring 2024" cannot be recovered
from `tblStudent` today. That history is gone. It is not gone *going forward* — the
`dashboard.dnrDnc` job snapshots the population — but the series starts when capture starts.

### 4.2a Measured, 2026-09-30 — both facts confirmed, hypothesis supported

Run on staging via `scripts/run-sql.mjs` (FINDINGS §9.2). The speculation above is now measurement.

**`stillEnrolled` is 0 for every past term.** Only Fall 2026 (267 students, $1,111,403) and one
straggler in Spring 2026 are live. Fact one is confirmed exactly: the buckets contain nothing but
leavers, so §9.3 never showed "receivable for semester X".

**And that makes the Spring hypothesis right, by a cleaner mechanism than it was offered with.** If
the buckets only ever hold leavers, the Fall/Spring ratio measures where in the year students stop:

| Academic year | Fall | Following Spring | Ratio |
|---|---|---|---|
| 2021–22 | $384,838 (67) | $1,065,713 (180) | 2.77× |
| 2022–23 | $594,640 (78) | $1,442,587 (205) | 2.43× |
| 2023–24 | $695,668 (102) | $1,125,799 (174) | 1.62× |
| 2024–25 | $399,602 (72) | $651,070 (115) | 1.63× |
| 2025–26 | $327,777 (64) | $652,400 (148) | 1.99× |
| **Total** | **$2,402,525** | **$4,937,569** | **2.06×** |

Money and headcount both roughly double. The claim M2 should make is therefore **"students who
leave owing money overwhelmingly leave after a Spring term"** — attrition, pointing at retention,
not at Spring billing. Within the leavers the DNR shape (cleared, then gone) is the majority of the
money in most terms — 83.0% in Spring 2022, 74.9% Fall 2022, 70.6% Fall 2025 — and is **not**
cleanly seasonal. The seasonality is in the volume, not the mix.

Two anomalies surfaced and are now assumption rows: **A-41**, Spring 2025 carrying $651,070 with
zero cleared-not-returned where every neighbour is a mix — M1 and M2 must not draw a trend through
it until someone explains that term; and **A-42**, $971,656 (7.9% of the $12,364,581 global
receivable) resting on term codes that match no `tblOUSA` row, $807,010 of it on `XX0000`. M5 leads
with A-42, because every semester figure in the application is quietly missing it.

Buckets plus residue reconcile to the global receivable exactly, so this is entirely an attribution
question — nothing is lost.

**So M2 decomposes rather than concludes.** For each semester bucket it computes:

| Component | How | What it separates |
|---|---|---|
| Still enrolled | present in `VIEW_OURM` | Live debt on active students — a collections and clearance question |
| Cleared-prior, not returned | A-22a `cleared-prior`, absent from current enrolment | The attrition component — the hypothesis's actual subject |
| Never cleared | `ClearedCurrentSession = 0` throughout | Students who never got through the gate |
| `XX0000` / unresolvable | the sentinel | Not attributable to any term; must be shown, not dropped |
| Age of the debt | A-6 buckets | Whether a Spring bucket is *this* Spring's charges or four years of residue |

If the Spring excess is concentrated in "cleared-prior, not returned" with old debt, the hypothesis
is supported and the lever is retention. If it is concentrated in currently-enrolled students with
recent debt, the lever is collections and the Spring/Fall gap is a billing-cycle effect. If it is
spread evenly across old buckets regardless of season, it is the attribution artefact above and the
right response is to fix the measure, not the business.

The model is told the decomposition and asked what it suggests. It is **not** told that DNR
attrition is the suspected cause, because it would then explain why that is so — convincingly, and
regardless of which column the money is actually in.

**A cheap corroborating series exists meanwhile.** `tblOUSA.census` Fall→Spring gives a same-year
enrolment drop for every historical term without touching `LastCleared` at all. It conflates
graduation, transfer and non-return, so it is a proxy and is labelled one — but if Spring receivable
excess tracks the Fall→Spring census drop across years, that is real evidence for the hypothesis
from data that does survive.

### 4.3 What M1 can actually recommend

Trend analysis that stops at "clearance rate fell 4 points" is half a deliverable. M1 pairs each
movement with the levers available, and is explicit that the evidence for a lever is weaker than the
evidence for the trend:

**Measured 2026-09-30, and it settles which row applies** (FINDINGS §9.1): **census falls 40.4%
across Falls and 36.3% across Springs between 2015 and 2026, while the clearance rate stays inside
85.0–94.2% with no direction.** Twenty-four non-summer terms, 26 of 28 `tblOUSA` rows populated.

That is the second row of the table below, not the first — which matters, because three of the four
lever sets assume clearance is the problem and it is not. Clearance is doing its job at roughly the
same rate it did eleven years ago, against a student body two-fifths smaller.

| Observation | Candidate levers | What M1 must say about each |
|---|---|---|
| **Census falling, clearance rate steady** ← **this is the measured case** | Retention and recruitment — outside this application | Name it and stop. M1's honest output is "the receivable pressure is a demand problem"; analysing enrolment demand from AR data would be overreach, and the one lever this application *does* own is the Spring attrition finding in §4.2a. |
| Clearance rate falling while census holds | Earlier intervention in the sprint window; more counter staffing at the peak; clearer pre-term communication | Not the measured case. Note also that timing evidence is **current-term only** (open question 8 — historical clearance dates do not exist), so "intervene earlier" could not be supported from past sprints even if it were. |
| Receivable growing faster than census | Collections effort; payment plans; the 80% threshold (M2a) | Separate *more* debt from *older* debt — the aging split tells you which. Relevant: the receivable has held up while the student body shrank. |
| Both falling together | A cohort effect; check against the classification split | Cross-reference R1: if unclassified students are growing, part of the "fall" may be measurement. |

The finding also reorders M2a. If clearance performance is not the constraint, relaxing the 80%
threshold is not a throughput fix — it is purely a retention lever, and should be argued on the
attrition numbers in §4.2a rather than on clearance rates.

Every lever carries a Facts/Hypotheses boundary: the movement is a fact, the attribution is a
hypothesis, the recommendation is a question to ask someone who knows the institution.

### 4.4 The 80% threshold what-if (M2a)

`CLEARANCE_THRESHOLD = 0.8` is already a named constant, and `fn_CostAnalysis` is authoritative
(D-2), so recomputing the current-term population at 70 / 75 / 80 / 85 / 90% is arithmetic over data
the Clearance tab already reads. Same technique as R2's boundary what-if: price the candidate, don't
change anything.

For each candidate the table gives students who would newly clear, the debit balance they carry, and
the balance still uncollected at that threshold.

**The framing matters more than the arithmetic here, and the plan states it so the output cannot be
misread:** lowering the threshold does not reduce what is owed. It changes *who is permitted to
enrol while owing it*. The likely effects are opposite in sign and land in different places —
receivables rise in the short term because more debt is carried by enrolled students, while DNR
attrition may fall because fewer students are turned away over a shortfall they could have closed
later. Tuition from a retained student may exceed the debt carried. **That trade cannot be resolved
from AR data alone**, and M2a's job is to size both sides, not to recommend a number.

Historical what-if is **not possible**: worksheet items and `fn_CostAnalysis` are current-term, so
"what if the threshold had been 70% in Fall 2024" has no data behind it. M2a says current term only,
on screen.

### 4.1 M4 in more detail, because it is the one that touches people

Rules are data, not code — seeded into `Setting.redFlagRules` so thresholds are tunable without a
deploy, each with a name, a threshold and a plain-English statement. Starting set, for review:

| Rule | Condition | Why it is a cue and not a conclusion |
|---|---|---|
| Unfunded balance | `AccountBalance - CNP` > threshold | The aid-netted figure, per §3.1. Still says nothing about ability or intent to pay. |
| Stalled payer | Days since last credit > 183 **and** balance > 0 | The A-25 collections trigger. A student on a payment plan paying termly looks stalled and is not. |
| Enrolled, not cleared, past drop date | `VIEW_OURM` present, `ClearedCurrentSession = 0`, past `DropClassesDate` | Process exception — often a clearance the flag simply hasn't caught up with (which is what A-34's Check Clearance button exists to fix). |
| Cannot clear on the 80% rule | `fn_CostAnalysis` shortfall | The most actionable one: it names a specific gap. |
| Cleared for a prior term only | A-22a `cleared-prior` state | Rolled but not re-cleared. |

Every flagged student carries the rule name, the threshold and the values that met it. The screen
carries the Spec §13 wording verbatim — **"analyst cue — not an eligibility determination"** — and
the model narrates the *population* ("47 students are flagged, 31 of them by the 80% rule, and they
cluster in the transfer cohort"), never an individual's circumstances.

---

## 5. Architecture

### 5.1 One contract for every module

```
AnalysisModule
  key            stable id, used in the audit row and the citation footer
  gather(deps)   DETERMINISTIC. Reads snapshots and the source. Returns typed facts + confidence.
  facts          a frozen, serialisable object — the ONLY thing the prompt may draw on
  prompt(facts)  pure function, unit-tested for what it contains and omits
  render(...)    Facts from `facts`, Hypotheses/Questions from the model, citation footer
```

`gather` and `render` work with no model present; that is what "runs dark" means. The seam is
already proven — `collection-notice.ts` has exactly this shape (`buildFacts` / `buildPrompt` /
`NoticeModel`), and `NoticeModel` generalises to `AiModel` with no change to its signature.

Outputs are stored in a new `dash.AiOutput` (module key, facts JSON, generated text, model name,
snapshot ID, actor, `generatedAt`), swept at `AI_RETENTION_DAYS` (90, A-13) by a new
`ai.retentionSweep` job. Stored so a narrative can be reproduced and challenged later; swept because
A-13 says 90 days.

### 5.2 Hosting, priced rather than assumed (AI-D4)

| | Hosted API (A-13's current wording) | On-premises |
|---|---|---|
| Data leaving the network | Yes — the facts block, and only that (§6) | None |
| Approval needed | A-13 signed as written | A-13 amended; much narrower review |
| Quality | Good enough that Hypotheses are worth reading | Adequate for narration of supplied facts; this is the easy end of the task |
| Cost | Per-call, small at this volume (~tens of narratives a day, a few hundred tokens each) | Hardware, plus someone to keep it running |
| Risk | A third party holds aggregate university financial data | A model nobody maintains after the person who set it up leaves |

The facts-only design (AI-D1) is what makes on-premises viable: the model is writing prose over a
dozen supplied numbers, not reasoning over a dataset, so a small local model is genuinely adequate.
**If A-13 stalls on the data-sharing question, on-premises is the way to ship this phase rather than
abandon it** — and because the adapter is one interface, that switch is a day's work, not a rewrite.

### 5.3 Switches and permissions

| Control | Governs | New? |
|---|---|---|
| `AI_ENABLED` | everything | existing |
| `AI_IDENTIFIED_DATA_ENABLED` | collection notice, and M4's per-student detail | existing |
| `AI_PERSONNEL_ENABLED` | M3 | **new** (A-36) |
| `ai.view` | reading aggregate narratives | existing |
| `ai.notice.create` | drafting a notice | existing |
| `ai.personnel.view` | M3 | **new** |
| `ai.redflag.view` | M4 | **new** |

Following A-26's precedent: a second switch for a second kind of disclosure, and a permission no
role holds by default.

---

## 6. What may leave the network — the list A-13 is signed over

**Aggregate modules (M1, M2, M3, M5, M6).** Counts, sums, percentages, dates, term labels,
classification bucket names, rule names, operator *counts* — and nothing else. Specifically **never**:
a student name, ID, PID, email, phone, address, date of birth, photograph, a transaction row, an
individual balance, or an operator's name.

**M4.** The narrative is aggregate as above. Per-student detail is rendered locally from the rules
engine and is **never sent to a model** — which is why M4's narration sits inside A-13 rather than
needing A-26, and it is the design's main payoff.

**Collection notice (existing, 5f).** The eight fields in `CollectionNoticeFacts`, no more. Already
enumerated in A-26 and already asserted by test.

This is enforced by construction — the prompt can only read the typed `facts` object — and by a
guardrail test per module that asserts a prompt built from a fixture containing a poisoned name,
email and ID contains none of them. Same technique as the existing collection-notice test, applied
module by module.

---

## 7. New assumption rows

| # | Item | Working assumption | Blocks |
|---|---|---|---|
| **A-39** 🔴 | **`LastCleared` attribution is not a semester receivable** | §9.3 buckets today's debit balances by the term each record was last rolled to, so older buckets are made of students whose record stopped there. Every screen and narrative that groups money by semester must label it "balance owed by students whose record rests on this term", not "receivable for this semester". | M2, §9.3 |
| **A-40** 🔴 | **Per-term DNR/DNC series** | Historical DNR is not reconstructible (`LastCleared` is overwritten). If the Spring-attrition question is to be answered properly, the `dashboard.dnrDnc` snapshot must be retained per term from now on and never pruned, so the series accumulates. Decision needed on retention. | M2 over time |
| **A-35** 🔴 | **AI narrates, never computes** | Every figure is computed deterministically; the model receives a fixed fact list and writes only prose, hypotheses and questions. Confirms AI-D1. | The shape of every module |
| **A-36** 🔴 | **Operator workload analysis** | Team-level only — volume, pace, automatic share, coverage. No individual is named or ranked. Behind `AI_PERSONNEL_ENABLED` and `ai.personnel.view`. | M3 |
| **A-37** 🔴 | **Per-operator comparison** | **Not built.** Naming and ranking individuals is employee performance monitoring and needs HR (and possibly union) review before it exists. Recorded so the deferral is a decision on the record, not an omission. | — |
| **A-38** 🔴 | **Red Flag student cues** | Deterministic rules from `Setting.redFlagRules`, CNP-netted, carrying the Spec §13 "analyst cue — not an eligibility determination" wording. No student-identifying data reaches a model. | M4 |

---

## 8. Phasing

| Sub-phase | Contents | Needs | Est. |
|---|---|---|---|
| **8a** | `AiModel` adapter, `dash.AiOutput` + retention sweep, module contract, the §12 output shell (badge, three sections, citation footer, regenerate), M1, M2 (incl. the §4.2 decomposition), M5 | A-13 for the prose; the deterministic half ships regardless | ~7 days |
| **8b** | M6, M3, M2a (threshold what-if) | A-36 | ~4 days |
| **8c** | M4 rules engine, `Setting.redFlagRules` admin screen, flag rendering | A-38 | ~4 days |
| **8d** | Hosting decision implemented, prompt tuning against real narratives, guardrail tests per module | A-13 signed | ~2 days |
| | **Total** | | **~17 days** |

8a is the majority of the value and needs the fewest signatures. If nothing is ever signed, 8a still
ships every figure, every chart and every confidence line — just without the prose.

---

## 9. Tests

- **Prompt content, per module** — a fixture with a poisoned name/email/ID; assert the prompt
  contains none of them (§6).
- **Dark behaviour** — with no model wired, `gather` and `render` produce the full Facts section and
  a disabled-state notice naming the assumption row; nothing throws.
- **Determinism** — `gather` called twice on one snapshot returns identical facts.
- **Facts/prose separation** — every number in the rendered output appears in the facts object. This
  is the AI-D1 guarantee made mechanical.
- **CNP netting** — a student whose CNP covers their balance is not flagged by the unfunded rule.
- **Confidence line** — a snapshot with unclassified students yields a facts block that says so.
- **Retention** — the sweep removes outputs older than `AI_RETENTION_DAYS` and nothing newer.
- **Hypothesis isolation (AI-D8)** — a fixture carrying a proposed cause in its metadata produces a
  prompt that does not contain it. The model must not be handed the answer it is meant to test.
- **Semester decomposition** — the four components of a semester bucket (§4.2) sum to that bucket's
  total, and the `XX0000` residue is reported rather than dropped.
- **Threshold what-if** — at 0.8 the M2a table reproduces the live cleared population exactly; the
  same guarantee R2's what-if has at its real boundary.

---

## 10. Open questions

| # | Question |
|---|---|
| **AI-Q1** | Will A-13 be signed for a hosted API, or should 8d target on-premises? §5.2 prices both; the answer changes nothing before 8d. |
| **AI-Q2** | Are the five M4 rules and their thresholds the right starting set (§4.1)? They are tunable, but the first set is what people will judge the feature by. |
| **AI-Q3** | Who owns the decision on A-37 (per-operator comparison) — you, HR, or the VP? Asking now avoids designing toward an answer nobody gave. |
| **AI-Q4** | Should M4's flags be visible to `student.view` holders on the profile, or confined to the Red Flag report? The profile is more useful and much harder to un-see. |
| **AI-Q5** | Is there an institutional AI-use policy this must comply with? If one exists it outranks this document. |
| ~~**AI-Q7**~~ | ~~Does `LastCleared` come to rest on Spring terms for leavers?~~ **Answered 2026-09-30** (§4.2a, FINDINGS §9.2): yes — and it is both the artefact and the attrition finding, because they are the same students. M2's headline is a retention finding. |
| **AI-Q10** | **What happened in Spring 2025?** (A-41) $651,070 across 115 students, all "never cleared and gone", where every neighbouring term is a mix. M1 and M2 must not draw a trend through it until this is explained. Highest-priority question in this list. |
| **AI-Q11** | **What is `LM2025`, and are the pre-2015 codes collectable?** (A-42) $971,656 — 7.9% of the receivable — rests on codes matching no `tblOUSA` row. `LM` fits neither naming pattern. If the old balances are dormant rather than collectable, every receivable total in the application overstates. |
| **AI-Q8** | Should the per-term DNR/DNC snapshot be retained indefinitely (A-40)? It is small, and it is the only way the Spring hypothesis ever gets a real answer. |
| **AI-Q9** | For M2a, is there an appetite to actually move the 80% threshold, or is the what-if for argument's sake? It changes how much is invested in sizing the retention side, which is the half the AR data cannot see. |
| **AI-Q6** | Retention: A-13 says 90 days. Does that apply to the stored narrative, the facts block, or both? §5.1 assumes both. |

---

## 11. Alternatives considered and rejected

**Let the model read the data directly.** Rejected per §2 — unreproducible, untestable, and one
wrong percentage costs more trust than the feature earns.

**Train a model on historical clearance outcomes to predict individual students.** Rejected for v1.
It is the most powerful option and the hardest to defend: it needs a documented training set, a
fairness review, and an honest answer to "why was I flagged" that a fitted model cannot give in
plain English. AI-D3 chose explicit rules precisely because they can.

**Skip the deterministic layer and cache model output.** Rejected — it makes the figures a
side-effect of a cache and leaves the application unable to show anything at all while AI is off,
which is its state today and possibly permanently.

**Build M7 (ad-hoc questions) first, as the demo.** Tempting, and backwards: it is the module most
likely to produce a confident wrong answer, in the phase where the application is still earning the
right to be believed.
