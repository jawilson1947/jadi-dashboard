import Link from "next/link";
import type { StudentProfile } from "@/server/services/students";
import { formatCurrency, formatIsoDateSafe } from "@/lib/format";

/**
 * Bio Spec 1.3 — the data form.
 *
 * Date of birth is the one masked field (A-29): everyone with student.view sees the birth year,
 * and only a holder of student.pii.view can reveal the full date. The reveal is a link, not a
 * toggle, because it is an audited act — and the control says so, so nobody is surprised later.
 *
 * CNP is a `money` column on tblStudent (discovery 2026-09-17), not an identifier, so it is rendered
 * as currency. It stands for Credits Not Posted (J. Wilson, 2026-09-24) — aid or payments awarded
 * but not yet applied — and the card uses that name rather than the column name.
 */
export function BioCard({
  profile,
  canReveal,
  revealHref,
  hideHref,
  canUpdateSemester = false,
  semesterOutcome = null,
  canCheckClearance = false,
  clearanceOutcome = null,
}: {
  profile: StudentProfile;
  canReveal: boolean;
  revealHref: string;
  hideHref: string;
  /** The stored semester is missing or unresolvable AND the caller may set it (A-33). */
  canUpdateSemester?: boolean;
  /** Result of the update the user just ran, carried back through the redirect. */
  semesterOutcome?: { status: string; message: string } | null;
  /** The record says not cleared AND the caller may reconcile it against the source (A-34). */
  canCheckClearance?: boolean;
  /** Result of the clearance check the user just ran, carried back through the redirect. */
  clearanceOutcome?: { status: string; message: string } | null;
}) {
  const a = profile.address;
  // Step 4: when Jenzabar holds no current-term registration, the label itself carries the answer.
  // Leaving it reading "No semester on record" would make a button that appears to do nothing.
  const semesterLabelText =
    semesterOutcome?.status === "no_registration" ? "No Semester Info found" : profile.lastClearedLabel;
  const cityLine = [a.city, a.stateCode].filter(Boolean).join(", ");
  return (
    <section className="card" aria-label="Student bio">
      <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-3 text-sm">
        <Field label="Last name" value={profile.lastName} />
        <Field label="First name" value={profile.firstName} />
        <Field label="Middle name" value={profile.middleName ?? "—"} />

        <div>
          <dt className="text-ink-3 text-xs">Date of birth</dt>
          <dd className="flex items-center gap-2">
            <span className="tabular">{profile.dob}</span>
            {canReveal ? (
              <Link href={profile.dobRevealed ? hideHref : revealHref} className="text-xs underline hover:no-underline">
                {profile.dobRevealed ? "Hide" : "Reveal (recorded)"}
              </Link>
            ) : null}
          </dd>
        </div>

        <Field label="Email" value={profile.email || "—"} />
        <Field label="Phone" value={profile.phone ?? "—"} />

        <div className="sm:col-span-2">
          <dt className="text-ink-3 text-xs">Home address</dt>
          <dd>
            {a.address ?? "—"}
            {cityLine ? <><br />{cityLine} {a.zipCode ?? ""}</> : null}
            {a.country ? <><br />{a.country}</> : null}
          </dd>
        </div>

        <Field label="Account balance" value={formatCurrency(profile.accountBalance)} hint={profile.accountBalance > 0 ? "Debit balance — money owed" : profile.accountBalance < 0 ? "Credit balance — in the student's favour" : undefined} />
        <Field label="Credits Not Posted" value={formatCurrency(profile.cnp)} hint="Aid or payments awarded but not yet applied to the account (tblStudent.CNP)" />
        <div>
          <dt className="text-ink-3 text-xs">Last Semester</dt>
          <dd>{semesterLabelText}</dd>
          {semesterOutcome ? (
            <p role="status" className={`text-xs mt-1 ${semesterOutcome.status === "updated" ? "text-ink-2" : "text-warning"}`}>
              {semesterOutcome.message}
            </p>
          ) : null}
          {canUpdateSemester && semesterOutcome?.status !== "no_registration" ? (
            // POST, not a link: it writes to source data, and must not be reachable by prefetch.
            <form method="post" action="/api/v1/students/semester" className="mt-2 no-print">
              <input type="hidden" name="id" value={profile.idnumber} />
              <button
                type="submit"
                className="rounded-md border border-brand text-brand px-3 py-1 text-xs hover:bg-brand-track"
                title="Set this student's semester from their current-term registration in Jenzabar"
              >
                Update Semester
              </button>
            </form>
          ) : null}
        </div>
        <div>
          <dt className="text-ink-3 text-xs">
            {profile.currentTermRecord
              ? `Cleared for ${profile.lastClearedLabel} (current)`
              : profile.lastCleared
                ? `Cleared for ${profile.lastClearedLabel}`
                : "Clearance flag"}
          </dt>
          <dd>{profile.clearedCurrentSession ? "Yes" : "No"}</dd>
          {profile.clearedCurrentSession && !profile.currentTermRecord ? (
            <p className="text-xs text-ink-3 mt-0.5">
              This clearance belongs to the semester named above, which is not the current one.
            </p>
          ) : null}
          {clearanceOutcome ? (
            <p
              role="status"
              className={`text-xs mt-1 ${clearanceOutcome.status === "cleared" ? "text-ink-2" : "text-warning"}`}
            >
              {clearanceOutcome.message}
            </p>
          ) : null}
          {canCheckClearance ? (
            // POST, not a link: it writes to source data, and must not be reachable by prefetch.
            <form method="post" action="/api/v1/students/clearance-check" className="mt-2 no-print">
              <input type="hidden" name="id" value={profile.idnumber} />
              <button
                type="submit"
                className="rounded-md border border-brand text-brand px-3 py-1 text-xs hover:bg-brand-track"
                title="Look for a clearance action for this student in the current semester, and mark the record cleared if one exists"
              >
                Check Clearance
              </button>
            </form>
          ) : null}
        </div>
        <Field
          label="Cleared on"
          value={profile.clearedOn ? formatIsoDateSafe(profile.clearedOn) : (profile.clearedOnRaw ?? (profile.clearedCurrentSession ? "Not recorded" : "—"))}
          hint={profile.clearedOnRaw ? "Stored in an unrecognised format — shown as it appears in the source column" : undefined}
        />
      </dl>
    </section>
  );
}

function Field({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <dt className="text-ink-3 text-xs">{label}</dt>
      <dd>{value}</dd>
      {hint ? <dd className="text-xs text-ink-3">{hint}</dd> : null}
    </div>
  );
}
