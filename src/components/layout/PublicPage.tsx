import Link from "next/link";
import { PublicFooter } from "./PublicFooter";

/** Shell for the public information pages: readable column, a way back to sign-in, the footer. */
export function PublicPage({ title, intro, children }: { title: string; intro?: string; children: React.ReactNode }) {
  return (
    <main className="flex-1 p-6">
      <div className="mx-auto w-full max-w-2xl">
        <div className="card">
          <h1 className="text-xl font-semibold leading-tight">{title}</h1>
          {intro ? <p className="mt-1 text-sm text-ink-2">{intro}</p> : null}
          <div className="mt-5 space-y-5 text-sm leading-relaxed">{children}</div>
          <p className="mt-6 text-sm">
            <Link href="/sign-in" className="text-brand hover:underline">
              ← Back to sign in
            </Link>
          </p>
          <PublicFooter />
        </div>
      </div>
    </main>
  );
}

/** A titled block; keeps the three pages visually identical without repeating markup. */
export function Section({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium text-ink-2">{heading}</h2>
      {children}
    </section>
  );
}
