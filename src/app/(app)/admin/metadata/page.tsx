import { getPrincipal } from "@/server/auth/session";
import { requirePermission } from "@/server/authz/permissions";
import { getCurrentTerms, academicYearOf } from "@/server/metadata/terms";
import { DEFAULT_CLASSIFICATION_MAPPINGS } from "@/server/metadata/classifications";
import { getConfig } from "@/server/db/config";
import { formatCount, formatDateTime } from "@/lib/format";
import { PageHeader } from "@/components/layout/PageHeader";

export const metadata = { title: "Semester metadata" };
export const dynamic = "force-dynamic";

/**
 * Administration → Semester / JADI metadata (Spec §14.3; ASSUMPTIONS A-20).
 * Read-through of tblOUSA: the app displays it, the legacy JADI setup site edits it.
 */
export default async function MetadataPage() {
  requirePermission(await getPrincipal(), "metadata.manage");
  const tz = getConfig().APP_TIMEZONE;
  const t = await getCurrentTerms();
  const rows = [...t.all].sort((a, b) => b.semesterBegins.getTime() - a.semesterBegins.getTime());
  const fmtDate = (d: Date | null) => (d ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: tz }).format(d) : "—");

  return (
    <>
      <PageHeader
        title="Semester / JADI metadata"
        description={`Source: tblOUSA (${t.source.kind === "snapshot" ? `snapshot captured ${formatDateTime(t.source.capturedAt, tz)}` : "live read"}). Current = ${t.current.tradName} / ${t.current.leapName}; previous = ${t.previous.tradName} / ${t.previous.leapName}. Edits are made in the JADI setup application; this page is read-only.`}
      />

      <div className="card p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">tblOUSA semesters</caption>
          <thead className="bg-surface-2 text-left">
            <tr>{["Semester", "Trad / LEAP", "Academic year", "Begins", "Ends", "Drop date", "Census (nightly)", "Fin. cleared (nightly)", "Worksheets", "Flags"].map((h) => <th key={h} scope="col" className="px-3 py-2 font-medium text-ink-2 whitespace-nowrap">{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id} className={`border-t border-border ${s.isCurrent ? "bg-brand-track/40" : ""}`}>
                <td className="px-3 py-1.5 font-medium whitespace-nowrap">{s.semesterName}</td>
                <td className="px-3 py-1.5 font-mono text-xs">{s.tradName} / {s.leapName}</td>
                <td className="px-3 py-1.5 tabular">{academicYearOf(s)}</td>
                <td className="px-3 py-1.5 whitespace-nowrap">{fmtDate(s.semesterBegins)}</td>
                <td className="px-3 py-1.5 whitespace-nowrap">{fmtDate(s.semesterEnds)}</td>
                <td className="px-3 py-1.5 whitespace-nowrap">{fmtDate(s.dropClassesDate)}</td>
                <td className="px-3 py-1.5 tabular text-right">{formatCount(s.census)}</td>
                <td className="px-3 py-1.5 tabular text-right">{formatCount(s.financiallyCleared)}</td>
                <td className="px-3 py-1.5 text-xs text-ink-2 max-w-xs truncate" title={s.worksheetFolder ?? ""}>{s.worksheetFolder ?? "—"}</td>
                <td className="px-3 py-1.5 text-xs">
                  {s.isCurrent ? <span className="inline-flex rounded-full border border-brand text-brand px-2 py-0.5">current</span> : null}
                  {s.wasCurrent ? <span className="inline-flex rounded-full border border-border text-ink-2 px-2 py-0.5">previous</span> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="card">
        <h2 className="text-sm font-medium text-ink-2 mb-2">Classification mappings (seed — admin editing in Phase 3)</h2>
        <p className="text-xs text-ink-3 mb-3">Keyed on tblStudent.cCode / STATS.Class. “Incoming Transfer” is TEL_WEB_GRP_CDE = 22 and overrides the class code (A-19).</p>
        <div className="flex flex-wrap gap-2 text-xs">
          {DEFAULT_CLASSIFICATION_MAPPINGS.map((m) => (
            <span key={m.sourceCode || "blank"} className="rounded-md border border-border px-2 py-1"><span className="font-mono">{m.sourceCode || "(blank)"}</span> → {m.displayName}</span>
          ))}
        </div>
      </section>
    </>
  );
}
