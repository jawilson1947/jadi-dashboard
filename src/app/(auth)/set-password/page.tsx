import { SetPasswordForm } from "./SetPasswordForm";

export const metadata = { title: "Choose a password" };
export const dynamic = "force-dynamic";

/** Landing page for one-time invite / reset tokens: /set-password?token=… */
export default async function SetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return (
    <main className="flex-1 grid place-items-center p-6">
      <div className="card w-full max-w-md">
        <h1 className="text-xl font-semibold leading-tight">Choose your password</h1>
        <p className="text-sm text-ink-2 mt-1 mb-5">Your administrator gave you a one-time link. Set a password to activate your dashboard account.</p>
        <SetPasswordForm token={token ?? ""} />
      </div>
    </main>
  );
}
