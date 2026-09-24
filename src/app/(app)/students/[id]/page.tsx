import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
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

export const dynamic = "force-dynamic";
export const metadata = { title: "Student Profile" };

const TABS = ["bio", "transactions", "payments", "clearance"] as const;
type Tab = (typeof TABS)[number];

const paramsSchema = z.object({
  tab: z.enum(TABS).default("bio"),
  reveal: z.enum(["dob"]).optional(),
  scope: z.enum(["current", "global"]).default("global"),
  year: z.string().regex(/^\d{4}$/).optional(),
  page: z.coerce.number().int().min(1).default(1),
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

  const profile = await getStudentProfile(id, principal, { revealDob });
  if (!profile) notFound();

  await audit(principal, "student.profile_view", { targetType: "student", targetId: id, metadata: { tab: q.tab, via: "page" } });
  if (revealDob) await audit(principal, "student.pii_reveal", { targetType: "student", targetId: id, metadata: { field: "dob" } });

  const tab: Tab = (q.tab === "transactions" || q.tab === "payments") && !maySeeTransactions ? "bio" : q.tab === "clearance" && !mayAnalyzeClearance ? "bio" : q.tab;
  const photoConfigured = Boolean(getConfig().STUDENT_PHOTO_SHARE);
  const base = `/students/${encodeURIComponent(id)}`;

  const visibleTabs: Array<{ key: Tab; label: string }> = [
    { key: "bio", label: "Bio" },
    ...(maySeeTransactions ? ([{ key: "transactions", label: "Transactions" }, { key: "payments", label: "Payment analysis" }] as const) : []),
    ...(mayAnalyzeClearance ? ([{ key: "clearance", label: "Financial clearance" }] as const) : []),
  ];

  return (
    <>
      <PageHeader
        title={`${profile.firstName} ${profile.lastName}`.trim() || profile.idnumber}
        description={`Student ${profile.idnumber} · ${profile.classification}`}
        actions={
          <span className="flex items-center gap-3">
            <Link href="/students" className="text-sm underline hover:no-underline">Back to search</Link>
            <PrintButton />
          </span>
        }
      />

      <StudentHeader profile={profile} photoHref={photoConfigured ? `/api/v1/students/${encodeURIComponent(id)}/photo` : null} />

      <nav aria-label="Profile sections" className="flex flex-wrap gap-2 border-b border-border">
        {visibleTabs.map((t) => (
          <Link
            key={t.key}
            href={`${base}?tab=${t.key}`}
            aria-current={tab === t.key ? "page" : undefined}
            className={`px-3 py-2 text-sm rounded-t-md ${tab === t.key ? "bg-surface-2 font-medium" : "text-ink-2 hover:bg-surface-2"}`}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === "bio" ? <BioCard profile={profile} canReveal={mayReveal} revealHref={`${base}?tab=bio&reveal=dob`} hideHref={`${base}?tab=bio`} /> : null}

      {tab === "transactions" ? await renderTransactions(id, q.scope, q.year, q.page, profile.currentTermRecord, base) : null}

      {tab === "payments" ? await renderPayments(id, profile.accountBalance) : null}

      {tab === "clearance" ? await renderClearance(id, profile.lastClearedLabel) : null}
    </>
  );
}

/** Bio Spec card 2. The current-semester card only exists for a student on the current term (1.4). */
async function renderTransactions(id: string, scope: "current" | "global", year: string | undefined, page: number, currentTermRecord: boolean, base: string) {
  const effectiveScope = scope === "current" && !currentTermRecord ? "global" : scope;
  try {
    const view = await getTransactionsView(id, { scope: effectiveScope, year, page });
    return (
      <TransactionsCard
        view={view}
        base={base}
        currentTermAvailable={currentTermRecord}
        note={
          effectiveScope === "current"
            ? "This semester only, from the co-located billing copy."
            : "Complete account history. Transactions are grouped by year; pick a year to page through it."
        }
      />
    );
  } catch (err) {
    if (err instanceof DataSourceUnavailableError) {
      return (
        <Unavailable
          title="Transaction history is not available"
          detail={err.message}
          hint="An administrator enables this once the DBA confirms which server holds the archive (ASSUMPTIONS A-24)."
        />
      );
    }
    throw err;
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
async function renderClearance(id: string, lastClearedLabel: string) {
  try {
    return <ClearanceCard analysis={await getClearanceAnalysis(id)} />;
  } catch (err) {
    if (err instanceof NotCurrentTermError) {
      return (
        <div className="card space-y-2">
          <h2 className="text-sm font-medium text-ink-2">Financial clearance analysis</h2>
          <p className="text-sm">Financial clearance analysis is reserved for students enrolled in the current semester.</p>
          <p className="text-xs text-ink-3">This record was last cleared in: {lastClearedLabel}.</p>
          <Link href="/students" className="text-sm underline hover:no-underline">Search for another student</Link>
        </div>
      );
    }
    if (err instanceof DataSourceUnavailableError) {
      return <Unavailable title="Clearance analysis is not available" detail={err.message} hint="It reads the institution's worksheet procedure and cost analysis." />;
    }
    throw err;
  }
}
