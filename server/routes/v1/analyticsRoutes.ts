/** Analytics Dashboard (Phase 15 — docs/ANALYTICS_ARCHITECTURE.md). */
import { Router } from "express";
import { analyticsReportingService } from "../../services/analyticsReportingService";
import { authenticateToken, requirePermission } from "../../middleware/auth";
import { asyncHandler } from "../../utils/asyncHandler";
import { sendSuccess } from "../../core/apiResponse";
import { analyticsOverviewQuerySchema, analyticsTopPagesQuerySchema } from "../../schemas/analyticsSchemas";

const router = Router();

router.use(authenticateToken);

router.get(
  "/overview",
  requirePermission("analytics.read"),
  asyncHandler(async (req, res) => {
    const query = analyticsOverviewQuerySchema.parse(req.query);
    const overview = await analyticsReportingService.getOverview(req.user!.organizationId, req.user!.role.permissions, query);
    sendSuccess(res, overview);
  })
);

router.get(
  "/content/top-pages",
  requirePermission("analytics.read"),
  asyncHandler(async (req, res) => {
    const query = analyticsTopPagesQuerySchema.parse(req.query);
    const topPages = await analyticsReportingService.getTopPages(req.user!.organizationId, query, query.limit);
    sendSuccess(res, { topPages });
  })
);

export default router;
