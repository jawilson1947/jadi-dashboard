import { redirect } from "next/navigation";
import { getPrincipal } from "@/server/auth/session";
import { ChangePasswordForm } from "./ChangePasswordForm";

export const metadata = { title: "Change password" };
export const dynamic = "force-dynamic";

export default async function ChangePasswordPage() {
  const principal = await getPrincipal();
  if (!principal) redirect("/sign-in?next=/change-password");
  return (
    <main className="flex-1 grid place-items-center p-6">
      <div className="card w-full max-w-md">
        <h1 className="text-xl font-semibold leading-tight">Change your password</h1>
        <p className="text-sm text-ink-2 mt-1 mb-5">
          {principal.mustChangePassword ? "You must choose a new password before continuing." : `Signed in as ${principal.displayName}. Other sessions will be signed out.`}
        </p>
        <ChangePasswordForm forced={Boolean(principal.mustChangePassword)} />
      </div>
    </main>
  );
}
