import type { Permission, Role } from "../authz/permissions";

/**
 * Dev-only accounts for the mock-data prototype (Spec §23.9). Enabled only when
 * AUTH_DEV_LOGIN=true; refused in production by config validation. Replaced by SSO in Phase 9.
 * These are synthetic identities — not real users.
 */
export interface DevUser {
  userId: string;
  username: string;
  displayName: string;
  email: string;
  roles: Role[];
  extraPermissions: Permission[];
}

export const DEV_USERS: DevUser[] = [
  { userId: "u-admin", username: "admin", displayName: "Alex Admin", email: "admin@example.edu", roles: ["ADMINISTRATOR"], extraPermissions: [] },
  { userId: "u-operator", username: "operator", displayName: "Olive Operator", email: "operator@example.edu", roles: ["OPERATOR"], extraPermissions: [] },
  { userId: "u-viewer", username: "viewer", displayName: "Vic Viewer", email: "viewer@example.edu", roles: ["VIEWER"], extraPermissions: [] },
  // Viewer with the explicit student.view grant described in Spec §3.3.
  { userId: "u-viewer-plus", username: "viewer-plus", displayName: "Val Viewer (student access)", email: "viewer.plus@example.edu", roles: ["VIEWER"], extraPermissions: ["student.view"] },
];

export function findDevUser(username: string): DevUser | undefined {
  return DEV_USERS.find((u) => u.username === username.trim().toLowerCase());
}
