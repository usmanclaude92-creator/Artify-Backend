/**
 * Phase 17 — role administration. Roles are platform-global rows (they have no
 * organizationId), so creating/editing them is a SUPER_ADMIN-only platform
 * operation; organization admins keep assigning existing roles to their users
 * (userService / organizationService, with the escalation guard).
 *
 * Protections: system roles are immutable; a role in use cannot be deleted;
 * critical permissions need explicit confirmation; every change is audited
 * with a before/after permission diff.
 */
import { prisma } from "../../db/prisma";
import { AuthorizationError, ConflictError, NotFoundError, ValidationError } from "../../core/errors";
import { auditLogRepository } from "../../repositories/auditLogRepository";
import type { SanitizedUser } from "../../types/domain";
import type { RequestMeta } from "../authService";
import { CRITICAL_PERMISSIONS } from "./criticalPermissions";

function requireSuperAdmin(caller: SanitizedUser): void {
  if (caller.role.key !== "SUPER_ADMIN") throw new AuthorizationError("Only a Super Administrator can manage platform roles.");
}

async function loadCustomRole(id: string) {
  const role = await prisma.role.findUnique({ where: { id }, include: { rolePermissions: { include: { permission: true } } } });
  if (!role) throw new NotFoundError("Role not found.");
  if (role.isSystem) throw new AuthorizationError("System roles are protected and cannot be modified.");
  return role;
}

async function resolvePermissionIds(keys: string[], confirmCritical: boolean) {
  const unique = [...new Set(keys)];
  const perms = await prisma.permission.findMany({ where: { key: { in: unique } } });
  const unknown = unique.filter((k) => !perms.some((p) => p.key === k));
  if (unknown.length) throw new ValidationError(`Unknown permission(s): ${unknown.join(", ")}`);
  const critical = unique.filter((k) => CRITICAL_PERMISSIONS.includes(k));
  if (critical.length && !confirmCritical) {
    throw new ValidationError(`These permissions control security or RBAC and require explicit confirmation: ${critical.join(", ")}`);
  }
  return perms;
}

function slugKey(name: string): string {
  return `CUSTOM_${name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "")}`.slice(0, 50);
}

export const roleAdminService = {
  async list() {
    const roles = await prisma.role.findMany({
      include: { rolePermissions: { include: { permission: true } }, _count: { select: { memberships: true } } },
      orderBy: [{ isSystem: "desc" }, { name: "asc" }],
    });
    return roles.map((r) => ({
      id: r.id,
      key: r.key,
      name: r.name,
      description: r.description,
      isSystem: r.isSystem,
      memberCount: r._count.memberships,
      permissions: r.rolePermissions.map((rp) => rp.permission.key).sort(),
    }));
  },

  async create(caller: SanitizedUser, input: { name: string; description?: string; permissionKeys: string[]; confirmCritical?: boolean }, meta: RequestMeta = {}) {
    requireSuperAdmin(caller);
    const key = slugKey(input.name);
    if (key === "CUSTOM_") throw new ValidationError("Role name must contain letters or digits.");
    if (await prisma.role.findUnique({ where: { key } })) throw new ConflictError("A role with this name already exists.");
    const perms = await resolvePermissionIds(input.permissionKeys, !!input.confirmCritical);

    const role = await prisma.role.create({
      data: {
        key, name: input.name, description: input.description, isSystem: false,
        rolePermissions: { create: perms.map((p) => ({ permissionId: p.id })) },
      },
    });
    await auditLogRepository.record({
      organizationId: caller.organizationId, actorUserId: caller.id, actorType: "USER", action: "ROLE_CREATED",
      resourceType: "role", resourceId: role.id, afterData: { key, permissions: perms.map((p) => p.key).sort() }, ipAddress: meta.ip, userAgent: meta.userAgent,
    });
    return role;
  },

  async update(caller: SanitizedUser, id: string, input: { name?: string; description?: string | null }, meta: RequestMeta = {}) {
    requireSuperAdmin(caller);
    const role = await loadCustomRole(id);
    const updated = await prisma.role.update({ where: { id }, data: { name: input.name, description: input.description } });
    await auditLogRepository.record({
      organizationId: caller.organizationId, actorUserId: caller.id, actorType: "USER", action: "ROLE_UPDATED",
      resourceType: "role", resourceId: id, beforeData: { name: role.name, description: role.description }, afterData: { name: updated.name, description: updated.description },
      ipAddress: meta.ip, userAgent: meta.userAgent,
    });
    return updated;
  },

  async setPermissions(caller: SanitizedUser, id: string, permissionKeys: string[], confirmCritical: boolean, meta: RequestMeta = {}) {
    requireSuperAdmin(caller);
    const role = await loadCustomRole(id);
    const perms = await resolvePermissionIds(permissionKeys, confirmCritical);
    const before = role.rolePermissions.map((rp) => rp.permission.key).sort();
    const after = perms.map((p) => p.key).sort();
    await prisma.$transaction([
      prisma.rolePermission.deleteMany({ where: { roleId: id } }),
      prisma.rolePermission.createMany({ data: perms.map((p) => ({ roleId: id, permissionId: p.id })) }),
    ]);
    await auditLogRepository.record({
      organizationId: caller.organizationId, actorUserId: caller.id, actorType: "USER", action: "ROLE_PERMISSIONS_CHANGED",
      resourceType: "role", resourceId: id,
      beforeData: { permissions: before },
      afterData: { permissions: after, added: after.filter((k) => !before.includes(k)), removed: before.filter((k) => !after.includes(k)) },
      ipAddress: meta.ip, userAgent: meta.userAgent,
    });
    return { id, key: role.key, permissions: after };
  },

  async remove(caller: SanitizedUser, id: string, meta: RequestMeta = {}) {
    requireSuperAdmin(caller);
    const role = await loadCustomRole(id);
    const [memberships, invitations] = await Promise.all([
      prisma.organizationMembership.count({ where: { roleId: id } }),
      prisma.workspaceInvitation.count({ where: { roleId: id } }),
    ]);
    if (memberships + invitations > 0) throw new ConflictError("This role is still assigned to users or invitations. Reassign them first.");
    await prisma.$transaction(async (tx) => {
      // User.roleId is a legacy "home role" pointer that role changes through
      // memberships do not update; repoint any stale one to the user's current
      // primary membership role so the FK doesn't block removing an unused role.
      const stale = await tx.user.findMany({ where: { roleId: id }, select: { id: true } });
      for (const u of stale) {
        const m = await tx.organizationMembership.findFirst({ where: { userId: u.id }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }], select: { roleId: true } });
        const fallback = m?.roleId ?? (await tx.role.findUniqueOrThrow({ where: { key: "VIEWER" } })).id;
        await tx.user.update({ where: { id: u.id }, data: { roleId: fallback } });
      }
      await tx.role.delete({ where: { id } });
    });
    await auditLogRepository.record({
      organizationId: caller.organizationId, actorUserId: caller.id, actorType: "USER", action: "ROLE_DELETED",
      resourceType: "role", resourceId: id, beforeData: { key: role.key, name: role.name }, ipAddress: meta.ip, userAgent: meta.userAgent,
    });
  },
};
