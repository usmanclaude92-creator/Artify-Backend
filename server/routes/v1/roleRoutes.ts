/** Role/permission catalog. Phase 17 adds platform-level custom-role management (SUPER_ADMIN only; system roles stay immutable). */
import { Router } from "express";
import { prisma } from "../../db/prisma";
import { roleAdminService } from "../../services/admin/roleAdminService";
import { createRoleSchema, setRolePermissionsSchema, updateRoleSchema } from "../../schemas/adminSchemas";
import { sensitiveActionLimiter } from "../../middleware/rateLimiter";
import { authenticateToken, requirePermission } from "../../middleware/auth";
import { asyncHandler } from "../../utils/asyncHandler";
import { sendSuccess } from "../../core/apiResponse";

const router = Router();

router.use(authenticateToken);

router.get(
  "/",
  requirePermission("roles.read"),
  asyncHandler(async (_req, res) => {
    sendSuccess(res, { roles: await roleAdminService.list() });
  })
);

const meta = (req: import("express").Request) => ({ ip: req.ip, userAgent: req.headers["user-agent"] });

router.post(
  "/",
  requirePermission("roles.create"),
  sensitiveActionLimiter,
  asyncHandler(async (req, res) => sendSuccess(res, { role: await roleAdminService.create(req.user!, createRoleSchema.parse(req.body), meta(req)) }, 201))
);
router.patch(
  "/:id",
  requirePermission("roles.update"),
  asyncHandler(async (req, res) => sendSuccess(res, { role: await roleAdminService.update(req.user!, req.params.id!, updateRoleSchema.parse(req.body), meta(req)) }))
);
router.put(
  "/:id/permissions",
  requirePermission("roles.update"),
  sensitiveActionLimiter,
  asyncHandler(async (req, res) => {
    const { permissionKeys, confirmCritical } = setRolePermissionsSchema.parse(req.body);
    sendSuccess(res, { role: await roleAdminService.setPermissions(req.user!, req.params.id!, permissionKeys, confirmCritical, meta(req)) });
  })
);
router.delete(
  "/:id",
  requirePermission("roles.delete"),
  sensitiveActionLimiter,
  asyncHandler(async (req, res) => {
    await roleAdminService.remove(req.user!, req.params.id!, meta(req));
    sendSuccess(res, { message: "Role deleted." });
  })
);

export default router;

export const permissionsRouter = Router();
permissionsRouter.use(authenticateToken);
permissionsRouter.get(
  "/",
  requirePermission("roles.read"),
  asyncHandler(async (_req, res) => {
    const permissions = await prisma.permission.findMany({ orderBy: [{ module: "asc" }, { key: "asc" }] });
    sendSuccess(res, { permissions });
  })
);
