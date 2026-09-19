import { formatDateTime } from "@/lib/format";
import type { Permission } from "@/server/authz/permissions";
import type { NavItem } from "./NavLinks";
import { Sidebar } from "./Sidebar";
import { UserMenu } from "./UserMenu";

const NAV: NavItem[] = [
  { href: "/dashboard", label: "Current Semester", abbr: "CUR", permission: "dashboard.view" },
  { href: "/clearance-sprint", label: "Clearance Sprint", abbr: "SPR", permission: "dashboard.view" },
  { href: "/dnr-dnc", label: "DNR / DNC Analysis", abbr: "DNR", permission: "student.view" },
  { href: "/historical", label: "Historical Analysis", abbr: "HIS", permission: "history.view" },
  { href: "/students", label: "Student Lookup", abbr: "STU", permission: "student.view" },
  { href: "/reports", label: "Reports & Analyses", abbr: "RPT", permission: "dashboard.view" },
  { href: "/ai", label: "AI Analyses", abbr: "AI", permission: "ai.view" },
  { href: "/admin", label: "Administration", abbr: "ADM", permission: "metadata.manage" },
];

interface AppShellProps {
  user: { displayName: string; roles: string[]; canChangePassword?: boolean };
  permissions: Permission[];
  termLabel: string;
  refreshedAt: string | null;
  stale: boolean;
  timeZone: string;
  children: React.ReactNode;
}

export function AppShell({ user, permissions, termLabel, refreshedAt, stale, timeZone, children }: AppShellProps) {
  const visible = NAV.filter((n) => permissions.includes(n.permission));
  return (
    <div className="flex-1 flex min-h-screen">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:bg-surface-1 focus:p-2 focus:rounded">
        Skip to main content
      </a>
      <Sidebar items={visible} />

      <div className="flex-1 flex flex-col min-w-0">
        <header className="app-header flex items-center gap-4 px-6 h-14 border-b border-border bg-surface-1">
          <div className="text-sm">
            <span className="text-ink-3">Semester</span> <span className="font-medium">{termLabel}</span>
          </div>
          <div className="text-sm">
            <span className="text-ink-3">Last refresh</span>{" "}
            <time dateTime={refreshedAt ?? undefined} className="font-medium">
              {refreshedAt ? formatDateTime(refreshedAt, timeZone) : "Unavailable"}
            </time>
            {stale ? (
              <span className="ml-2 inline-flex items-center gap-1 rounded-full border border-warning text-warning px-2 py-0.5 text-xs">
                <span aria-hidden>⚠</span> Stale
              </span>
            ) : null}
          </div>
          <div className="ml-auto">
            <UserMenu displayName={user.displayName} roles={user.roles} canChangePassword={user.canChangePassword ?? true} />
          </div>
        </header>
        <main id="main" className="flex-1 p-6 space-y-6">
          {children}
        </main>
      </div>
    </div>
  );
}
