/**
 * Roles and granular permissions (Spec §3). Authorization is enforced server-side in
 * requirePermission(); the UI only uses these to hide what a user cannot do.
 */
export const PERMISSIONS = [
  "dashboard.view",
  "history.view",
  "student.view",
  "student.pid.view",
  // Phase 5 (A-29): DOB and CNP on the bio card. Masked for everyone else; revealing is audited.
  "student.pii.view",
  // Phase 5: both transaction cards and the payment analysis (Bio Spec 2-3).
  "student.transactions.view",
  // Phase 5: the live financial-clearance recomputation (Bio Spec 4-5), distinct from the filed worksheet PDF.
  "student.clearance.analyze",
  "student.academic.view",
  "worksheet.view",
  "export.create",
  "mailmerge.create",
  "operator.manage",
  "user.manage",
  "metadata.manage",
  "schedule.manage",
  "connection.manage",
  "ai.view",
  // Phase 5f (A-26): drafting a collection notice sends IDENTIFIED student data to an external model.
  // Separate from ai.view, which only reads aggregate narratives.
  "ai.notice.create",
  "audit.view",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const ROLES = ["ADMINISTRATOR", "OPERATOR", "VIEWER"] as const;
export type Role = (typeof ROLES)[number];

/** Default permission sets per role (Spec §3.1–3.3). Admins may add granular grants per user. */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  ADMINISTRATOR: PERMISSIONS,
  OPERATOR: [
    "dashboard.view",
    "history.view",
    "student.view",
    "student.transactions.view",
    "student.clearance.analyze",
    "worksheet.view",
    "export.create",
    "mailmerge.create",
    "ai.view",
  ],
  // Viewers get aggregate dashboards only; student-level data requires an explicit grant (§3.3).
  VIEWER: ["dashboard.view", "history.view"],
};

export interface Principal {
  userId: string;
  displayName: string;
  email: string;
  roles: Role[];
  /** Explicit per-user grants in addition to role defaults (§3.3 Viewer exception). */
  extraPermissions: Permission[];
  /** Server-side session backing this principal (absent for system/bootstrap actors). */
  sessionId?: string;
  /** Set after an invite/reset until the user chooses a password; the shell redirects to change-password. */
  mustChangePassword?: boolean;
  /** False for accounts without a local password (dev accounts, SSO-only users). */
  hasLocalPassword?: boolean;
}

export function effectivePermissions(p: Principal): Set<Permission> {
  const set = new Set<Permission>();
  for (const role of p.roles) for (const perm of ROLE_PERMISSIONS[role]) set.add(perm);
  for (const perm of p.extraPermissions) set.add(perm);
  return set;
}

export function hasPermission(p: Principal | null, permission: Permission): boolean {
  return p !== null && effectivePermissions(p).has(permission);
}

export class ForbiddenError extends Error {
  constructor(public readonly permission: Permission) {
    super(`Missing permission: ${permission}`);
    this.name = "ForbiddenError";
  }
}

export class UnauthenticatedError extends Error {
  constructor() {
    super("Authentication required");
    this.name = "UnauthenticatedError";
  }
}

/** Throws unless the principal holds the permission. Used at the top of every API handler. */
export function requirePermission(p: Principal | null, permission: Permission): Principal {
  if (!p) throw new UnauthenticatedError();
  if (!hasPermission(p, permission)) throw new ForbiddenError(permission);
  return p;
}
