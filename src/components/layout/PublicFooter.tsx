import Link from "next/link";
import { SITE_INFO } from "@/content/site-info";

const LINKS = [
  { href: "/about", label: "About us" },
  { href: "/privacy", label: "Privacy policy" },
  { href: "/support", label: "Support" },
] as const;

/** Footer for the pages a signed-out visitor can reach (sign-in and the three public pages). */
export function PublicFooter() {
  return (
    <footer className="mt-8 border-t border-border pt-4 text-center text-xs text-ink-3">
      <nav aria-label="Site information" className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
        {LINKS.map((l) => (
          <Link key={l.href} href={l.href} className="hover:text-ink-1 underline-offset-2 hover:underline">
            {l.label}
          </Link>
        ))}
      </nav>
      <p className="mt-2">
        {SITE_INFO.appName} · built and maintained by {SITE_INFO.vendor}
      </p>
    </footer>
  );
}
