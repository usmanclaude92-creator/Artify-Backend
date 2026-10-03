/** Navigation Menu CRUD + publish/revisions/duplicate/revert/usage (Phase 5). Mirrors templatePartRoutes.ts exactly. */
import { Router } from "express";
import { navigationMenuService } from "../../services/navigationMenuService";
import { authenticateToken, requirePermission } from "../../middleware/auth";
import { asyncHandler } from "../../utils/asyncHandler";
import { sendSuccess } from "../../core/apiResponse";
import {
  createNavigationMenuSchema,
  updateNavigationMenuSchema,
  duplicateNavigationMenuSchema,
  revertNavigationMenuSchema,
  listNavigationMenusQuerySchema,
} from "../../schemas/navigationMenuSchemas";

const router = Router();

router.use(authenticateToken);

function requestMeta(req: { ip?: string; headers: Record<string, unknown> }) {
  return { ip: req.ip, userAgent: req.headers["user-agent"] as string | undefined };
}

router.get(
  "/",
  requirePermission("navigation_menus.read"),
  asyncHandler(async (req, res) => {
    const query = listNavigationMenusQuerySchema.parse(req.query);
    const { rows, total } = await navigationMenuService.listMenus(
      req.user!.organizationId,
      { search: query.search, status: query.status, type: query.type },
      query.page,
      query.limit,
      query.sort,
      query.order
    );
    sendSuccess(res, { navigationMenus: rows }, 200, { page: query.page, limit: query.limit, total });
  })
);

router.get(
  "/:id",
  requirePermission("navigation_menus.read"),
  asyncHandler(async (req, res) => {
    const navigationMenu = await navigationMenuService.getMenu(req.user!.organizationId, req.params.id!);
    sendSuccess(res, { navigationMenu });
  })
);

router.get(
  "/:id/revisions",
  requirePermission("navigation_menus.read"),
  asyncHandler(async (req, res) => {
    const revisions = await navigationMenuService.listRevisions(req.user!.organizationId, req.params.id!);
    sendSuccess(res, { revisions });
  })
);

router.get(
  "/:id/usage",
  requirePermission("navigation_menus.read"),
  asyncHandler(async (req, res) => {
    const usage = await navigationMenuService.getUsage(req.user!.organizationId, req.params.id!);
    sendSuccess(res, usage);
  })
);

router.post(
  "/",
  requirePermission("navigation_menus.create"),
  asyncHandler(async (req, res) => {
    const input = createNavigationMenuSchema.parse(req.body);
    const navigationMenu = await navigationMenuService.createMenu(req.user!, input, requestMeta(req));
    sendSuccess(res, { navigationMenu }, 201);
  })
);

router.post(
  "/:id/duplicate",
  requirePermission("navigation_menus.create"),
  asyncHandler(async (req, res) => {
    const input = duplicateNavigationMenuSchema.parse(req.body ?? {});
    const navigationMenu = await navigationMenuService.duplicateMenu(req.user!, req.params.id!, input, requestMeta(req));
    sendSuccess(res, { navigationMenu }, 201);
  })
);

router.patch(
  "/:id",
  requirePermission("navigation_menus.update"),
  asyncHandler(async (req, res) => {
    const input = updateNavigationMenuSchema.parse(req.body);
    const navigationMenu = await navigationMenuService.updateMenu(req.user!, req.params.id!, input, requestMeta(req));
    sendSuccess(res, { navigationMenu });
  })
);

router.post(
  "/:id/publish",
  requirePermission("navigation_menus.publish"),
  asyncHandler(async (req, res) => {
    const navigationMenu = await navigationMenuService.publishMenu(req.user!, req.params.id!, requestMeta(req));
    sendSuccess(res, { navigationMenu });
  })
);

router.post(
  "/:id/archive",
  requirePermission("navigation_menus.delete"),
  asyncHandler(async (req, res) => {
    const navigationMenu = await navigationMenuService.archiveMenu(req.user!, req.params.id!, requestMeta(req));
    sendSuccess(res, { navigationMenu });
  })
);

router.post(
  "/:id/revert",
  requirePermission("navigation_menus.update"),
  asyncHandler(async (req, res) => {
    const input = revertNavigationMenuSchema.parse(req.body);
    const navigationMenu = await navigationMenuService.revertMenu(req.user!, req.params.id!, input, requestMeta(req));
    sendSuccess(res, { navigationMenu });
  })
);

router.delete(
  "/:id",
  requirePermission("navigation_menus.delete"),
  asyncHandler(async (req, res) => {
    await navigationMenuService.deleteMenu(req.user!, req.params.id!, requestMeta(req));
    sendSuccess(res, { message: "Navigation menu deleted." });
  })
);

export default router;
