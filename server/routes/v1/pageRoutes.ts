/** Page CRUD + publish/schedule/revisions (Phase 8 — docs/CMS_ARCHITECTURE.md). Reuses the existing content.* permissions (Phase 2) unchanged. */
import { Router } from "express";
import { pageService } from "../../services/pageService";
import { authenticateToken, requirePermission } from "../../middleware/auth";
import { asyncHandler } from "../../utils/asyncHandler";
import { sendSuccess } from "../../core/apiResponse";
import { createPageSchema, updatePageSchema } from "../../schemas/pageSchemas";
import { listContentQuerySchema, scheduleContentSchema, revertContentSchema, bulkContentIdsSchema } from "../../schemas/contentSchemas";
import { z } from "zod";

const trashQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

const router = Router();

router.use(authenticateToken);

function requestMeta(req: { ip?: string; headers: Record<string, unknown> }) {
  return { ip: req.ip, userAgent: req.headers["user-agent"] as string | undefined };
}

router.get(
  "/",
  requirePermission("content.read"),
  asyncHandler(async (req, res) => {
    const query = listContentQuerySchema.parse(req.query);
    const { rows, total } = await pageService.listPages(
      req.user!.organizationId,
      { search: query.search, status: query.status, fromDate: query.fromDate, toDate: query.toDate },
      query.page,
      query.limit,
      query.sort,
      query.order
    );
    sendSuccess(res, { pages: rows }, 200, { page: query.page, limit: query.limit, total });
  })
);

// Phase 7 — Trash view. Registered before "/:id" so the literal path wins.
router.get(
  "/trash",
  requirePermission("content.read"),
  asyncHandler(async (req, res) => {
    const query = trashQuerySchema.parse(req.query);
    const { rows, total } = await pageService.listTrash(req.user!.organizationId, query.page, query.limit);
    sendSuccess(res, { pages: rows }, 200, { page: query.page, limit: query.limit, total });
  })
);

// Phase 7 — bulk workflow actions, same per-action permission convention
// as postRoutes.ts, and registered before "/:id/restore" for the same
// route-collision reason (see postRoutes.ts's comment).
router.post(
  "/bulk/archive",
  requirePermission("content.delete"),
  asyncHandler(async (req, res) => {
    const input = bulkContentIdsSchema.parse(req.body);
    const result = await pageService.bulkAction(req.user!, "archive", input.ids, requestMeta(req));
    sendSuccess(res, result);
  })
);

router.post(
  "/bulk/trash",
  requirePermission("content.delete"),
  asyncHandler(async (req, res) => {
    const input = bulkContentIdsSchema.parse(req.body);
    const result = await pageService.bulkAction(req.user!, "trash", input.ids, requestMeta(req));
    sendSuccess(res, result);
  })
);

router.post(
  "/bulk/restore",
  requirePermission("content.delete"),
  asyncHandler(async (req, res) => {
    const input = bulkContentIdsSchema.parse(req.body);
    const result = await pageService.bulkAction(req.user!, "restore", input.ids, requestMeta(req));
    sendSuccess(res, result);
  })
);

router.post(
  "/:id/restore",
  requirePermission("content.delete"),
  asyncHandler(async (req, res) => {
    await pageService.restorePage(req.user!, req.params.id!, requestMeta(req));
    sendSuccess(res, { message: "Page restored from trash." });
  })
);

router.get(
  "/:id",
  requirePermission("content.read"),
  asyncHandler(async (req, res) => {
    const page = await pageService.getPage(req.user!.organizationId, req.params.id!);
    sendSuccess(res, { page });
  })
);

router.get(
  "/:id/revisions",
  requirePermission("content.read"),
  asyncHandler(async (req, res) => {
    const revisions = await pageService.listRevisions(req.user!.organizationId, req.params.id!);
    sendSuccess(res, { revisions });
  })
);

router.get(
  "/:id/children",
  requirePermission("content.read"),
  asyncHandler(async (req, res) => {
    const children = await pageService.getChildren(req.user!.organizationId, req.params.id!);
    sendSuccess(res, { children });
  })
);

router.post(
  "/",
  requirePermission("content.create"),
  asyncHandler(async (req, res) => {
    const input = createPageSchema.parse(req.body);
    const page = await pageService.createPage(req.user!, input, requestMeta(req));
    sendSuccess(res, { page }, 201);
  })
);

router.patch(
  "/:id",
  requirePermission("content.update"),
  asyncHandler(async (req, res) => {
    const input = updatePageSchema.parse(req.body);
    const page = await pageService.updatePage(req.user!, req.params.id!, input, requestMeta(req));
    sendSuccess(res, { page });
  })
);

router.post(
  "/:id/submit-review",
  requirePermission("content.update"),
  asyncHandler(async (req, res) => {
    const page = await pageService.submitForReview(req.user!, req.params.id!, requestMeta(req));
    sendSuccess(res, { page });
  })
);

router.post(
  "/:id/publish",
  requirePermission("content.publish"),
  asyncHandler(async (req, res) => {
    const page = await pageService.publishPage(req.user!, req.params.id!, requestMeta(req));
    sendSuccess(res, { page });
  })
);

router.post(
  "/:id/schedule",
  requirePermission("content.publish"),
  asyncHandler(async (req, res) => {
    const input = scheduleContentSchema.parse(req.body);
    const page = await pageService.schedulePage(req.user!, req.params.id!, input, requestMeta(req));
    sendSuccess(res, { page });
  })
);

router.post(
  "/:id/archive",
  requirePermission("content.delete"),
  asyncHandler(async (req, res) => {
    const page = await pageService.archivePage(req.user!, req.params.id!, requestMeta(req));
    sendSuccess(res, { page });
  })
);

router.post(
  "/:id/revert",
  requirePermission("content.update"),
  asyncHandler(async (req, res) => {
    const input = revertContentSchema.parse(req.body);
    const page = await pageService.revertPage(req.user!, req.params.id!, input, requestMeta(req));
    sendSuccess(res, { page });
  })
);

router.delete(
  "/:id",
  requirePermission("content.delete"),
  asyncHandler(async (req, res) => {
    await pageService.deletePage(req.user!, req.params.id!, requestMeta(req));
    sendSuccess(res, { message: "Page deleted." });
  })
);

export default router;
