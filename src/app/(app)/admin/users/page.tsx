import Link from "next/link";
import { z } from "zod";
import { getPrincipal } from "@/server/auth/session";
import { requirePermission, ROLES } from "@/server/authz/permissions";
import { listUsers } from "@/server/identity/service";
import { getConfig } from "@/server/db/config";
import { formatDateTime } from "@/lib/format";
import { PageHeader } from "@/components/layout/PageHeader";
import { StatusBadge } from "@/components/admin/users/StatusBadge";
import { UserFilters } from "@/components/admin/users/UserFilters";
import { PrintButton } from "@/components/print/PrintButton";
import { PrintHeader } from "@/components/print/PrintHeader";
import { getCurrentTerms } from "@/server/metadata/terms";

export const metadata = { title: "Users and roles" };
export const dynamic = "force-dynamic";

const paramsSchema = z.object({
  q: z.string().trim().max(200).optional(),
  status: z.enum(["ACTIVE", "DISABLED", "INVITED"]).optional(),
  role: z.enum(ROLES).optional(),
  page: z.coerce.number().int().min(1).default(1),
});

/** Administration → Users and roles (USER-MANAGEMENT-PLAN Sec.7). */
export default async function UsersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const principal = requirePermission(await getPrincipal(), "user.manage");
  const raw = await searchParams;
  const terms = await getCurrentTerms().catch(() => null);
  const parsed = paramsSchema.safeParse(raw);
  const f = parsed.success ? parsed.data : paramsSchema.parse({});
  const tz = getConfig().APP_TIMEZONE;
  const pageSize = 50;
  const result = await listUsers({ q: f.q || undefined, status: f.status, role: f.role, page: f.page, pageSize });
  const pages = Math.max(1, Math.ceil(result.total / pageSize));
  const qs = (page: number) => `?${new URLSearchParams({ ...(f.q ? { q: f.q } : {}), ...(f.status ? { status: f.status } : {}), ...(f.role ? { role: f.role } : {}), page: String(page) })}`;

  return (
    <>
      <PageHeader
        title="Users and roles"
        description="Dashboard accounts sign in with a local username and password; institutional single sign-on is layered on later. Passwords are never visible to administrators — new users and resets use a one-time link."
        actions={
          <span className="flex items-center gap-3">
            <PrintButton />
            <Link href="/admin/users/new" className="no-print rounded-md bg-brand text-brand-ink px-3 py-2 text-sm font-medium hover:opacity-90">
              New user
            </Link>
          </span>
        }
      />
      <PrintHeader title="Users and roles" subtitle={[f.q ? `search "${f.q}"` : null, f.status ? `status ${f.status}` : null, f.role ? `role ${f.role}` : null].filter(Boolean).join(" · ") || "All users"} semester={terms?.label ?? "—"} printedBy={principal.displayName} timeZone={tz} rows={`${result.total} users · page ${f.page}`} />

      <UserFilters q={f.q ?? ""} status={f.status ?? ""} role={f.role ?? ""} />

      <div className="card p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">Dashboard users</caption>
          <thead className="bg-surface-2 text-left">
            <tr>
              {["Username", "Name", "Email", "Roles", "Extra grants", "Status", "Last sign-in", ""].map((h) => (
                <th key={h} scope="col" className="px-3 py-2 font-medium text-ink-2 whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.rows.map((u) => (
              <tr key={u.id} className="border-t border-border">
                <td className="px-3 py-2 font-mono text-xs">{u.username}</td>
                <td className="px-3 py-2 whitespace-nowrap">{u.displayName}</td>
                <td className="px-3 py-2 text-ink-2">{u.email}</td>
                <td className="px-3 py-2 whitespace-nowrap">{u.roles.join(", ") || "—"}</td>
                <td className="px-3 py-2 text-xs text-ink-2">{u.permissions.map((p) => p.key).join(", ") || "—"}</td>
                <td className="px-3 py-2"><StatusBadge status={u.status} isLocked={u.isLocked} mustChangePassword={u.mustChangePassword} /></td>
                <td className="px-3 py-2 whitespace-nowrap text-ink-2">{u.lastSignInAt ? formatDateTime(u.lastSignInAt, tz) : "Never"}</td>
                <td className="px-3 py-2 whitespace-nowrap">
                  <Link href={`/admin/users/${u.id}`} className="text-brand hover:underline">Manage →</Link>
                </td>
              </tr>
            ))}
            {result.rows.length === 0 ? (
              <tr><td colSpan={8} className="px-3 py-6 text-center text-ink-2">No users match these filters.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-3 text-sm text-ink-2">
        <span>{result.total} user{result.total === 1 ? "" : "s"}</span>
        {pages > 1 ? (
          <span className="ml-auto flex items-center gap-2">
            {f.page > 1 ? <Link href={qs(f.page - 1)} className="text-brand">← Previous</Link> : null}
            <span>Page {f.page} of {pages}</span>
            {f.page < pages ? <Link href={qs(f.page + 1)} className="text-brand">Next →</Link> : null}
          </span>
        ) : null}
      </div>
    </>
  );
}
