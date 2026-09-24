import { PublicPage, Section } from "@/components/layout/PublicPage";
import { SITE_INFO } from "@/content/site-info";

export const metadata = { title: "About us" };

export default function AboutPage() {
  return (
    <PublicPage title="About us" intro={`What ${SITE_INFO.appName} is, and who runs it.`}>
      <Section heading="What this application does">
        <p>
          {SITE_INFO.appName} gives {SITE_INFO.institution}&apos;s staff a current view of student billing: enrollment against financial clearance for each
          semester, accounts-receivable analysis, and the transaction and clearance detail behind an individual student&apos;s account. It reads the
          institution&apos;s existing student-billing records; it is a window onto them, not a second copy and not a system of record.
        </p>
      </Section>

      <Section heading="Who it is for">
        <p>
          Staff in {SITE_INFO.dataOwner} and the offices that work alongside it. Accounts are issued by an administrator — there is no public sign-up — and what
          each person can see follows the role they were given.
        </p>
      </Section>

      <Section heading="Who built it">
        <p>
          {SITE_INFO.appName} is built and maintained by {SITE_INFO.vendor} for {SITE_INFO.institution}. Questions about the figures themselves belong with{" "}
          {SITE_INFO.dataOwner}, which owns the underlying records; questions about the application are answered through the support page.
        </p>
      </Section>

      <Section heading="How the figures are produced">
        <p>
          Wherever the institution already has an official calculation — a clearance worksheet procedure, a cost analysis, a census figure — this application
          uses it rather than inventing its own. Where a figure is computed here, the page shows the arithmetic beside it, and where two sources disagree the
          difference is displayed rather than quietly reconciled. A number nobody can trace is not much use in a conversation about someone&apos;s account.
        </p>
      </Section>
    </PublicPage>
  );
}
