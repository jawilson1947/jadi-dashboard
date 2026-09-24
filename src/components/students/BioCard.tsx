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
 * as currency. What it represents is still open (A-29) and the card labels it as unexplained rather
 * than guessing.
 */
export function BioCard({ profile, canReveal, revealHref, hideHref }: { profile: StudentProfile; canReveal: boolean; revealHref: string; hideHref: string }) {
  const a = profile.address;
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
        <Field label="CNP" value={formatCurrency(profile.cnp)} hint="Source column tblStudent.CNP — meaning not yet confirmed (A-29)" />
        <Field label="Last cleared" value={profile.lastClearedLabel} />
        <Field label="Cleared this session" value={profile.clearedCurrentSession ? "Yes" : "No"} />
        <Field label="Cleared on" value={formatIsoDateSafe(profile.clearedOn)} />
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
