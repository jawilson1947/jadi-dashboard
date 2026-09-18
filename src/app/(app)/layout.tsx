import { redirect } from "next/navigation";
import { getPrincipal } from "@/server/auth/session";
import { effectivePermissions } from "@/server/authz/permissions";
import { getCurrentTerms } from "@/server/metadata/terms";
import { getAppStore } from "@/server/store";
import { getConfig } from "@/server/db/config";
import { isStale } from "@/server/services/calculations";
import { AppShell } from "@/components/layout/AppShell";

/**
 * Authenticated shell (Spec §5): left nav, page title slot, current semester,
 * last successful refresh, user menu. Modules the user cannot access are hidden here and
 * ALSO enforced server-side in each route (Spec §3.4).
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const principal = await getPrincipal();
  if (!principal) redirect("/sign-in");
  if (principal.mustChangePassword) redirect("/change-password");

  const cfg = getConfig();
  let termLabel = "—";
  let refreshedAt: string | null = null;
  let stale = false;
  try {
    const terms = await getCurrentTerms();
    termLabel = terms.label;
    const latest = await getAppStore().latestSnapshot("enrollmentClearance");
    if (latest) {
      refreshedAt = latest.capturedAt.toISOString();
      stale = isStale(latest.capturedAt, new Date(), cfg.STALE_AFTER_MINUTES);
    }
  } catch {
    /* header degrades gracefully; the page itself reports the failure */
  }

  return (
    <AppShell
      user={{ displayName: principal.displayName, roles: principal.roles, canChangePassword: principal.hasLocalPassword ?? false }}
      permissions={[...effectivePermissions(principal)]}
      termLabel={termLabel}
      refreshedAt={refreshedAt}
      stale={stale}
      timeZone={cfg.APP_TIMEZONE}
    >
      {children}
    </AppShell>
  );
}
