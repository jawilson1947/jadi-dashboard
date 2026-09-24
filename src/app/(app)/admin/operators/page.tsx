import { getPrincipal } from "@/server/auth/session";
import { requirePermission } from "@/server/authz/permissions";
import { listOperators } from "@/server/services/admin";
import { getSprintView } from "@/server/services/sprint";
import { getConfig } from "@/server/db/config";
import { formatCount, formatDateTime } from "@/lib/format";
import { formatRange } from "@/server/metadata/operators";
import { PageHeader } from "@/components/layout/PageHeader";
import { OperatorAdmin, type OperatorProfileView } from "@/components/admin/sprint/OperatorAdmin";
import type { ObservedCode } from "@/components/admin/sprint/OperatorForm";

export const metadata = { title: "Operators" };
export const dynamic = "force-dynamic";

/**
 * Administration → Operators (Spec §7.2; PLAN §4 OperatorProfile).
 * Codes observed in the current sprint are listed alongside the profiles so an administrator can see
 * exactly which ones are still unmapped. No name is ever inferred from a code.
 */
export default async function OperatorsPage() {
  requirePermission(await getPrincipal(), "operator.manage");
  const tz = getConfig().APP_TIMEZONE;
  const [profiles, view] = await Promise.all([listOperators(), getSprintView({ autoRefreshAfterMinutes: 0 }).catch(() => null)]);
  const observed = view?.byOperator ?? [];
  // Two different problems, two different fixes: a code with no profile needs one created, a code
  // whose profile does not cover its actions needs that profile's dates corrected (J. Wilson,
  // 2026-09-24). Collapsing them into "needs a profile" sent an administrator to create a duplicate.
  const needsProfile = observed.filter((o) => o.reason === "no-profile");
  const outOfRange = observed.filter((o) => o.reason === "out-of-range");
  const codes: ObservedCode[] = observed.map((o) => ({ code: o.code, cleared: o.cleared, firstAt: o.firstAt, lastAt: o.lastAt }));
  const profileRows: OperatorProfileView[] = profiles.map((p) => ({
    id: p.id,
    sourceCode: p.sourceCode,
    displayName: p.displayName,
    email: p.email ?? "",
    department: p.department ?? "",
    isActive: p.isActive,
    isSystem: p.isSystem,
    effectiveFrom: p.effectiveFrom ?? "",
    effectiveTo: p.effectiveTo ?? "",
    updatedAtLabel: formatDateTime(p.updatedAt, tz),
  }));

  return (
    <>
      <PageHeader
        title="Operators"
        description="ClearedBy source code → person, with effective dates. Codes without a profile appear as “Unmapped” on the Clearance Sprint page; the sa account is automatic clearance, not a person (Spec §7.2, §10.5)."
      />

      <section className="card space-y-3">
        <h2 className="text-sm font-medium text-ink-2">Codes seen in the current sprint</h2>
        {observed.length === 0 ? (
          <p className="text-sm text-ink-3">No sprint snapshot yet, or no clearance actions in the configured window.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Source codes observed in the current sprint window</caption>
              <thead className="bg-surface-2 text-left">
                <tr>
                  {["Source code", "Resolves to", "Clearance actions", "First action", "Last action"].map((h, i) => (
                    <th key={h} scope="col" className={`px-3 py-2 font-medium text-ink-2 whitespace-nowrap ${i === 2 ? "text-right" : ""}`}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {observed.map((o) => (
                  <tr key={o.code || "(blank)"} className="border-t border-border">
                    <td className="px-3 py-1.5 font-mono text-xs">{o.code || "(blank)"}</td>
                    <td className="px-3 py-1.5">
                      {o.displayName}
                      {o.reason === "no-profile" ? <span className="ml-2 text-xs text-warning">needs a profile</span> : null}
                      {o.reason === "out-of-range" ? (
                        <span className="ml-2 text-xs text-serious">
                          profile dates exclude these actions ({o.ranges.map((r) => `${r.displayName}: ${formatRange(r)}`).join("; ")})
                        </span>
                      ) : null}
                      {o.reason === "blank-code" ? <span className="ml-2 text-xs text-warning">no source code recorded</span> : null}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular">{formatCount(o.cleared)}</td>
                    <td className="px-3 py-1.5 whitespace-nowrap text-ink-2">{formatDateTime(o.firstAt, tz)}</td>
                    <td className="px-3 py-1.5 whitespace-nowrap text-ink-2">{formatDateTime(o.lastAt, tz)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {needsProfile.length > 0 ? (
          <p className="text-xs text-ink-2">
            {formatCount(needsProfile.length)} code{needsProfile.length === 1 ? "" : "s"} have no profile at all:{" "}
            <span className="font-mono">{needsProfile.map((u) => u.code || "(blank)").join(", ")}</span>
          </p>
        ) : null}
        {outOfRange.length > 0 ? (
          <p className="text-xs text-ink-2">
            {formatCount(outOfRange.length)} code{outOfRange.length === 1 ? "" : "s"} already have a profile whose effective dates exclude the actions above:{" "}
            <span className="font-mono">{outOfRange.map((u) => u.code).join(", ")}</span>. Edit the profile below rather than adding a second one — clearing both dates makes the mapping
            open-ended.
          </p>
        ) : null}
      </section>

      <OperatorAdmin profiles={profileRows} codes={codes} />

    </>
  );
}
