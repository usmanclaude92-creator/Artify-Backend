import type { Role } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { AuthorizationError } from "../../core/errors";
import type { SanitizedUser } from "../../types/domain";

/**
 * Privilege-escalation guard for every role assignment (user create/update,
 * organization membership add/update): a caller may only hand out a role
 * whose permissions are a subset of their own. SUPER_ADMIN is exempt (it holds
 * everything) but still can never assign SUPER_ADMIN through the API.
 */
export async function assertCallerMayAssignRole(caller: SanitizedUser, role: Pick<Role, "id" | "key">): Promise<void> {
  if (role.key === "SUPER_ADMIN") throw new AuthorizationError("The SUPER_ADMIN role cannot be assigned through the API.");
  if (caller.role.key === "SUPER_ADMIN") return;
  const perms = await prisma.rolePermission.findMany({ where: { roleId: role.id }, select: { permission: { select: { key: true } } } });
  const exceeding = perms.map((p) => p.permission.key).filter((k) => !caller.role.permissions.includes(k));
  if (exceeding.length > 0) {
    throw new AuthorizationError("You cannot assign a role that grants permissions you do not hold yourself.");
  }
}

/** Only a SUPER_ADMIN may modify (status, profile, role, sessions) another SUPER_ADMIN's account. */
export function assertCallerMayManageTarget(caller: SanitizedUser, targetRoleKey: string): void {
  if (targetRoleKey === "SUPER_ADMIN" && caller.role.key !== "SUPER_ADMIN") {
    throw new AuthorizationError("Only a Super Administrator can modify a Super Administrator account.");
  }
}
