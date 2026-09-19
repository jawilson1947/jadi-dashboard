"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Permission } from "@/server/authz/permissions";

export interface NavItem {
  href: string;
  label: string;
  /** Three-letter code shown when the sidebar is collapsed; the full label stays available to screen readers. */
  abbr: string;
  permission: Permission;
}

export function NavLinks({ items, collapsed = false }: { items: NavItem[]; collapsed?: boolean }) {
  const pathname = usePathname();
  return (
    <nav id="primary-nav" className="p-2 space-y-0.5" aria-label="Sections">
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(item.href + "/");
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            title={collapsed ? item.label : undefined}
            className={`block rounded-md px-3 py-2 text-sm ${collapsed ? "text-center font-mono tracking-tight" : ""} ${
              active ? "bg-brand-track text-ink font-medium" : "text-ink-2 hover:bg-surface-2"
            }`}
          >
            {collapsed ? (
              <>
                <span aria-hidden>{item.abbr}</span>
                <span className="sr-only">{item.label}</span>
              </>
            ) : (
              item.label
            )}
          </Link>
        );
      })}
    </nav>
  );
}
