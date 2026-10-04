/** Case Study CRUD + publish/schedule/revisions (Phase 11 — docs/CASE_STUDY_ARCHITECTURE.md). Reuses the existing content.* permissions (Phase 2) unchanged — zero new permission keys. */
import { Router } from "express";
import { caseStudyService } from "../../services/caseStudyService";
import { authenticateToken, requirePermission } from "../../middleware/auth";
import { asyncHandler } from "../../utils/asyncHandler";
import { sendSuccess } from "../../core/apiResponse";
import { createCaseStudySchema, updateCaseStudySchema, listCaseStudiesQuerySchema } from "../../schemas/caseStudySchemas";
import { scheduleContentSchema, revertContentSchema, bulkContentIdsSchema } from "../../schemas/contentSchemas";
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
    const query = listCaseStudiesQuerySchema.parse(req.query);
    const { rows, total } = await caseStudyService.listCaseStudies(
      req.user!.organizationId,
      { search: query.search, status: query.status, industryId: query.industryId, productId: query.productId, fromDate: query.fromDate, toDate: query.toDate },
      query.page,
      query.limit,
      query.sort,
      query.order
    );
    sendSuccess(res, { caseStudies: rows }, 200, { page: query.page, limit: query.limit, total });
  })
);

// Trash view. Registered before "/:id" so the literal path wins.
router.get(
  "/trash",
  requirePermission("content.read"),
  asyncHandler(async (req, res) => {
    const query = trashQuerySchema.parse(req.query);
    const { rows, total } = await caseStudyService.listTrash(req.user!.organizationId, query.page, query.limit);
    sendSuccess(res, { caseStudies: rows }, 200, { page: query.page, limit: query.limit, total });
  })
);

// Bulk workflow actions, same per-transition-permission convention as
// postRoutes.ts. Registered before "/:id/restore" — otherwise Express
// would match "/bulk/restore" against "/:id/restore" (id="bulk") first.
router.post(
  "/bulk/archive",
  requirePermission("content.delete"),
  asyncHandler(async (req, res) => {
    const input = bulkContentIdsSchema.parse(req.body);
    const result = await caseStudyService.bulkAction(req.user!, "archive", input.ids, requestMeta(req));
    sendSuccess(res, result);
  })
);

router.post(
  "/bulk/trash",
  requirePermission("content.delete"),
  asyncHandler(async (req, res) => {
    const input = bulkContentIdsSchema.parse(req.body);
    const result = await caseStudyService.bulkAction(req.user!, "trash", input.ids, requestMeta(req));
    sendSuccess(res, result);
  })
);

router.post(
  "/bulk/restore",
  requirePermission("content.delete"),
  asyncHandler(async (req, res) => {
    const input = bulkContentIdsSchema.parse(req.body);
    const result = await caseStudyService.bulkAction(req.user!, "restore", input.ids, requestMeta(req));
    sendSuccess(res, result);
  })
);

router.post(
  "/:id/restore",
  requirePermission("content.delete"),
  asyncHandler(async (req, res) => {
    await caseStudyService.restoreCaseStudy(req.user!, req.params.id!, requestMeta(req));
    sendSuccess(res, { message: "Case study restored from trash." });
  })
);

router.get(
  "/:id",
  requirePermission("content.read"),
  asyncHandler(async (req, res) => {
    const caseStudy = await caseStudyService.getCaseStudy(req.user!.organizationId, req.params.id!);
    sendSuccess(res, { caseStudy });
  })
);

router.get(
  "/:id/revisions",
  requirePermission("content.read"),
  asyncHandler(async (req, res) => {
    const revisions = await caseStudyService.listRevisions(req.user!.organizationId, req.params.id!);
    sendSuccess(res, { revisions });
  })
);

router.post(
  "/",
  requirePermission("content.create"),
  asyncHandler(async (req, res) => {
    const input = createCaseStudySchema.parse(req.body);
    const caseStudy = await caseStudyService.createCaseStudy(req.user!, input, requestMeta(req));
    sendSuccess(res, { caseStudy }, 201);
  })
);

router.patch(
  "/:id",
  requirePermission("content.update"),
  asyncHandler(async (req, res) => {
    const input = updateCaseStudySchema.parse(req.body);
    const caseStudy = await caseStudyService.updateCaseStudy(req.user!, req.params.id!, input, requestMeta(req));
    sendSuccess(res, { caseStudy });
  })
);

router.post(
  "/:id/submit-review",
  requirePermission("content.update"),
  asyncHandler(async (req, res) => {
    const caseStudy = await caseStudyService.submitForReview(req.user!, req.params.id!, requestMeta(req));
    sendSuccess(res, { caseStudy });
  })
);

router.post(
  "/:id/publish",
  requirePermission("content.publish"),
  asyncHandler(async (req, res) => {
    const caseStudy = await caseStudyService.publishCaseStudy(req.user!, req.params.id!, requestMeta(req));
    sendSuccess(res, { caseStudy });
  })
);

router.post(
  "/:id/schedule",
  requirePermission("content.publish"),
  asyncHandler(async (req, res) => {
    const input = scheduleContentSchema.parse(req.body);
    const caseStudy = await caseStudyService.scheduleCaseStudy(req.user!, req.params.id!, input, requestMeta(req));
    sendSuccess(res, { caseStudy });
  })
);

router.post(
  "/:id/archive",
  requirePermission("content.delete"),
  asyncHandler(async (req, res) => {
    const caseStudy = await caseStudyService.archiveCaseStudy(req.user!, req.params.id!, requestMeta(req));
    sendSuccess(res, { caseStudy });
  })
);

router.post(
  "/:id/revert",
  requirePermission("content.update"),
  asyncHandler(async (req, res) => {
    const input = revertContentSchema.parse(req.body);
    const caseStudy = await caseStudyService.revertCaseStudy(req.user!, req.params.id!, input, requestMeta(req));
    sendSuccess(res, { caseStudy });
  })
);

router.delete(
  "/:id",
  requirePermission("content.delete"),
  asyncHandler(async (req, res) => {
    await caseStudyService.deleteCaseStudy(req.user!, req.params.id!, requestMeta(req));
    sendSuccess(res, { message: "Case study deleted." });
  })
);

export default router;
