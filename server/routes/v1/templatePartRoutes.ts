/** Template Part CRUD + publish/revisions/duplicate/revert (Phase 1 — docs/control-center-replacement-roadmap.md). Mirrors templateRoutes.ts exactly. */
import { Router } from "express";
import { templatePartService } from "../../services/templatePartService";
import { authenticateToken, requirePermission } from "../../middleware/auth";
import { asyncHandler } from "../../utils/asyncHandler";
import { sendSuccess } from "../../core/apiResponse";
import {
  createTemplatePartSchema,
  updateTemplatePartSchema,
  duplicateTemplatePartSchema,
  revertTemplatePartSchema,
  listTemplatePartsQuerySchema,
} from "../../schemas/templateSchemas";

const router = Router();

router.use(authenticateToken);

function requestMeta(req: { ip?: string; headers: Record<string, unknown> }) {
  return { ip: req.ip, userAgent: req.headers["user-agent"] as string | undefined };
}

router.get(
  "/",
  requirePermission("template_parts.read"),
  asyncHandler(async (req, res) => {
    const query = listTemplatePartsQuerySchema.parse(req.query);
    const { rows, total } = await templatePartService.listParts(
      req.user!.organizationId,
      { search: query.search, status: query.status, type: query.type },
      query.page,
      query.limit,
      query.sort,
      query.order
    );
    sendSuccess(res, { templateParts: rows }, 200, { page: query.page, limit: query.limit, total });
  })
);

router.get(
  "/:id",
  requirePermission("template_parts.read"),
  asyncHandler(async (req, res) => {
    const templatePart = await templatePartService.getPart(req.user!.organizationId, req.params.id!);
    sendSuccess(res, { templatePart });
  })
);

router.get(
  "/:id/revisions",
  requirePermission("template_parts.read"),
  asyncHandler(async (req, res) => {
    const revisions = await templatePartService.listRevisions(req.user!.organizationId, req.params.id!);
    sendSuccess(res, { revisions });
  })
);

router.get(
  "/:id/usage",
  requirePermission("template_parts.read"),
  asyncHandler(async (req, res) => {
    const usage = await templatePartService.getUsage(req.user!.organizationId, req.params.id!);
    sendSuccess(res, usage);
  })
);

router.post(
  "/",
  requirePermission("template_parts.create"),
  asyncHandler(async (req, res) => {
    const input = createTemplatePartSchema.parse(req.body);
    const templatePart = await templatePartService.createPart(req.user!, input, requestMeta(req));
    sendSuccess(res, { templatePart }, 201);
  })
);

router.post(
  "/:id/duplicate",
  requirePermission("template_parts.create"),
  asyncHandler(async (req, res) => {
    const input = duplicateTemplatePartSchema.parse(req.body ?? {});
    const templatePart = await templatePartService.duplicatePart(req.user!, req.params.id!, input, requestMeta(req));
    sendSuccess(res, { templatePart }, 201);
  })
);

router.patch(
  "/:id",
  requirePermission("template_parts.update"),
  asyncHandler(async (req, res) => {
    const input = updateTemplatePartSchema.parse(req.body);
    const templatePart = await templatePartService.updatePart(req.user!, req.params.id!, input, requestMeta(req));
    sendSuccess(res, { templatePart });
  })
);

router.post(
  "/:id/publish",
  requirePermission("template_parts.publish"),
  asyncHandler(async (req, res) => {
    const templatePart = await templatePartService.publishPart(req.user!, req.params.id!, requestMeta(req));
    sendSuccess(res, { templatePart });
  })
);

router.post(
  "/:id/archive",
  requirePermission("template_parts.delete"),
  asyncHandler(async (req, res) => {
    const templatePart = await templatePartService.archivePart(req.user!, req.params.id!, requestMeta(req));
    sendSuccess(res, { templatePart });
  })
);

router.post(
  "/:id/revert",
  requirePermission("template_parts.update"),
  asyncHandler(async (req, res) => {
    const input = revertTemplatePartSchema.parse(req.body);
    const templatePart = await templatePartService.revertPart(req.user!, req.params.id!, input, requestMeta(req));
    sendSuccess(res, { templatePart });
  })
);

router.delete(
  "/:id",
  requirePermission("template_parts.delete"),
  asyncHandler(async (req, res) => {
    await templatePartService.deletePart(req.user!, req.params.id!, requestMeta(req));
    sendSuccess(res, { message: "Template part deleted." });
  })
);

export default router;
