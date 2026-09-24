import { PublicPage, Section } from "@/components/layout/PublicPage";
import { SITE_INFO, has } from "@/content/site-info";

export const metadata = { title: "Support" };

export default function SupportPage() {
  const { support } = SITE_INFO;
  return (
    <PublicPage title="Support" intro="Getting into the application, and getting help when something looks wrong.">
      <Section heading="Trouble signing in">
        <p>
          Accounts are issued by a dashboard administrator; there is no self-registration. If you have forgotten your password, ask an administrator to issue a
          reset link — for security, passwords cannot be recovered, only replaced. After several failed attempts an account locks itself for a short period and
          then frees up on its own.
        </p>
      </Section>

      <Section heading="You can sign in, but a page is empty or unavailable">
        <p>
          A card that cannot load says <em>Unavailable</em> and shows a correlation ID rather than displaying a zero. Quote that ID when you report the problem —
          it points straight at the failed request in the logs and usually saves a round of questions.
        </p>
      </Section>

      <Section heading="A figure looks wrong">
        <p>
          Note the student ID, the page, and what you expected the figure to be. Where a number comes from the institution&apos;s own calculation, the page names
          its source; where this application computed it, the arithmetic is shown beside it. Both help considerably in working out where a discrepancy comes from.
          Questions about what a figure <em>should</em> be belong with {SITE_INFO.dataOwner}, which owns the underlying records.
        </p>
      </Section>

      <Section heading="Access to something you cannot see">
        <p>
          What each person can see follows their assigned role. If you need access to a page or a detail that is hidden from you, ask a dashboard administrator
          rather than sharing another person&apos;s account — every action is recorded against the account that performed it.
        </p>
      </Section>

      <Section heading="Contacting us">
        <p>
          {has(support.email) ? <>Email <a className="text-brand hover:underline" href={`mailto:${support.email}`}>{support.email}</a>. </> : null}
          {has(support.phone) ? <>Telephone {support.phone}. </> : null}
          {has(support.hours) ? <>Support is staffed {support.hours}.</> : null}
        </p>
        <p className="text-ink-2">
          Please do not include a student&apos;s identification number, date of birth or account details in an email. A student ID and a description of the
          problem are enough for us to find the record.
        </p>
      </Section>
    </PublicPage>
  );
}
