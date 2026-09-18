"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Permission } from "@/server/authz/permissions";

export interface NavItem {
  href: string;
  label: string;
  permission: Permission;
}

export function NavLinks({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav className="p-2 space-y-0.5">
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(item.href + "/");
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`block rounded-md px-3 py-2 text-sm ${
              active ? "bg-brand-track text-ink font-medium" : "text-ink-2 hover:bg-surface-2"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
