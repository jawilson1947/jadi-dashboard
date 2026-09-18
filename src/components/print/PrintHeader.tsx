"use client";

import { useEffect, useState } from "react";
import { formatDateTime } from "@/lib/format";

/**
 * Print-only report header and running footer. Hidden on screen; the "printed at" time is stamped when
 * the print dialog opens (beforeprint) so a page left open for hours still prints the true time.
 */
export function PrintHeader({ title, subtitle, semester, capturedAt, printedBy, timeZone, rows, scoped = false }: { title: string; subtitle?: string; semester: string; capturedAt?: string | null; printedBy: string; timeZone: string; rows?: string; scoped?: boolean }) {
  const [printedAt, setPrintedAt] = useState<string>("");
  useEffect(() => {
    const stamp = () => setPrintedAt(formatDateTime(new Date(), timeZone));
    stamp();
    window.addEventListener("beforeprint", stamp);
    return () => window.removeEventListener("beforeprint", stamp);
  }, [timeZone]);

  return (
    <>
      <header className={`print-header ${scoped ? "print-scope-header" : "print-only"}`} aria-hidden>
        <div className="flex items-baseline justify-between gap-4 border-b-2 border-black pb-2 mb-3">
          <div>
            <div className="text-xs uppercase tracking-wide">JADI Billing Dashboard</div>
            <h1 className="text-xl font-semibold leading-tight">{title}</h1>
            {subtitle ? <div className="text-sm">{subtitle}</div> : null}
          </div>
          <dl className="text-xs text-right leading-relaxed">
            <div><dt className="inline font-medium">Semester:</dt> <dd className="inline">{semester}</dd></div>
            {capturedAt ? <div><dt className="inline font-medium">Data captured:</dt> <dd className="inline">{formatDateTime(capturedAt, timeZone)}</dd></div> : null}
            {rows ? <div><dt className="inline font-medium">Rows:</dt> <dd className="inline">{rows}</dd></div> : null}
            <div><dt className="inline font-medium">Printed:</dt> <dd className="inline">{printedAt} by {printedBy}</dd></div>
          </dl>
        </div>
      </header>
      <footer className={`print-footer ${scoped ? "print-scope-footer" : "print-only"}`} aria-hidden>
        JADI Billing Dashboard · {title} · analysis only, no writes to Jenzabar · contains student financial data — handle per institutional policy
      </footer>
    </>
  );
}
