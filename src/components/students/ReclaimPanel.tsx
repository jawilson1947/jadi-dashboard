import type { ReclaimView, ProposedRecord } from "@/server/services/reclaim";

/**
 * The not-found card, when the search was by ID (docs/STUDENT-RECLAIM-PLAN.md §§3–5).
 *
 * Today a miss is one message for every cause. A mistyped ID and a student the nightly loader
 * skipped look identical, and only one of them has a fix — so this distinguishes them, explains
 * which source record is missing, and (for an administrator) offers to create the record.
 */
export function ReclaimPanel({
  view,
  proposed,
  canCreate,
  notice = null,
}: {
  view: ReclaimView;
  proposed: ProposedRecord[];
  canCreate: boolean;
  /** Why a previous attempt was refused, carried back through the redirect. */
  notice?: string | null;
}) {
  if (view.kind === "already-present") {
    // The search missed them but the record exists — almost always because tblStudent stores the id
    // padded and the search compares text while the diagnostic compares numerically.
    return (
      <div className="card space-y-2">
        <p className="text-sm">
          Student <strong>{view.idnumber}</strong> is already in tblStudent — the search did not match because the
          stored ID is formatted differently.
        </p>
        <p className="text-sm">
          <a href={`/students/${encodeURIComponent(view.idnumber)}`} className="underline hover:no-underline">
            Open this student&apos;s profile
          </a>
        </p>
      </div>
    );
  }

  if (view.kind === "not-in-jenzabar") {
    return (
      <div className="card space-y-2">
        <p className="text-sm">
          No student with ID <strong>{view.idnumber}</strong> in tblStudent, and no record for that ID in Jenzabar
          student_master either.
        </p>
        <p className="text-xs text-ink-3">
          There is nothing to reclaim for an ID Jenzabar does not know about — check the number. IDs are matched
          numerically, so leading zeros make no difference.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {notice ? (
        <div role="status" className="rounded-md border border-warning bg-surface-1 px-4 py-2 text-sm">
          <span aria-hidden>⚠</span> {notice}
        </div>
      ) : null}

      <div className="card">
        <p className="text-sm">
          No student with ID <strong>{view.idnumber}</strong> in tblStudent — but Jenzabar has a record for them.
        </p>
      </div>

      <section className="card" aria-labelledby="why-missing">
        <h2 id="why-missing" className="text-sm font-medium text-ink-2">
          Why this record is missing
        </h2>
        <ul className="mt-3 space-y-2">
          {view.artifacts.map((a) => (
            <li key={a.key} className="flex items-start gap-3 text-sm">
              <span aria-hidden className={a.found ? "text-success" : "text-warning"}>
                {a.found ? "✓" : "✗"}
              </span>
              <span className="sr-only">{a.found ? "Found:" : "Missing:"}</span>
              <span className="min-w-56">{a.label}</span>
              <span className="text-ink-2">{a.detail ?? (a.found ? "found" : "missing")}</span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-ink-3 mt-3 max-w-3xl">
          The nightly load joins all four of these, so a student missing any one of them is skipped without a message.
          {view.diagnostic && view.diagnostic.addressRows > 0 && view.diagnostic.qualifyingAddressRows === 0 ? (
            <>
              {" "}
              This student <strong>has</strong> an address — under a code the loader does not read. If that code is in
              routine use, the fix is the loader&apos;s filter rather than this one record.
            </>
          ) : null}
        </p>
      </section>

      {view.blocked ? (
        <div role="status" className="rounded-md border border-warning bg-surface-1 px-4 py-3 text-sm">
          <span aria-hidden>⚠</span> {view.blockedReason} Fix the record in Jenzabar first.
        </div>
      ) : canCreate ? (
        <section className="card" aria-labelledby="confirm-add">
          <h2 id="confirm-add" className="text-sm font-medium text-ink-2">
            Add this record to tblStudent?
          </h2>
          <p className="text-xs text-ink-3 mt-1">These values will be written:</p>
          <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm" style={{ gridTemplateColumns: "max-content 1fr" }}>
            {proposed.map((f) => (
              <div key={f.label} className="contents">
                <dt className="text-ink-2">{f.label}</dt>
                <dd className={f.missing ? "text-ink-3" : ""}>
                  {f.value}
                  {f.missing ? <span className="text-xs"> (no source record)</span> : null}
                </dd>
              </div>
            ))}
          </dl>

          {view.hasGaps ? (
            <p role="status" className="mt-3 rounded-md border border-warning bg-surface-1 px-3 py-2 text-xs">
              <span aria-hidden>⚠</span> Source records are missing, so this row will be incomplete. It will be flagged
              for follow-up and shown as incomplete on the student&apos;s profile. Fixing Jenzabar first is the cleaner
              option.
            </p>
          ) : null}

          {/* POST, not a link: state-changing, and it must not be reachable by prefetch or history. */}
          <form method="post" action="/api/v1/students/reclaim" className="mt-4 flex items-center gap-3">
            <input type="hidden" name="id" value={view.idnumber} />
            {view.hasGaps ? <input type="hidden" name="allowPartial" value="1" /> : null}
            <button type="submit" className="rounded-md border border-brand text-brand px-4 py-2 text-sm hover:bg-brand-track">
              {view.hasGaps ? "Add incomplete record" : "Add record"}
            </button>
            <span className="text-xs text-ink-3">Creating a record is recorded in the audit log.</span>
          </form>
        </section>
      ) : (
        <div className="card text-sm text-ink-2">
          This record can be created from what Jenzabar holds, but that needs the{" "}
          <strong>create student records</strong> permission. An administrator can do it, or grant it to you.
        </div>
      )}
    </div>
  );
}
