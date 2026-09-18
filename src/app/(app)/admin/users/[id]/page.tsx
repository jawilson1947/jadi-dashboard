import { notFound } from "next/navigation";
import { getPrincipal } from "@/server/auth/session";
import { effectivePermissions, PERMISSIONS, requirePermission, ROLE_PERMISSIONS } from "@/server/authz/permissions";
import { getUserDetail } from "@/server/identity/service";
import { getConfig } from "@/server/db/config";
import { formatDateTime } from "@/lib/format";
import { PageHeader } from "@/components/layout/PageHeader";
import { UserForm } from "@/components/admin/users/UserForm";
import { StatusBadge } from "@/components/admin/users/StatusBadge";
import { UserActions } from "@/components/admin/users/UserActions";

export const metadata = { title: "Manage user" };
export const dynamic = "force-dynamic";

export default async function UserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = requirePermission(await getPrincipal(), "user.manage");
  const { id } = await params;
  const detail = await getUserDetail(id);
  if (!detail) notFound();
  const { user, sessions } = detail;
  const tz = getConfig().APP_TIMEZONE;
  const now = new Date();
  const effective = effectivePermissions({ userId: user.id, displayName: user.displayName, email: user.email, roles: user.roles, extraPermissions: user.permissions.filter((p) => !p.expiresAt || p.expiresAt > now).map((p) => p.key) });
  const fromRoles = new Set(user.roles.flatMap((r) => ROLE_PERMISSIONS[r]));

  return (
    <>
      <PageHeader
        title={user.displayName}
        description={`${user.username} · ${user.email}`}
        actions={<StatusBadge status={user.status} isLocked={user.isLocked} mustChangePassword={user.mustChangePassword} />}
      />

      <div className="grid gap-4 lg:grid-cols-3 lg:items-start">
        <section className="card lg:col-span-2">
          <h2 className="text-sm font-medium text-ink-2 mb-4">Profile, roles and grants</h2>
          <UserForm
            mode="edit"
            userId={user.id}
            initial={{ username: user.username, email: user.email, displayName: user.displayName, roles: user.roles, permissions: user.permissions.map((p) => ({ key: p.key, expiresAt: p.expiresAt ? p.expiresAt.toISOString() : null })) }}
            allPermissions={PERMISSIONS}
          />
        </section>

        <div className="space-y-4">
          <section className="card">
            <h2 className="text-sm font-medium text-ink-2 mb-3">Account actions</h2>
            <UserActions user={{ id: user.id, username: user.username, status: user.status, isLocked: user.isLocked, hasPassword: user.hasPassword, isSelf: user.id === actor.userId }} />
          </section>

          <section className="card">
            <h2 className="text-sm font-medium text-ink-2 mb-3">Effective permissions</h2>
            <ul className="text-xs space-y-1">
              {[...effective].sort().map((p) => (
                <li key={p} className="flex items-center gap-2">
                  <span className="font-mono">{p}</span>
                  <span className="text-ink-3">{fromRoles.has(p) ? "from role" : "explicit grant"}</span>
                </li>
              ))}
              {effective.size === 0 ? <li className="text-ink-2">None</li> : null}
            </ul>
          </section>

          <section className="card">
            <h2 className="text-sm font-medium text-ink-2 mb-3">Active sessions ({sessions.length})</h2>
            <ul className="text-xs space-y-2">
              {sessions.map((s) => (
                <li key={s.id} className="border-b border-border/60 pb-1">
                  <div>Last seen {formatDateTime(s.lastSeenAt, tz)} · expires {formatDateTime(s.expiresAt, tz)}</div>
                  <div className="text-ink-3 truncate">{s.ip ?? "—"} · {s.userAgent ?? "—"}</div>
                </li>
              ))}
              {sessions.length === 0 ? <li className="text-ink-2">No active sessions.</li> : null}
            </ul>
          </section>

          <section className="card text-xs text-ink-2 space-y-1">
            <div>Created {formatDateTime(user.createdAt, tz)}</div>
            <div>Updated {formatDateTime(user.updatedAt, tz)}</div>
            <div>Password set {user.passwordSetAt ? formatDateTime(user.passwordSetAt, tz) : "never"}</div>
            <div>Last sign-in {user.lastSignInAt ? formatDateTime(user.lastSignInAt, tz) : "never"}</div>
            <div>Failed sign-ins since last success: {user.failedSignIns}</div>
          </section>
        </div>
      </div>
    </>
  );
}
