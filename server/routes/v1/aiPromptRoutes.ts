/** AI prompt template/version routes (Phase 12 — docs/AI_ARCHITECTURE.md §14/§15). */
import { Router } from "express";
import { aiPromptService } from "../../services/aiPromptService";
import { authenticateToken, requirePermission } from "../../middleware/auth";
import { asyncHandler } from "../../utils/asyncHandler";
import { sendSuccess } from "../../core/apiResponse";
import {
  createAiPromptTemplateSchema,
  createAiPromptVersionSchema,
  listAiPromptsQuerySchema,
  publishAiPromptVersionSchema,
  updateAiPromptTemplateSchema,
} from "../../schemas/aiSchemas";

const router = Router();

router.use(authenticateToken);

function requestMeta(req: { ip?: string; headers: Record<string, unknown>; requestId?: string }) {
  return { ip: req.ip, userAgent: req.headers["user-agent"] as string | undefined, requestId: req.requestId };
}

router.get(
  "/",
  requirePermission("ai.prompts.read"),
  asyncHandler(async (req, res) => {
    const query = listAiPromptsQuerySchema.parse(req.query);
    const { rows, total } = await aiPromptService.listTemplates(
      req.user!.organizationId,
      { search: query.search },
      query.page,
      query.limit,
      query.sort,
      query.order
    );
    sendSuccess(res, { promptTemplates: rows }, 200, { page: query.page, limit: query.limit, total });
  })
);

router.get(
  "/:id",
  requirePermission("ai.prompts.read"),
  asyncHandler(async (req, res) => {
    const promptTemplate = await aiPromptService.getTemplate(req.user!.organizationId, req.params.id!);
    sendSuccess(res, { promptTemplate });
  })
);

router.post(
  "/",
  requirePermission("ai.prompts.create"),
  asyncHandler(async (req, res) => {
    const input = createAiPromptTemplateSchema.parse(req.body);
    const promptTemplate = await aiPromptService.createTemplate(req.user!, input, requestMeta(req));
    sendSuccess(res, { promptTemplate }, 201);
  })
);

router.patch(
  "/:id",
  requirePermission("ai.prompts.update"),
  asyncHandler(async (req, res) => {
    const input = updateAiPromptTemplateSchema.parse(req.body);
    const promptTemplate = await aiPromptService.updateTemplate(req.user!, req.params.id!, input, requestMeta(req));
    sendSuccess(res, { promptTemplate });
  })
);

router.post(
  "/:id/versions",
  requirePermission("ai.prompts.update"),
  asyncHandler(async (req, res) => {
    const input = createAiPromptVersionSchema.parse(req.body);
    const version = await aiPromptService.createVersion(req.user!, req.params.id!, input, requestMeta(req));
    sendSuccess(res, { version }, 201);
  })
);

router.post(
  "/:id/publish",
  requirePermission("ai.prompts.publish"),
  asyncHandler(async (req, res) => {
    const input = publishAiPromptVersionSchema.parse(req.body);
    const promptTemplate = await aiPromptService.publishVersion(req.user!, req.params.id!, input.versionId, requestMeta(req));
    sendSuccess(res, { promptTemplate });
  })
);

router.delete(
  "/:id",
  requirePermission("ai.prompts.delete"),
  asyncHandler(async (req, res) => {
    await aiPromptService.deleteTemplate(req.user!, req.params.id!, requestMeta(req));
    sendSuccess(res, { archived: true });
  })
);

export default router;
