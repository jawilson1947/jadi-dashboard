import { getConfig } from "@/server/db/config";
import { DEV_USERS } from "@/server/auth/dev-users";
import { DevSignInForm } from "./DevSignInForm";
import { SignInForm } from "./SignInForm";

export const metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const devLogin = getConfig().AUTH_DEV_LOGIN;
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

        <button
          type="button"
          disabled
          className="mt-5 w-full rounded-md border border-border py-2 text-sm text-ink-3 opacity-70 cursor-not-allowed"
          title="Institutional single sign-on is configured in Phase 9 (ASSUMPTIONS A-12)"
        >
          Sign in with institutional account (coming later)
        </button>

        {devLogin ? (
          <DevSignInForm users={DEV_USERS.map((u) => ({ username: u.username, displayName: u.displayName, roles: u.roles }))} />
        ) : null}
      </div>
    </main>
  );
}
