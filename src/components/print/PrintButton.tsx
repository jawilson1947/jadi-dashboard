"use client";

import { useEffect } from "react";

/**
 * Print button (Spec §5 "print option on every report view"). Without `scopeId` the whole page prints
 * with the print stylesheet (navigation and controls hidden). With `scopeId`, only the element carrying
 * data-print-id={scopeId} is printed — used for a single card such as the Clearance Breakdown.
 */
export function PrintButton({ scopeId, label = "Print", className = "" }: { scopeId?: string; label?: string; className?: string }) {
  useEffect(() => {
    const clear = () => {
      document.body.classList.remove("print-scoped");
      document.querySelectorAll("[data-printing]").forEach((el) => el.removeAttribute("data-printing"));
    };
    window.addEventListener("afterprint", clear);
    return () => window.removeEventListener("afterprint", clear);
  }, []);

  function print() {
    if (scopeId) {
      const el = document.querySelector(`[data-print-id="${scopeId}"]`);
      if (el) {
        el.setAttribute("data-printing", "true");
        document.body.classList.add("print-scoped");
      }
    }
    // Let the scoped attributes paint before the print dialog snapshots the page.
    requestAnimationFrame(() => window.print());
  }

  return (
    <button type="button" onClick={print} className={`no-print inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-surface-2 ${className}`} aria-label={scopeId ? `${label} this card` : `${label} this report`}>
      <span aria-hidden>🖨</span> {label}
    </button>
  );
}
