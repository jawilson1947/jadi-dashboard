import { describe, expect, it } from "vitest";
import { ForbiddenError, UnauthenticatedError, hasPermission, requirePermission, type Principal } from "@/server/authz/permissions";

const admin: Principal = { userId: "a", displayName: "A", email: "a@x", roles: ["ADMINISTRATOR"], extraPermissions: [] };
const operator: Principal = { ...admin, userId: "o", roles: ["OPERATOR"] };
const viewer: Principal = { ...admin, userId: "v", roles: ["VIEWER"] };
const viewerPlus: Principal = { ...viewer, extraPermissions: ["student.view"] };

describe("role permissions (Spec §3)", () => {
  it("administrators hold every permission", () => {
    expect(hasPermission(admin, "user.manage")).toBe(true);
    expect(hasPermission(admin, "audit.view")).toBe(true);
  });
  it("operators cannot manage users, metadata, schedules or connections", () => {
    expect(hasPermission(operator, "student.view")).toBe(true);
    expect(hasPermission(operator, "export.create")).toBe(true);
    for (const p of ["user.manage", "metadata.manage", "schedule.manage", "connection.manage"] as const) {
      expect(hasPermission(operator, p)).toBe(false);
    }
  });
  it("viewers get aggregates only unless explicitly granted student.view", () => {
    expect(hasPermission(viewer, "dashboard.view")).toBe(true);
    expect(hasPermission(viewer, "student.view")).toBe(false);
    expect(hasPermission(viewer, "export.create")).toBe(false);
    expect(hasPermission(viewerPlus, "student.view")).toBe(true);
  });
  it("requirePermission throws typed errors", () => {
    expect(() => requirePermission(null, "dashboard.view")).toThrow(UnauthenticatedError);
    expect(() => requirePermission(viewer, "student.view")).toThrow(ForbiddenError);
    expect(requirePermission(operator, "student.view")).toBe(operator);
  });
});
