import Link from "next/link";
import { getPrincipal } from "@/server/auth/session";
import { hasPermission, requirePermission } from "@/server/authz/permissions";
import { PageHeader } from "@/components/layout/PageHeader";

export const metadata = { title: "Administration" };

const SECTIONS = [
  { href: "/admin/jobs", title: "Refresh schedules & job status", desc: "Snapshot jobs, last/next run, manual refresh.", permission: "schedule.manage", phase: null },
  { href: "/admin/metadata", title: "Semester / JADI metadata", desc: "tblOUSA read-through: current and previous term, census, nightly cleared totals, drop dates, worksheet folders.", permission: "metadata.manage", phase: null },
  { href: "/admin/users", title: "Users and roles", desc: "Dashboard accounts, roles, per-user grants, one-time invite and reset links, lockouts.", permission: "user.manage", phase: null },
  { href: "/admin/operators", title: "Operators", desc: "ClearedBy code → display name, effective dates; unmapped codes seen in the current sprint.", permission: "operator.manage", phase: null },
  { href: "#", title: "Classification mappings", desc: "cCode → display name, sort order; Incoming Transfer rule.", permission: "metadata.manage", phase: 3 },
  { href: "#", title: "Data connections", desc: "Source connection descriptors and connectivity test (secrets never shown).", permission: "connection.manage", phase: 6 },
  { href: "#", title: "Audit log", desc: "Sign-ins, student-profile access, exports, admin changes.", permission: "audit.view", phase: 3 },
] as const;

export default async function AdminPage() {
  const principal = requirePermission(await getPrincipal(), "metadata.manage");
  return (
    <>
      <PageHeader title="Administration" description="Configuration and operations (Spec §14)." />
      <div className="grid gap-4 md:grid-cols-2">
        {SECTIONS.filter((s) => hasPermission(principal, s.permission)).map((s) => (
          <section key={s.title} className="card">
            <h2 className="font-medium">
              {s.phase ? s.title : <Link href={s.href} className="text-brand hover:underline">{s.title}</Link>}
            </h2>
            <p className="text-sm text-ink-2 mt-1">{s.desc}</p>
            {s.phase ? <p className="text-xs text-ink-3 mt-2">Planned in Phase {s.phase}.</p> : null}
          </section>
        ))}
      </div>
    </>
  );
}
