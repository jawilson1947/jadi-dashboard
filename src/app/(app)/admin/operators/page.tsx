import { getPrincipal } from "@/server/auth/session";
import { requirePermission } from "@/server/authz/permissions";
import { listOperators } from "@/server/services/admin";
import { getSprintView } from "@/server/services/sprint";
import { getConfig } from "@/server/db/config";
import { formatCount, formatDateTime } from "@/lib/format";
import { formatIsoDate } from "@/lib/dates";
import { PageHeader } from "@/components/layout/PageHeader";
import { OperatorForm } from "@/components/admin/sprint/OperatorForm";

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
  const unmapped = observed.filter((o) => !o.mapped);

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
                      {!o.mapped && !o.isSystem ? <span className="ml-2 text-xs text-warning">needs a profile</span> : null}
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
        {unmapped.length > 0 ? (
          <p className="text-xs text-ink-2">
            {formatCount(unmapped.length)} code{unmapped.length === 1 ? "" : "s"} still unmapped: <span className="font-mono">{unmapped.map((u) => u.code || "(blank)").join(", ")}</span>
          </p>
        ) : null}
      </section>

      <section className="card space-y-3">
        <h2 className="text-sm font-medium text-ink-2">Add or update a profile</h2>
        <p className="text-xs text-ink-3">
          Leave the effective dates empty for an open-ended mapping. Set them when a code changes hands, so last semester’s clearance actions keep resolving to the person who made them.
        </p>
        <OperatorForm codes={observed.map((o) => ({ code: o.code, cleared: o.cleared, firstAt: o.firstAt, lastAt: o.lastAt }))} />
      </section>

      <section className="card space-y-3">
        <h2 className="text-sm font-medium text-ink-2">Existing profiles</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Operator profiles</caption>
            <thead className="bg-surface-2 text-left">
              <tr>
                {["Code", "Display name", "Email", "Department", "Effective from", "Effective to", "Status", "Updated"].map((h) => (
                  <th key={h} scope="col" className="px-3 py-2 font-medium text-ink-2 whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {profiles.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center text-ink-3">
                    No operator profiles yet.
                  </td>
                </tr>
              ) : (
                profiles.map((p) => (
                  <tr key={p.id} className="border-t border-border">
                    <td className="px-3 py-1.5 font-mono text-xs">{p.sourceCode}</td>
                    <td className="px-3 py-1.5">{p.displayName}</td>
                    <td className="px-3 py-1.5 text-ink-2">{p.email ?? "—"}</td>
                    <td className="px-3 py-1.5 text-ink-2">{p.department ?? "—"}</td>
                    <td className="px-3 py-1.5 whitespace-nowrap">{p.effectiveFrom ? formatIsoDate(p.effectiveFrom) : "—"}</td>
                    <td className="px-3 py-1.5 whitespace-nowrap">{p.effectiveTo ? formatIsoDate(p.effectiveTo) : "—"}</td>
                    <td className="px-3 py-1.5 text-xs">
                      {p.isActive ? <span className="rounded-full border border-border px-2 py-0.5">active</span> : <span className="rounded-full border border-border text-ink-3 px-2 py-0.5">inactive</span>}
                      {p.isSystem ? <span className="ml-1 rounded-full border border-border text-ink-2 px-2 py-0.5">automatic</span> : null}
                    </td>
                    <td className="px-3 py-1.5 whitespace-nowrap text-ink-2">{formatDateTime(p.updatedAt, tz)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
