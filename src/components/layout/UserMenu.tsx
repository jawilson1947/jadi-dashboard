"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

export function UserMenu({ displayName, roles, canChangePassword = true }: { displayName: string; roles: string[]; canChangePassword?: boolean }) {
  const router = useRouter();
  async function signOut() {
    await fetch("/api/v1/auth/sign-out", { method: "POST" });
    router.push("/sign-in");
    router.refresh();
  }
  return (
    <div className="flex items-center gap-3 text-sm">
      <div className="text-right leading-tight">
        <div className="font-medium">{displayName}</div>
        <div className="text-xs text-ink-3">{roles.join(", ")}</div>
      </div>
      {canChangePassword ? (
        <Link href="/change-password" className="rounded-md border border-border px-3 py-1.5 hover:bg-surface-2">
          Change password
        </Link>
      ) : null}
      <button type="button" onClick={signOut} className="rounded-md border border-border px-3 py-1.5 hover:bg-surface-2">
        Sign out
      </button>
    </div>
  );
}
