/**
 * Liveness/readiness (Phase 1 §10) plus a minimal, authenticated database
 * verification endpoint (Phase 2 §57). Fixes Phase 0 finding S9: the old
 * /api/health always reported `"database": "connected"` with no database
 * in existence. Readiness performs a real query with a bounded timeout;
 * /database reports only safe aggregate metadata — table row counts and
 * applied-migration names — never a connection string, credential, or raw
 * driver error (§67).
 */
import { Router } from "express";
import { checkDatabase } from "../../db/health";
import { prisma } from "../../db/prisma";
import { sendSuccess } from "../../core/apiResponse";
import { asyncHandler } from "../../utils/asyncHandler";
import { authenticateToken, requireRole } from "../../middleware/auth";
import { config } from "../../config/env";
import { seedRolesAndPermissions } from "../../../prisma/rolePermissionSeed";

const router = Router();

/** Liveness: is the process up and able to handle a request at all. */
router.get("/live", (_req, res) => {
  sendSuccess(res, { status: "alive", timestamp: new Date().toISOString() });
});

/** Readiness: can the process reach the infrastructure it needs to serve traffic. */
router.get(
  "/ready",
  asyncHandler(async (_req, res) => {
    const dbCheck = await checkDatabase();
    const dependencies = [dbCheck];
    const healthy = dependencies.every((dep) => dep.healthy);

    sendSuccess(
      res,
      {
        status: healthy ? "ready" : "not_ready",
        environment: config.nodeEnv,
        dependencies: dependencies.map((dep) => ({ name: dep.name, healthy: dep.healthy, latencyMs: dep.latencyMs })),
        timestamp: new Date().toISOString(),
      },
      healthy ? 200 : 503
    );
  })
);

interface MigrationRow {
  migration_name: string;
  finished_at: Date | null;
}

/**
 * SUPER_ADMIN-only (§67: "Do not expose raw database schema or sensitive
 * diagnostics publicly"). Reports the shape described in §67's example —
 * provider, migration status, safe row counts — nothing that could help
 * an attacker (no connection string, no table/column names beyond what's
 * already public in this open-source-shaped schema, no credentials).
 */
router.get(
  "/database",
  authenticateToken,
  requireRole(["SUPER_ADMIN"]),
  asyncHandler(async (_req, res) => {
    const dbCheck = await checkDatabase();

    const [migrations, organizationCount, userCount, roleCount, permissionCount] = await Promise.all([
      prisma.$queryRaw<MigrationRow[]>`SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY finished_at ASC`,
      prisma.organization.count(),
      prisma.user.count(),
      prisma.role.count(),
      prisma.permission.count(),
    ]);

    sendSuccess(res, {
      provider: "PostgreSQL",
      healthy: dbCheck.healthy,
      latencyMs: dbCheck.latencyMs,
      migrations: {
        applied: migrations.filter((m) => m.finished_at !== null).length,
        pending: migrations.filter((m) => m.finished_at === null).length,
        names: migrations.map((m) => m.migration_name),
      },
      counts: {
        organizations: organizationCount,
        users: userCount,
        roles: roleCount,
        permissions: permissionCount,
      },
    });
  })
);

/**
 * SUPER_ADMIN-only. Re-applies the permission/role catalog defined in
 * prisma/rolePermissionSeed.ts — additive and idempotent (upserts only,
 * never deletes or mutates existing rows), so it's safe to call any time
 * a deploy adds new permission keys that an already-provisioned
 * environment's database hasn't picked up yet (the normal `npm run
 * db:seed` path only runs against a developer's local database, per its
 * own doc comment — there is no deploy hook that reseeds a hosted
 * environment automatically).
 */
router.post(
  "/sync-permissions",
  authenticateToken,
  requireRole(["SUPER_ADMIN"]),
  asyncHandler(async (_req, res) => {
    const [beforePermissions, beforeRolePermissions] = await Promise.all([
      prisma.permission.count(),
      prisma.rolePermission.count(),
    ]);

    await seedRolesAndPermissions(prisma);

    const [afterPermissions, afterRolePermissions] = await Promise.all([
      prisma.permission.count(),
      prisma.rolePermission.count(),
    ]);

    sendSuccess(res, {
      permissionsAdded: afterPermissions - beforePermissions,
      rolePermissionLinksAdded: afterRolePermissions - beforeRolePermissions,
      totalPermissions: afterPermissions,
      totalRolePermissionLinks: afterRolePermissions,
    });
  })
);

export default router;
