import { PublicFooter } from "@/components/layout/PublicFooter";
import { SignInForm } from "./SignInForm";

export const metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <main className="flex-1 grid place-items-center p-6">
      <div className="card w-full max-w-md">
        <div className="flex items-center gap-3 mb-6">
          <div aria-hidden className="h-10 w-10 rounded-lg bg-brand" />
          <div>
            <h1 className="text-xl font-semibold leading-tight">JADI Dashboard</h1>
            <p className="text-sm text-ink-2">Student billing analysis</p>
          </div>
        </div>

        <SignInForm next={next} />
        <PublicFooter />
      </div>
    </main>
  );
}
