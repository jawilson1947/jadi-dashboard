import type { StudentProfile } from "@/server/services/students";
import { formatCurrency } from "@/lib/format";
import { StateIcon } from "./StateIcon";

/**
 * Profile header (Spec §10.2). The balance uses the A-5 vocabulary — a debit balance is money owed,
 * a credit balance is money in the student's favour — and never the word "payments".
 *
 * The photo is fetched from an authenticated route (A-27); a missing file is the normal case and
 * shows a neutral placeholder rather than a broken image.
 */
export function StudentHeader({ profile, photoHref }: { profile: StudentProfile; photoHref: string | null }) {
  const owes = profile.accountBalance > 0;
  return (
    <section className="card flex flex-wrap items-start gap-6" aria-label="Student summary">
      <div className="h-28 w-24 shrink-0 overflow-hidden rounded-md border border-border bg-surface-2 flex items-center justify-center">
        {photoHref ? (
          // eslint-disable-next-line @next/next/no-img-element -- the route streams from a file share; Next's optimizer would need a loader and would cache a student photo.
          <img src={photoHref} alt={`Photograph of ${profile.firstName} ${profile.lastName}`} className="h-full w-full object-cover" />
        ) : (
          <span className="text-ink-3 text-xs text-center px-2">No photo</span>
        )}
      </div>

      <dl className="grid gap-x-8 gap-y-2 sm:grid-cols-3 text-sm flex-1">
        <div>
          <dt className="text-ink-3 text-xs">Student ID</dt>
          <dd className="tabular">{profile.idnumber}</dd>
        </div>
        <div>
          <dt className="text-ink-3 text-xs">PID</dt>
          <dd className="tabular">{profile.pid}{profile.pidRevealed ? "" : " (masked)"}</dd>
        </div>
        <div>
          <dt className="text-ink-3 text-xs">Classification</dt>
          <dd>{profile.classification}</dd>
        </div>
        <div>
          <dt className="text-ink-3 text-xs">Enrollment</dt>
          <dd className="flex items-center gap-2">
            <StateIcon state={profile.state} />
            {profile.enrolledCurrentTerm ? (profile.clearedCurrentSession ? "Enrolled, cleared" : "Enrolled, not cleared") : "Not currently enrolled"}
          </dd>
        </div>
        <div>
          <dt className="text-ink-3 text-xs">Last cleared</dt>
          <dd>{profile.lastClearedLabel}</dd>
        </div>
        <div>
          <dt className="text-ink-3 text-xs">{owes ? "Debit balance (owed)" : profile.accountBalance < 0 ? "Credit balance" : "Balance"}</dt>
          <dd className={`tabular font-medium ${owes ? "text-critical" : ""}`}>{formatCurrency(Math.abs(profile.accountBalance))}</dd>
        </div>
      </dl>
    </section>
  );
}
