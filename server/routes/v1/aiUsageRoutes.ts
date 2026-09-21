/** AI usage/cost routes (Phase 12 — docs/AI_USAGE_AND_COSTS.md). Read-only. */
import { Router } from "express";
import { aiUsageService } from "../../services/aiUsageService";
import { authenticateToken, requirePermission } from "../../middleware/auth";
import { asyncHandler } from "../../utils/asyncHandler";
import { sendSuccess } from "../../core/apiResponse";
import { usageSummaryQuerySchema } from "../../schemas/aiSchemas";

const router = Router();

router.use(authenticateToken);
router.use(requirePermission("ai.usage.read"));

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const query = usageSummaryQuerySchema.parse(req.query);
    const records = await aiUsageService.listUsage(req.user!.organizationId, query.dateFrom, query.dateTo);
    sendSuccess(res, { usageRecords: records });
  })
);

router.get(
  "/summary",
  asyncHandler(async (req, res) => {
    const query = usageSummaryQuerySchema.parse(req.query);
    const summary = await aiUsageService.summary(req.user!.organizationId, query.dateFrom, query.dateTo);
    sendSuccess(res, { summary });
  })
);

export default router;
