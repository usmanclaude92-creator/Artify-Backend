/** Template CRUD + publish/revisions/duplicate/revert (Phase 1 — docs/control-center-replacement-roadmap.md). Mirrors pageRoutes.ts exactly. */
import { Router } from "express";
import { templateService } from "../../services/templateService";
import { authenticateToken, requirePermission } from "../../middleware/auth";
import { asyncHandler } from "../../utils/asyncHandler";
import { sendSuccess } from "../../core/apiResponse";
import { createTemplateSchema, updateTemplateSchema, duplicateTemplateSchema, revertTemplateSchema, listTemplatesQuerySchema } from "../../schemas/templateSchemas";

const router = Router();

router.use(authenticateToken);

function requestMeta(req: { ip?: string; headers: Record<string, unknown> }) {
  return { ip: req.ip, userAgent: req.headers["user-agent"] as string | undefined };
}

router.get(
  "/",
  requirePermission("templates.read"),
  asyncHandler(async (req, res) => {
    const query = listTemplatesQuerySchema.parse(req.query);
    const { rows, total } = await templateService.listTemplates(
      req.user!.organizationId,
      { search: query.search, status: query.status, type: query.type },
      query.page,
      query.limit,
      query.sort,
      query.order
    );
    sendSuccess(res, { templates: rows }, 200, { page: query.page, limit: query.limit, total });
  })
);

router.get(
  "/:id",
  requirePermission("templates.read"),
  asyncHandler(async (req, res) => {
    const template = await templateService.getTemplate(req.user!.organizationId, req.params.id!);
    sendSuccess(res, { template });
  })
);

router.get(
  "/:id/revisions",
  requirePermission("templates.read"),
  asyncHandler(async (req, res) => {
    const revisions = await templateService.listRevisions(req.user!.organizationId, req.params.id!);
    sendSuccess(res, { revisions });
  })
);

router.get(
  "/:id/usage",
  requirePermission("templates.read"),
  asyncHandler(async (req, res) => {
    const usage = await templateService.getUsage(req.user!.organizationId, req.params.id!);
    sendSuccess(res, usage);
  })
);

router.get(
  "/:id/preview",
  requirePermission("templates.read"),
  asyncHandler(async (req, res) => {
    const preview = await templateService.previewTemplate(req.user!.organizationId, req.params.id!);
    sendSuccess(res, preview);
  })
);

router.post(
  "/",
  requirePermission("templates.create"),
  asyncHandler(async (req, res) => {
    const input = createTemplateSchema.parse(req.body);
    const template = await templateService.createTemplate(req.user!, input, requestMeta(req));
    sendSuccess(res, { template }, 201);
  })
);

router.post(
  "/:id/duplicate",
  requirePermission("templates.create"),
  asyncHandler(async (req, res) => {
    const input = duplicateTemplateSchema.parse(req.body ?? {});
    const template = await templateService.duplicateTemplate(req.user!, req.params.id!, input, requestMeta(req));
    sendSuccess(res, { template }, 201);
  })
);

router.patch(
  "/:id",
  requirePermission("templates.update"),
  asyncHandler(async (req, res) => {
    const input = updateTemplateSchema.parse(req.body);
    const template = await templateService.updateTemplate(req.user!, req.params.id!, input, requestMeta(req));
    sendSuccess(res, { template });
  })
);

router.post(
  "/:id/publish",
  requirePermission("templates.publish"),
  asyncHandler(async (req, res) => {
    const template = await templateService.publishTemplate(req.user!, req.params.id!, requestMeta(req));
    sendSuccess(res, { template });
  })
);

router.post(
  "/:id/archive",
  requirePermission("templates.delete"),
  asyncHandler(async (req, res) => {
    const template = await templateService.archiveTemplate(req.user!, req.params.id!, requestMeta(req));
    sendSuccess(res, { template });
  })
);

router.post(
  "/:id/revert",
  requirePermission("templates.update"),
  asyncHandler(async (req, res) => {
    const input = revertTemplateSchema.parse(req.body);
    const template = await templateService.revertTemplate(req.user!, req.params.id!, input, requestMeta(req));
    sendSuccess(res, { template });
  })
);

router.delete(
  "/:id",
  requirePermission("templates.delete"),
  asyncHandler(async (req, res) => {
    await templateService.deleteTemplate(req.user!, req.params.id!, requestMeta(req));
    sendSuccess(res, { message: "Template deleted." });
  })
);

export default router;
