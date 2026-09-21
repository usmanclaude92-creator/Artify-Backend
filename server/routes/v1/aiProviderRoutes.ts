/** AI provider/model catalog routes (Phase 12 — docs/AI_ARCHITECTURE.md). Platform-level, admin-only. */
import { Router } from "express";
import { aiProviderService } from "../../services/aiProviderService";
import { authenticateToken, requirePermission } from "../../middleware/auth";
import { asyncHandler } from "../../utils/asyncHandler";
import { sendSuccess } from "../../core/apiResponse";
import { createAiModelSchema, createAiProviderSchema, updateAiModelSchema, updateAiProviderSchema } from "../../schemas/aiSchemas";

const router = Router();

router.use(authenticateToken);

function requestMeta(req: { ip?: string; headers: Record<string, unknown>; requestId?: string }) {
  return { ip: req.ip, userAgent: req.headers["user-agent"] as string | undefined, requestId: req.requestId };
}

router.get(
  "/",
  requirePermission("ai.providers.read"),
  asyncHandler(async (_req, res) => {
    const providers = await aiProviderService.listProviders();
    sendSuccess(res, { providers });
  })
);

router.post(
  "/",
  requirePermission("ai.providers.manage"),
  asyncHandler(async (req, res) => {
    const input = createAiProviderSchema.parse(req.body);
    const provider = await aiProviderService.createProvider(req.user!, input, requestMeta(req));
    sendSuccess(res, { provider }, 201);
  })
);

router.patch(
  "/:id",
  requirePermission("ai.providers.manage"),
  asyncHandler(async (req, res) => {
    const input = updateAiProviderSchema.parse(req.body);
    const provider = await aiProviderService.updateProvider(req.user!, req.params.id!, input, requestMeta(req));
    sendSuccess(res, { provider });
  })
);

router.get(
  "/models",
  requirePermission("ai.models.read"),
  asyncHandler(async (req, res) => {
    const providerId = typeof req.query.providerId === "string" ? req.query.providerId : undefined;
    const models = await aiProviderService.listModels(providerId);
    sendSuccess(res, { models });
  })
);

router.post(
  "/models",
  requirePermission("ai.models.manage"),
  asyncHandler(async (req, res) => {
    const input = createAiModelSchema.parse(req.body);
    const model = await aiProviderService.createModel(req.user!, input, requestMeta(req));
    sendSuccess(res, { model }, 201);
  })
);

router.patch(
  "/models/:id",
  requirePermission("ai.models.manage"),
  asyncHandler(async (req, res) => {
    const input = updateAiModelSchema.parse(req.body);
    const model = await aiProviderService.updateModel(req.user!, req.params.id!, input, requestMeta(req));
    sendSuccess(res, { model });
  })
);

export default router;
