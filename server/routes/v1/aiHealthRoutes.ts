/** AI Control Center health + limits (Phase 18). Org-scoped, secrets never returned. */
import { Router } from "express";
import { authenticateToken, requirePermission } from "../../middleware/auth";
import { asyncHandler } from "../../utils/asyncHandler";
import { sendSuccess } from "../../core/apiResponse";
import { aiHealthService } from "../../services/aiHealthService";
import { aiLimitsSchema, aiQuotaService } from "../../services/aiQuotaService";

const router = Router();
router.use(authenticateToken);

router.get(
  "/health",
  requirePermission("ai.usage.read"),
  asyncHandler(async (req, res) => {
    sendSuccess(res, { health: await aiHealthService.snapshot(req.user!.organizationId) });
  })
);

router.put(
  "/limits",
  requirePermission("ai.providers.manage"),
  asyncHandler(async (req, res) => {
    const input = aiLimitsSchema.parse(req.body);
    const limits = await aiQuotaService.setLimits(req.user!.organizationId, req.user!.id, input, {
      ip: req.ip,
      userAgent: req.headers["user-agent"] as string | undefined,
    });
    sendSuccess(res, { limits });
  })
);

export default router;
