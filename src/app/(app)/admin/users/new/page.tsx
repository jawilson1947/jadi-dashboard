import { getPrincipal } from "@/server/auth/session";
import { PERMISSIONS, requirePermission } from "@/server/authz/permissions";
import { PageHeader } from "@/components/layout/PageHeader";
import { UserForm } from "@/components/admin/users/UserForm";

export const metadata = { title: "New user" };
export const dynamic = "force-dynamic";

export default async function NewUserPage() {
  requirePermission(await getPrincipal(), "user.manage");
  return (
    <>
      <PageHeader title="New user" description="The account is created as Invited. You receive a one-time link to hand to the person; they choose their own password and the account becomes Active." />
      <div className="card">
        <UserForm mode="create" initial={{ username: "", email: "", displayName: "", roles: ["VIEWER"], permissions: [] }} allPermissions={PERMISSIONS} />
      </div>
    </>
  );
}
