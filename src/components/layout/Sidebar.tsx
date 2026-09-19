"use client";

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import Link from "next/link";
import { NavLinks, type NavItem } from "./NavLinks";

/**
 * Collapsible primary sidebar (Spec §5).
 *
 * Collapsed it keeps a narrow rail of three-letter codes rather than disappearing, so navigation is
 * always one click away and the active section stays visible. Full labels remain the accessible name
 * of every link (`sr-only` text plus a tooltip), so collapsing changes the pixels, not the semantics.
 *
 * The preference lives in localStorage and is read through `useSyncExternalStore`: the server cannot
 * know it, so the server snapshot is "expanded" and React swaps in the real value as it hydrates —
 * the supported way to read browser-only state without a hydration mismatch. Storage is also the
 * subscription, so two tabs of the dashboard stay in step.
 */
const STORAGE_KEY = "jadi.sidebar.collapsed";

const listeners = new Set<() => void>();
let cached: boolean | null = null;

function readCollapsed(): boolean {
  if (cached === null) {
    try {
      cached = window.localStorage.getItem(STORAGE_KEY) === "1";
    } catch {
      cached = false; // private mode or blocked storage: the sidebar still works, it just isn't remembered
    }
  }
  return cached;
}

function writeCollapsed(value: boolean): void {
  cached = value;
  try {
    window.localStorage.setItem(STORAGE_KEY, value ? "1" : "0");
  } catch {
    /* not remembered; nothing else to do */
  }
  for (const l of listeners) l();
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  const onStorage = (e: StorageEvent) => {
    if (e.key !== STORAGE_KEY) return;
    cached = e.newValue === "1";
    onChange();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

export function Sidebar({ items }: { items: NavItem[] }) {
  const collapsed = useSyncExternalStore(subscribe, readCollapsed, () => false);
  const asideRef = useRef<HTMLElement>(null);
  const toggle = useCallback(() => writeCollapsed(!readCollapsed()), []);

  // Width animates only after the first paint, so a returning user sees the collapsed rail
  // immediately instead of watching it slide shut on every page load.
  useEffect(() => {
    const el = asideRef.current;
    if (!el) return;
    const id = requestAnimationFrame(() => el.classList.add("transition-[width]", "duration-150", "ease-out"));
    return () => cancelAnimationFrame(id);
  }, []);

  // "[" toggles the sidebar, ignored while typing so it never eats a character in a filter box.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "[" || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName))) return;
      toggle();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  return (
    <aside ref={asideRef} aria-label="Primary" data-collapsed={collapsed ? "true" : "false"} className={`${collapsed ? "w-14" : "w-60"} shrink-0 border-r border-border bg-surface-1 flex flex-col`}>
      <div className={`flex items-center border-b border-border ${collapsed ? "justify-center px-2 py-3" : "gap-2 px-4 py-4"}`}>
        <Link href="/dashboard" className="flex items-center gap-2 min-w-0" title={collapsed ? "JADI Billing — dashboard" : undefined}>
          <span aria-hidden className="h-7 w-7 rounded-md bg-brand shrink-0" />
          {collapsed ? <span className="sr-only">JADI Billing</span> : <span className="font-semibold leading-tight truncate">JADI Billing</span>}
        </Link>
        {collapsed ? null : (
          <button type="button" onClick={toggle} aria-expanded aria-controls="primary-nav" title="Collapse sidebar (press [ )" className="ml-auto rounded-md border border-border px-2 py-1 text-xs text-ink-2 hover:bg-surface-2">
            <span aria-hidden>«</span>
            <span className="sr-only">Collapse sidebar</span>
          </button>
        )}
      </div>

      {collapsed ? (
        <button type="button" onClick={toggle} aria-expanded={false} aria-controls="primary-nav" title="Expand sidebar (press [ )" className="mx-2 mt-2 rounded-md border border-border py-1 text-xs text-ink-2 hover:bg-surface-2">
          <span aria-hidden>»</span>
          <span className="sr-only">Expand sidebar</span>
        </button>
      ) : null}

      <NavLinks items={items} collapsed={collapsed} />

      {collapsed ? null : <div className="mt-auto px-4 py-3 text-xs text-ink-3 border-t border-border">Analysis only — no writes to Jenzabar.</div>}
    </aside>
  );
}
