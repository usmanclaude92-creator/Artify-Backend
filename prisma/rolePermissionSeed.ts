/**
 * Shared role/permission seeding logic — the reference data (not tenant
 * data) every environment needs to exist before auth can work at all
 * (authService.register looks up the ADMIN role by key). Imported by both
 * prisma/seed.ts (developer-run, also seeds one bootstrap admin) and
 * tests/setup.ts (idempotent upsert, run once before the suite; tenant
 * data — organizations/users/sessions/audit_logs — is wiped and rebuilt
 * per test via tests/helpers/db.ts's resetDb(), but this reference data
 * is not, matching how a real deployment treats its role/permission
 * catalog as stable configuration, not per-test fixture data).
 */
import type { PrismaClient } from "@prisma/client";
import { PERMISSION_KEYS, ROLE_DEFINITIONS, SYSTEM_ROLE_KEYS, type RoleKey } from "../server/types/domain";

function moduleOf(key: string): string {
  return key.split(".")[0] ?? key;
}

function permissionName(key: string): string {
  const [, action] = key.split(".");
  return `${moduleOf(key)}: ${action ?? key}`.replace(/\b\w/g, (c) => c.toUpperCase());
}

const ROLE_PERMISSION_SETS: Record<RoleKey, readonly string[] | "*"> = {
  SUPER_ADMIN: "*",
  ADMIN: [
    "users.read",
    "users.create",
    "users.update",
    "organizations.read",
    "organizations.update",
    "clients.read",
    "clients.create",
    "clients.update",
    "clients.delete",
    "leads.read",
    "leads.create",
    "leads.update",
    "leads.delete",
    "products.read",
    "content.read",
    "content.create",
    "content.update",
    "content.publish",
    "content.delete",
    "media.read",
    "media.upload",
    "media.update",
    "media.delete",
    "subscriptions.read",
    "subscriptions.manage",
    "billing.read",
    "billing.manage",
    "reports.read",
    "reports.export",
    "settings.read",
    "settings.manage",
    "audit.read",
    "ai.use",
    "ai.manage",
  ],
  MANAGER: [
    "users.read",
    "clients.read",
    "clients.create",
    "clients.update",
    "leads.read",
    "leads.create",
    "leads.update",
    "products.read",
    "content.read",
    "content.create",
    "content.update",
    "media.read",
    "media.upload",
    "media.update",
    "subscriptions.read",
    "billing.read",
    "reports.read",
    "ai.use",
  ],
  USER: [
    "clients.read",
    "leads.read",
    "leads.create",
    "leads.update",
    "products.read",
    "content.read",
    "content.create",
    "media.read",
    "media.upload",
    "reports.read",
    "ai.use",
  ],
  VIEWER: [
    "users.read",
    "organizations.read",
    "clients.read",
    "leads.read",
    "products.read",
    "content.read",
    "media.read",
    "subscriptions.read",
    "billing.read",
    "reports.read",
    "settings.read",
    "audit.read",
  ],
};

export async function seedRolesAndPermissions(prisma: PrismaClient): Promise<Record<RoleKey, string>> {
  for (const key of PERMISSION_KEYS) {
    await prisma.permission.upsert({
      where: { key },
      update: {},
      create: { key, name: permissionName(key), module: moduleOf(key) },
    });
  }

  const roleIds = {} as Record<RoleKey, string>;

  for (const key of SYSTEM_ROLE_KEYS) {
    const def = ROLE_DEFINITIONS[key];
    const role = await prisma.role.upsert({
      where: { key },
      update: {},
      create: { key, name: def.name, description: def.description, isSystem: true },
    });
    roleIds[key] = role.id;

    const grantedKeys = ROLE_PERMISSION_SETS[key] === "*" ? PERMISSION_KEYS : ROLE_PERMISSION_SETS[key];
    const permissions = await prisma.permission.findMany({ where: { key: { in: [...grantedKeys] } } });

    for (const permission of permissions) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
        update: {},
        create: { roleId: role.id, permissionId: permission.id },
      });
    }
  }

  return roleIds;
}
