import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { optionalFilter } from "@/server/api/query";
import { getPrincipal } from "@/server/auth/session";
import { hasPermission, requirePermission } from "@/server/authz/permissions";
import { audit } from "@/server/audit/audit";
import { getConfig } from "@/server/db/config";
import { getStudentProfile } from "@/server/services/students";
import { getTransactionsView } from "@/server/services/transactions";
import { analyzePayments } from "@/server/services/payment-analysis";
import { NotCurrentTermError, getClearanceAnalysis } from "@/server/services/clearance-analysis";
import { getDataProvider } from "@/server/repositories";
import { DataSourceUnavailableError } from "@/server/repositories/types";
import { formatCurrency } from "@/lib/format";
import { PageHeader } from "@/components/layout/PageHeader";
import { PrintButton } from "@/components/print/PrintButton";
import { StudentHeader } from "@/components/students/StudentHeader";
import { BioCard } from "@/components/students/BioCard";
import { TransactionsCard } from "@/components/students/TransactionsCard";
import { PaymentAnalysisCard } from "@/components/students/PaymentAnalysisCard";
import { ClearanceCard } from "@/components/students/ClearanceCard";
import { Unavailable } from "@/components/students/Unavailable";
import { getAppStore } from "@/server/store";
import { describeGaps } from "@/server/services/reclaim";
import { canUpdateSemester, SEMESTER_UPDATE_MESSAGES } from "@/server/services/semester-update";
import { canCheckClearance, CLEARANCE_CHECK_MESSAGES } from "@/server/services/clearance-check";
import { parseReturnTo, withReturnTo } from "@/lib/return-to";
import { getStudentNeighbors, type StudentNeighbors } from "@/server/services/student-neighbors";
import { StudentPager } from "@/components/students/StudentPager";

export const dynamic = "force-dynamic";
export const metadata = { title: "Student Profile" };

const TABS = ["bio", "transactions", "payments", "clearance"] as const;
type Tab = (typeof TABS)[number];

const paramsSchema = z.object({
  tab: z.enum(TABS).default("bio"),
  // The result card this profile was opened from, so "Return to results" goes back to the list
  // rather than to an empty search form. Validated, never trusted — see lib/return-to.
  from: optionalFilter(z.string().max(400)),
  reveal: z.enum(["dob"]).optional(),
  scope: z.enum(["current", "global"]).default("global"),
  year: z.string().regex(/^\d{4}$/).optional(),
  page: z.coerce.number().int().min(1).default(1),
  // Outcome of an Update Semester run, carried back through the 303 (A-33).
  semester: z.enum(["updated", "no_registration", "no_student", "invalid_id", "unavailable"]).optional(),
  clearance: z.enum(["cleared", "no_clearance_record", "no_student", "invalid_id", "unavailable"]).optional(),
});

/**
 * Student Profile (Spec §10.2–10.5; Bio Spec cards 1–5).
 *
 * Every tab is a separate permission and a separate audit row — a user who may see a name is not
 * thereby entitled to a payment history. Tabs the caller cannot open are not rendered at all, and
 * the server refuses them independently, so a hand-typed URL gains nothing.
 */
export default async function StudentProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const principal = requirePermission(await getPrincipal(), "student.view");
  const { id } = await params;
  const q = paramsSchema.parse(await searchParams);

  const mayReveal = hasPermission(principal, "student.pii.view");
  const maySeeTransactions = hasPermission(principal, "student.transactions.view");
  const mayAnalyzeClearance = hasPermission(principal, "student.clearance.analyze");
  const revealDob = q.reveal === "dob" && mayReveal;

  /**
   * The return URL has to survive every move made inside the profile — switching tabs, revealing a
   * date of birth, paging transactions — or "Return to results" would work only until the first
   * click. So it rides along on every internal link.
   */
  const returnTo = parseReturnTo(q.from);
  const withFrom = (href: string) => withReturnTo(href, returnTo);

  const profile = await getStudentProfile(id, principal, { revealDob });
  if (!profile) notFound();

  await audit(principal, "student.profile_view", { targetType: "student", targetId: id, metadata: { tab: q.tab, via: "page" } });
  if (revealDob) await audit(principal, "student.pii_reveal", { targetType: "student", targetId: id, metadata: { field: "dob" } });

  const tab: Tab = (q.tab === "transactions" || q.tab === "payments") && !maySeeTransactions ? "bio" : q.tab === "clearance" && !mayAnalyzeClearance ? "bio" : q.tab;

  /**
   * Previous/Next across the result set this profile was opened from. Resolved after `tab`, so a
   * step keeps the tab the reader is actually on rather than the one they asked for. A failure here
   * costs the control, never the profile: a student whose neighbours are unreachable is still a
   * student someone is trying to read.
   */
  let neighbors: StudentNeighbors | null = null;
  if (returnTo) {
    try {
      neighbors = await getStudentNeighbors(returnTo, profile.idnumber, tab);
    } catch (err) {
      console.error(JSON.stringify({ level: "warn", card: "pager", studentId: id, message: err instanceof Error ? err.message : String(err) }));
    }
  }
  const photoConfigured = Boolean(getConfig().STUDENT_PHOTO_SHARE);
  const base = `/students/${encodeURIComponent(id)}`;

  const visibleTabs: Array<{ key: Tab; label: string }> = [
    { key: "bio", label: "Bio" },
    ...(maySeeTransactions ? ([{ key: "transactions", label: "Transactions" }, { key: "payments", label: "Payment analysis" }] as const) : []),
    ...(mayAnalyzeClearance ? ([{ key: "clearance", label: "Financial clearance" }] as const) : []),
  ];

  /**
   * A record reclaimed from Jenzabar is incomplete precisely in the cases the reclaim was needed
   * (A-32). The warning is read from dash.ReclaimedStudent rather than flashed once after the
   * write, because the next person to open this profile needs it just as much as the person who
   * created it. A student nobody reclaimed has no row and no banner.
   */
  let reclaimNotice: string | null = null;
  try {
    const reclaimed = await getAppStore().getReclaimedStudent(profile.idnumber);
    if (reclaimed) reclaimNotice = describeGaps(reclaimed);
  } catch {
    // The profile must render without it; an unavailable store is not a reason to fail the page.
  }

  return (
    <>
      <PageHeader
        title={`${profile.firstName} ${profile.lastName}`.trim() || profile.idnumber}
        description={`Student ${profile.idnumber} · ${profile.classification}`}
        actions={
          <span className="flex items-center gap-3">
            {neighbors ? <StudentPager neighbors={neighbors} /> : null}
            <Link href={returnTo ?? "/students"} className="text-sm underline hover:no-underline">
              {returnTo ? "Return to results" : "Back to search"}
            </Link>
            <PrintButton />
          </span>
        }
      />

      {reclaimNotice ? (
        <div role="status" className="rounded-md border border-warning bg-surface-1 px-4 py-2 text-sm">
          <span aria-hidden>⚠</span> {reclaimNotice}
        </div>
      ) : null}

      <StudentHeader profile={profile} photoHref={photoConfigured ? `/api/v1/students/${encodeURIComponent(id)}/photo` : null} />

      <nav aria-label="Profile sections" className="flex flex-wrap gap-2 border-b border-border">
        {visibleTabs.map((t) => (
          <Link
            key={t.key}
            href={withFrom(`${base}?tab=${t.key}`)}
            aria-current={tab === t.key ? "page" : undefined}
            className={`px-3 py-2 text-sm rounded-t-md ${tab === t.key ? "bg-surface-2 font-medium" : "text-ink-2 hover:bg-surface-2"}`}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === "bio" ? (
        <BioCard
          profile={profile}
          canReveal={mayReveal}
          revealHref={withFrom(`${base}?tab=bio&reveal=dob`)}
          hideHref={withFrom(`${base}?tab=bio`)}
          returnTo={returnTo}
          canUpdateSemester={hasPermission(principal, "student.update") && canUpdateSemester(profile.lastCleared, profile.lastClearedLabel)}
          semesterOutcome={q.semester ? { status: q.semester, message: SEMESTER_UPDATE_MESSAGES[q.semester] } : null}
          canCheckClearance={hasPermission(principal, "student.update") && canCheckClearance(profile.clearedCurrentSession)}
          clearanceOutcome={q.clearance ? { status: q.clearance, message: CLEARANCE_CHECK_MESSAGES[q.clearance] } : null}
        />
      ) : null}

      {tab === "transactions" ? await renderTransactions(id, q.scope, q.year, q.page, profile.currentTermRecord, base, returnTo) : null}

      {tab === "payments" ? await renderPayments(id, profile.accountBalance) : null}

      {tab === "clearance" ? await renderClearance(id, profile.lastClearedLabel, returnTo) : null}
    </>
  );
}

/** Bio Spec card 2. The current-semester card only exists for a student on the current term (1.4). */
async function renderTransactions(
  id: string,
  scope: "current" | "global",
  year: string | undefined,
  page: number,
  currentTermRecord: boolean,
  base: string,
  returnTo: string | null,
) {
  const effectiveScope = scope === "current" && !currentTermRecord ? "global" : scope;
  try {
    const view = await getTransactionsView(id, { scope: effectiveScope, year, page });
    return (
      <TransactionsCard
        view={view}
        base={base}
        returnTo={returnTo}
        currentTermAvailable={currentTermRecord}
        note={
          effectiveScope === "current"
            ? "This semester only, from the co-located billing copy."
            : "Complete account history. Transactions are grouped by year; pick a year to page through it."
        }
      />
    );
  } catch (err) {
    // One card failing must not take down the profile. The bio, clearance and payment cards are
    // still useful without transactions, and a student whose history is unreachable is exactly the
    // student someone is trying to look at. Previously only DataSourceUnavailableError degraded and
    // anything else was rethrown, so a linked-server transport error 500'd the whole page.
    const detail =
      err instanceof DataSourceUnavailableError
        ? err.message
        : "The transaction source did not respond. The rest of this profile is unaffected.";
    if (!(err instanceof DataSourceUnavailableError)) {
      console.error(JSON.stringify({ level: "error", card: "transactions", studentId: id, scope: effectiveScope, message: err instanceof Error ? err.message : String(err) }));
    }
    return (
      <Unavailable
        title="Transaction history is not available"
        detail={detail}
        hint={
          effectiveScope === "global"
            ? "This student is not on the current term, so the card reads the global archive through a linked server (ASSUMPTIONS A-24). Check that the host is reachable, or turn TRANS_HIST_GLOBAL_ENABLED off to hide the card instead."
            : "An administrator enables this once the DBA confirms which server holds the archive (ASSUMPTIONS A-24)."
        }
      />
    );
  }
}

/** Bio Spec card 3 — only meaningful for an account that owes money. */
async function renderPayments(id: string, accountBalance: number) {
  if (accountBalance <= 0) {
    return (
      <div className="card">
        <h2 className="text-sm font-medium text-ink-2">Payment analysis</h2>
        <p className="text-sm mt-1">
          This account carries {accountBalance === 0 ? "a zero balance" : `a credit balance of ${formatCurrency(Math.abs(accountBalance))}`}, so there is nothing to analyse for
          collection. The analysis appears when a debit balance is owed.
        </p>
      </div>
    );
  }
  try {
    const rows = await getDataProvider().getStudentTransactions(id, "global");
    return <PaymentAnalysisCard analysis={analyzePayments(rows, accountBalance)} studentId={id} />;
  } catch (err) {
    if (err instanceof DataSourceUnavailableError) {
      return <Unavailable title="Payment analysis is not available" detail={err.message} hint="It is computed from the complete account history (ASSUMPTIONS A-24)." />;
    }
    throw err;
  }
}

/** Bio Spec cards 4–5 — the eligibility gate comes first, as the spec requires. */
async function renderClearance(id: string, lastClearedLabel: string, returnTo: string | null) {
  try {
    return <ClearanceCard analysis={await getClearanceAnalysis(id)} />;
  } catch (err) {
    if (err instanceof NotCurrentTermError) {
      return (
        <div className="card space-y-2">
          <h2 className="text-sm font-medium text-ink-2">Financial clearance analysis</h2>
          <p className="text-sm">Financial clearance analysis is reserved for students enrolled in the current semester.</p>
          <p className="text-xs text-ink-3">This record was last cleared in: {lastClearedLabel}.</p>
          <Link href={returnTo ?? "/students"} className="text-sm underline hover:no-underline">
            {returnTo ? "Return to results" : "Search for another student"}
          </Link>
        </div>
      );
    }
    if (err instanceof DataSourceUnavailableError) {
      return <Unavailable title="Clearance analysis is not available" detail={err.message} hint="It reads the institution's worksheet procedure and cost analysis." />;
    }
    throw err;
  }
}
