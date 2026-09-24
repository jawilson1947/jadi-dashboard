import { PublicPage, Section } from "@/components/layout/PublicPage";
import { SITE_INFO, has } from "@/content/site-info";

export const metadata = { title: "Privacy policy" };

/**
 * Every statement here describes behaviour that is actually implemented (audit log, PII masking,
 * read-only access, session cookie, no third-party analytics). Nothing is aspirational. If the
 * application changes so that one of these sentences stops being true, change the sentence.
 */
export default function PrivacyPage() {
  return (
    <PublicPage title="Privacy policy" intro={`How ${SITE_INFO.appName} handles personal information. Last reviewed ${SITE_INFO.policyLastReviewed}.`}>
      <Section heading="Whose information this covers">
        <p>
          Two groups. <strong>Students</strong>, whose billing and enrollment records this application displays to authorised staff. And <strong>staff users</strong>,
          whose account details and activity in the application are recorded.
        </p>
      </Section>

      <Section heading="Student information">
        <p>
          {SITE_INFO.appName} reads student records — name, identification number, contact details, enrollment, account balances and transaction history — from{" "}
          {SITE_INFO.institution}&apos;s existing student-billing systems. It does not collect anything from students directly, and it does not write back to those
          systems: access is read-only.
        </p>
        <p>
          Sensitive fields are masked by default. A date of birth shows as a year, and identifying numbers are hidden, until a user with the specific permission
          chooses to reveal them — and revealing is itself recorded, with who did it and when. The control says so plainly before it is used.
        </p>
      </Section>

      <Section heading="Staff user information">
        <p>
          For each account: username, display name, email address, role, and the password held as a one-way hash that cannot be read back. Sign-ins, failed
          sign-in attempts, searches, record views and administrative changes are written to an audit log, which records the action and its context — never the
          contents of what was viewed or exported.
        </p>
      </Section>

      <Section heading="Why the audit log exists">
        <p>
          Because this application shows real people&apos;s financial circumstances. The log makes access accountable: it answers who looked at a record and when,
          which is what allows the institution to grant staff the access they need to do their work. It is not used to measure anybody&apos;s productivity.
        </p>
      </Section>

      <Section heading="Cookies">
        <p>
          One cookie, holding the signed session that keeps a user logged in. It is HTTP-only, so page scripts cannot read it, and it expires when the session
          ends. There are no advertising, tracking or analytics cookies, and no third-party analytics service of any kind is embedded in these pages.
        </p>
      </Section>

      <Section heading="Where the information goes">
        <p>
          Nowhere outside {SITE_INFO.institution}. The application runs on institutional infrastructure and reads institutional databases; personal data is not
          sold, shared with advertisers, or sent to any third party for their own purposes. Where an artificial-intelligence feature is offered — for instance
          drafting a collection notice — it is off unless the institution has explicitly enabled it, and the page will say so at the point of use.
        </p>
      </Section>

      <Section heading="How long it is kept">
        <p>
          Student records live in the institution&apos;s billing systems and follow that retention schedule — this application keeps no separate archive of them.
          Audit and account records are retained by the institution for as long as its own policy requires.
        </p>
      </Section>

      <Section heading="Your rights and who to ask">
        <p>
          Students have rights over their education records under applicable law, including access and correction. Those requests go to{" "}
          {SITE_INFO.privacyContact.office}, which holds the records — not to this application, which only displays them.
          {has(SITE_INFO.privacyContact.email) ? ` You can reach that office at ${SITE_INFO.privacyContact.email}.` : ""}
        </p>
        <p>Staff who believe their account has been misused, or who spot information that looks wrong, should raise it through the support page.</p>
      </Section>
    </PublicPage>
  );
}
