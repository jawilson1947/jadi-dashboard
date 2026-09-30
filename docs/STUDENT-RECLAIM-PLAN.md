# STUDENT-RECLAIM-PLAN.md — Reclaiming a student missing from tblStudent

Status: **Draft for review** · Author: Claude, 2026-09-29 · Owner: J. Wilson
Baseline: the five steps specified by J. Wilson, 2026-09-29 · Source script: `db/sql/CreateNewStudentFromJenzabar.sql`
Companions: `docs/STUDENT-PLAN.md` (Phase 5), `ASSUMPTIONS.md` (A-3, A-21, A-29), `db/grants/jadi_dash.sql`

Student Lookup by ID currently ends at "No students match that search." This adds a path from that
dead end to a usable record: explain *why* the student is missing, offer to reclaim them, write the
record, and land on their Bio Card.

---

## 0. Decisions taken (J. Wilson, 2026-09-29)

| # | Decision | Effect |
|---|---|---|
| S-D1 | **The insert goes through a `dbo`-owned stored procedure; the app holds `EXECUTE` and nothing else.** | The `DENY ... ON SCHEMA::dbo` in `db/grants/jadi_dash.sql` **stays**. See §1 — this is the decision the rest of the feature hangs on. |
| S-D2 | **Insert with nulls where a source artifact is missing, and flag the record.** | The reclaim works in exactly the cases the user reached for it; the gaps become a visible, reportable debt rather than an invisible one. See §4.3. |
| S-D3 | **Use the real email from `name_master`; keep the batch script's address logic.** | Fixes the dead-letter problem for the mail-merge reports without changing address selection. See §4.4. |
| S-D4 | **New `student.create` permission, ADMINISTRATOR only by default.** | Grantable per user, but not part of the OPERATOR set. Every reclaim is audited. |

---

## 1. The part that matters most: how the write is authorised (S-D1)

`db/grants/jadi_dash.sql` today:

```sql
DENY INSERT, UPDATE, DELETE, ALTER ON SCHEMA::dbo TO jadi_dash;  -- provably cannot modify OUSA/Jenzabar data
```

That line is why "the application never writes source data" has been a fact about the grants rather
than a promise about the code. **It does not change.**

Instead, one `dbo`-owned procedure becomes the only door:

```
jadi_dash ──EXECUTE──► dbo.usp_ReclaimStudentFromJenzabar (owned by dbo)
                              │
                              │ ownership chaining: permissions on the referenced
                              │ table are not evaluated, so the DENY is not consulted
                              ▼
                       dbo.tblStudent  ── INSERT of exactly one row
```

Why this shape rather than a table-level `GRANT INSERT`:

- The DENY stays in force for **ad-hoc SQL**. If a future code path — or a mistake in one — tries
  `INSERT INTO dbo.tblStudent` directly, it still fails. The app gains the ability to perform *this
  operation*, not the ability to write the table.
- The procedure validates its own inputs and owns the business rules, so the rules cannot be
  bypassed by calling it differently.
- It is a single object a DBA can read, review and revoke. `GRANT EXECUTE` is one line to undo.

**Procedure contract** (`db/production/10_usp_reclaim_student.sql`, run by a sysadmin):

```sql
CREATE PROCEDURE dbo.usp_ReclaimStudentFromJenzabar
  @id_num        varchar(50),
  @actor         varchar(200),        -- dash.[User].email, for the source-side audit row
  @allow_partial bit = 0              -- S-D2: caller must opt in to inserting with gaps
AS
-- Reads name_master / biograph_master / address_master for THIS id only.
-- Refuses when: the id is absent from jadi.dbo.student_master;
--               the id already exists in dbo.tblStudent;
--               name_master is missing (no defensible identity);
--               artifacts are missing and @allow_partial = 0.
-- Inserts exactly one row, inside a transaction, and returns the outcome plus
-- which artifacts were found, so the application never has to infer what happened.
```

It refuses rather than silently doing nothing, and it re-checks existence **inside** the transaction
so two operators clicking at once cannot produce a duplicate or a confusing error.

Open item **S-Q1**: the procedure writes an audit row on the source side as well as in `dash`. That
needs a table to write to — either a new `dash.SourceWriteLog` (the app's own schema, so no new
grant) or an existing OUSA audit table if one exists. Recommend `dash`, so the procedure's only
`dbo` privilege is the one insert.

---

## 2. The flow, end to end

```
Student Lookup → by Student ID → exact ID, no match in tblStudent
        │
        ▼
┌─ "No students match that search" ────────────────────────────────────────────┐
│  No student with ID 0123456 in tblStudent.                        [Step 1]   │
│                                                                              │
│  ┌ Why this record is missing ──────────────────────────────── [Step 2] ──┐  │
│  │  In Jenzabar student_master          ✓ found                           │  │
│  │  Name record (name_master)           ✓ found — WILSON, JAMES           │  │
│  │  Biographical (biograph_master)      ✗ missing — no DOB, SSN, gender   │  │
│  │  Address with LHP / CUR / EML code   ✗ none — 2 rows, codes PRM, BIL   │  │
│  │                                                                        │  │
│  │  The nightly load skips this student because it inner-joins all four.  │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  ┌ Add this record to tblStudent? ─────────────────────────────  [Step 3] ─┐ │
│  │  These values will be written:                                          │ │
│  │    Last / First / Middle   WILSON / JAMES / (none)                      │ │
│  │    Email                   jwilson@oakwood.edu      ← real, not a        │ │
│  │                                                        placeholder      │ │
│  │    Address / City / State  (blank — no qualifying address row)          │ │
│  │    DOB / SSN / Gender      (blank — no biograph record)                 │ │
│  │    Balance / cCode         0.00 / NA                                    │ │
│  │    LastCleared / EX_Period XX0000 / XX0000                              │ │
│  │                                                                         │ │
│  │  ⚠ Two source records are missing, so this row will be incomplete and   │ │
│  │    flagged for follow-up. Fixing Jenzabar first is the cleaner option.  │ │
│  │                                                                         │ │
│  │             [ Add incomplete record ]   [ Cancel ]                      │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────┘
        │  Yes                                              [Steps 4 and 5]
        ▼
  usp_ReclaimStudentFromJenzabar → redirect to /students/0123456 → Bio Card,
  with a banner: "Record reclaimed just now. Two fields could not be filled."
```

The confirm step shows **the actual values**, not a generic "are you sure". A person approving a
write to source data should be able to see what they are approving.

---

## 3. Step 1 — the not-found card

Today the empty state is one line for every kind of miss. It needs to distinguish three:

| Case | What the card says | Offers reclaim? |
|---|---|---|
| Searched by **name**, no match | Today's message, unchanged | No — a name is not an identity to reclaim |
| Searched by **ID**, **not in Jenzabar either** | "No student with ID *x* in tblStudent, and no record in Jenzabar student_master either. Check the ID." | No — there is nothing to reclaim from |
| Searched by **ID**, **present in Jenzabar** | The diagnostic panel (§4) plus the offer | Yes |

The distinction matters: a mistyped ID and a genuinely skipped student look identical today, and
only one of them has a fix.

This costs one cheap lookup — `SELECT 1 FROM jadi.dbo.student_master WHERE ID_NUM = @id` — and it
runs **only** on an exact-ID search that returned nothing, never on a name search and never on a
search that found something.

---

## 4. Step 2 — the diagnostic

### 4.1 A per-student variant of the script

`DiagnoseMissingStudents.sql` (the script from this conversation) answers "how many, and why" across
the whole candidate set. This needs "why *this one*", which is a different query — four existence
checks and the address-code list for a single bound id. The two live side by side:

| | Purpose | Where |
|---|---|---|
| `DiagnoseMissingStudents.sql` | Set-wide counts per cause; the operational picture | `db/sql/` (a report candidate for Phase 7b) |
| `QS.reclaimDiagnostic` | Four existence checks for one bound id | `src/server/repositories/mssql/student-sql.ts` |

The per-student version is sub-second, so it runs inline with no snapshot.

### 4.2 What it reports

One row per artifact, each `found` / `missing`, with the detail that makes it actionable:

- **`student_master`** — present at all? If not, stop; there is nothing to reclaim.
- **`name_master`** — the name that would be written.
- **`biograph_master`** — DOB, gender, SSN presence (values masked per A-29; presence is what matters here).
- **`address_master`** — how many rows exist, **which `ADDR_CDE` values they carry**, and whether any
  matches `%LHP%` / `%CUR%` / `%EML%`.

The address-code list is the single most useful line on the panel. The common cause is not "no
address" but "an address under a code the load does not look for", and naming the code someone is
actually using points at the real fix — which may be the loader's `WHERE` clause rather than this
student's record.

### 4.3 Missing artifacts and what gets written (S-D2)

| Missing | Effect on the insert | Shown as |
|---|---|---|
| `student_master` | Refused — nothing to reclaim | Not offered |
| `name_master` | **Refused.** A student record with no defensible name is worse than none | Blocked, with the reason |
| `biograph_master` | `dob`, `gender`, `SSN` written NULL | Warning, listed in the confirm panel |
| No qualifying address | `Address`, `City`, `StateCode`, `zipcode`, `phone`, `Country` written blank | Warning, listed in the confirm panel |

A record written with gaps is **flagged**, not silently incomplete: `dash.ReclaimedStudent` records
the id, who reclaimed it, when, and which artifacts were absent. Two things read that table — the
Bio Card banner, and a Phase 7b report of reclaimed-but-incomplete records, so the debt is
collectable rather than lost.

### 4.4 Field mapping (S-D3)

Same as `CreateNewStudentFromJenzabar.sql` except where noted:

| Column | Value | Note |
|---|---|---|
| `idnumber` | `CAST(ID_NUM AS varchar)` | |
| `lastname` / `firstname` / `midname` | `rtrim`, with the script's `'nfm'` first-name fallback | |
| `email` | **`name_master.EMAIL_ADDRESS`** | **Differs from the batch script**, which hard-codes `'none@oakwood.edu'` while computing the real value and discarding it. R4, R5 and R6 export email for mail merge, so a placeholder is a letter that never arrives |
| `Address` … `Country` | The script's logic and its `rows = 1` pick | Unchanged per S-D3 |
| `AccountBalance` | `0.00` | The nightly OUSA process owns this |
| `cCode` | `'NA'` | Will surface on R1 as unclassified — correct, and worth knowing |
| `LastCleared` / `EX_Period` | `'XX0000'` | Never-cleared sentinel (A-16) |
| `ClearedCurrentSession` | `0` | |
| `SSN` / `dob` / `gender` | `format_ssn(SSN)`, `BIRTH_DTE`, `GENDER` | Written, never displayed except under A-29's rules |
| `BankAccount` | `''` | |
| `datecreated` / `datechanged` | `GETDATE()` | |

Two consequences to state on the page rather than let people discover:

- A reclaimed student appears on **R1 Unclassified Students** (`cCode = 'NA'`), which is correct —
  they *are* unclassified — and will inflate that report until the nightly process assigns a class.
- `'nfm'` as a first name is a marker, not a name. It should be visible on the Bio Card as such.

---

## 5. Steps 3–5 — confirm, insert, land on the Bio Card

**Step 3.** A POST form, not a link: it is state-changing and must not be reachable by prefetch,
browser history or a pasted URL. It carries the id and an `allowPartial` flag that is only set when
the user clicked the button that says so. The button's label changes with the situation — *Add
record* when everything is present, *Add incomplete record* when it is not — because a generic
"Confirm" invites clicking past a warning.

**Step 4.** One call to `usp_ReclaimStudentFromJenzabar`. The procedure is the transaction boundary.
Outcomes the route distinguishes: `inserted`, `already_exists` (someone else got there first — treat
as success and go to the Bio Card), `not_in_jenzabar`, `no_name_record`, `partial_not_allowed`.
Anything else is a failure with a correlation id and no partial state.

**Step 5.** Redirect to `/students/{id}` — the existing Bio Card, unchanged — with a banner naming
what could not be filled. The banner reads from `dash.ReclaimedStudent`, so it persists rather than
being a one-shot flash message: the next person to open that profile also needs to know the record
is incomplete.

---

## 6. Audit (S-D4)

This is the first application write to source data, so it is audited on both sides:

- `dash.AuditEvent`, new action **`student.reclaim`** — actor, id, artifacts found and missing,
  `allowPartial`, outcome, correlation id.
- A row in `dash.ReclaimedStudent`, which is also the permanent flag for §4.3.
- The procedure records its own row, so a write is provable from the database alone even if the
  application's log is unavailable.

The diagnostic itself is a student-level read and is audited as `student.search` with the id, as the
existing lookup already does.

---

## 7. Files

```
new   db/production/10_usp_reclaim_student.sql     procedure + GRANT EXECUTE (DBA runs this)
new   db/migrations/005_reclaim.sql                dash.ReclaimedStudent
new   src/server/services/reclaim.ts               diagnostic, confirm model, insert, outcomes
new   src/components/students/ReclaimPanel.tsx     the not-found card's diagnostic + confirm
new   src/app/api/v1/students/reclaim/route.ts     POST, student.create, CSRF, audited
edit  src/server/repositories/mssql/student-sql.ts QS.reclaimDiagnostic, QS.reclaimExecute
edit  src/server/repositories/types.ts             DataProvider: getReclaimDiagnostic, reclaimStudent
edit  src/server/repositories/mock/provider.ts     both, so the flow is demoable with no database
edit  src/server/authz/permissions.ts              student.create
edit  src/server/audit/audit.ts                    student.reclaim
edit  src/app/(app)/students/page.tsx              three-way empty state (§3)
edit  src/app/(app)/students/[id]/page.tsx         incomplete-record banner
new   db/sql/DiagnoseMissingStudents.sql           the set-wide script from this conversation
new   tests/unit/reclaim.test.ts                   outcome mapping, field mapping, partial rules
new   tests/integration/reclaim.test.ts            full flow against the mock provider
```

**Sizing: ≈ 4 days**, plus DBA time to review and run the procedure. The procedure is the long pole
and is not on the application's critical path — §§3–4 (the diagnostic and the explanation) are
useful on their own and can ship first, with the offer hidden until the grant exists.

---

## 8. Recommended sequence

1. **Diagnostic only** — three-way empty state and the "why this record is missing" panel. No write,
   no new grant, no procedure. This alone converts a dead end into an answer, and it is what most
   people needed in the first place.
2. **Procedure reviewed and installed** by the DBA, with `GRANT EXECUTE` to `jadi_dash`.
3. **The offer, the insert, and the Bio Card banner.**

Step 1 is genuinely useful without steps 2 and 3, and shipping it first means the write path is
built against real diagnostic output rather than assumptions about it.

---

## 7a. Implementation status (2026-09-29)

Built; `npm run typecheck` and `npm run lint` clean. **Not executed** — vitest cannot run in this
session's Linux VM against a Windows `node_modules`.

### Shipped inert by design

The application code is complete, but the write **cannot happen** until a DBA runs
`db/production/10_usp_reclaim_student.sql`. Until then `reclaimStudent` throws
`DataSourceUnavailableError`, the route answers 503 with the reason, and the page still shows the
full diagnostic — which is the half most people needed. That is the §8 sequence enforced by the
code rather than by discipline: stage 1 is live now, stage 3 switches on with a `GRANT`.

### Deviations from this plan

**`dash.ReclaimedStudent` is written by the procedure**, inside the insert transaction, rather than
by the application afterwards. A reclaim therefore cannot exist without its log row. The service
keeps a fallback write for stores that are not the ousadb `dash` schema (memory mode, tests), so the
incomplete-record banner behaves identically there.

**A refusal is a 200, not an error.** `partial_not_allowed`, `no_name_record` and `not_in_jenzabar`
are outcomes the page explains, not failures of the request. Only an uninstalled procedure is a 503.

**The mock provider generates the four gap shapes** deterministically from the id, including the one
that matters most — an address that exists under a code the loader ignores — so every branch is
demonstrable with no database.

### Where things live

| | |
|---|---|
| Procedure (DBA runs) | `db/production/10_usp_reclaim_student.sql` |
| Set-wide diagnostic | `db/sql/DiagnoseMissingStudents.sql` |
| Flag table | `db/migrations/005_reclaim.sql` |
| Per-student SQL | `QS.reclaimDiagnostic`, `QS.reclaimExecute` in `student-sql.ts` |
| Service | `src/server/services/reclaim.ts` |
| Route | `src/app/api/v1/students/reclaim/route.ts` |
| UI | `src/components/students/ReclaimPanel.tsx`, `students/page.tsx`, `students/[id]/page.tsx` |
| Tests | `tests/unit/reclaim.test.ts`, `tests/integration/reclaim.test.ts` |

### Before this can be trusted

1. `npm test` — nothing has executed.
2. A DBA reviews and runs `10_usp_reclaim_student.sql`, then the verification block at its foot:
   `jadi_dash` must still show **SELECT only** on `dbo.tblStudent`, and a bare
   `INSERT INTO dbo.tblStudent` must still be refused. If either check fails, the grant is wrong
   and the capability is wider than this plan describes.
3. `npm run db:migrate` for `dash.ReclaimedStudent`.
4. Reclaim one known-missing student on **staging** and confirm the row, the flag, the audit event
   and the Bio Card banner.

**New open question S-Q6:** the procedure's column list mirrors the batch script, which omits `pid`
— a NOT NULL `int`. The batch script runs in production, so `pid` must be IDENTITY or carry a
DEFAULT, but discovery never captured that. If the procedure fails with *"Cannot insert the value
NULL into column 'pid'"*, that assumption is wrong and the column needs handling.

## 9. Open questions

| # | Question | Why it matters | Answer |
|---|---|---|---|
| **S-Q1** | Where does the procedure write its source-side audit row — a new `dash.SourceWriteLog`, or an existing OUSA audit table? | Recommend `dash`, so the procedure's only `dbo` privilege is the one insert into `tblStudent`. | ______ |
| **S-Q2** | Should the address-code finding feed back into the **loader**? If students are routinely skipped because their address carries a code outside `%LHP%`/`%CUR%`/`%EML%`, the fix is the `WHERE` clause, not one reclaim at a time. | Reclaiming one student at a time treats the symptom. The panel will show you the codes; the question is whether anyone acts on them. | ______ |
| **S-Q3** | `'nfm'` as the first-name fallback — keep it, or write NULL? | It is a marker masquerading as a name. It will appear on mail merges and collection letters as though it were real. | ______ |
| **S-Q4** | Should a reclaimed record be **excluded from the mail-merge reports** until its gaps are filled? | A record with a blank address cannot receive a letter, and R4/R5/R6 would export it as though it could. | ______ |
| **S-Q5** | Does the same reclaim path need to exist for a student found in `tblStudent` but **stale** — name or address changed in Jenzabar since? The current loader never revisits an existing record (`EXCEPT` on identity alone). | A different feature with the same shape. Out of scope here, but the procedure could take an `@update` mode later. | ______ |

---

## 10. Risks

- **This is the first write to source data.** The stored-procedure shape keeps the guarantee narrow
  and provable, but the guarantee is now "the app can perform one reviewed operation" rather than
  "the app cannot write". Say so plainly in `ASSUMPTIONS.md` as a new signed row, not as a footnote
  to A-21.
- **Reclaiming masks a loader defect.** Every reclaim is evidence that the nightly script's filters
  are too narrow. If the button becomes routine, the answer is S-Q2, not more clicking.
- **A reclaimed record is incomplete by construction** in exactly the cases it is most needed. The
  flag, the banner and the Phase 7b report are what stop that becoming invisible — if any of the
  three is dropped, the feature quietly degrades the data it was meant to repair.
- **`cCode = 'NA'`** puts every reclaimed student onto R1. That is correct behaviour, but R1's counts
  will move for a reason that has nothing to do with Jenzabar classification, and the report should
  say so.
