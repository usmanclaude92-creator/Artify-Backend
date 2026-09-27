/** SEO audit (Phase 5 — docs/SEO_ARCHITECTURE.md). */
import { Router } from "express";
import { seoAuditService } from "../../services/seoAuditService";
import { authenticateToken, requirePermission } from "../../middleware/auth";
import { asyncHandler } from "../../utils/asyncHandler";
import { sendSuccess } from "../../core/apiResponse";

const router = Router();

router.use(authenticateToken);

router.get(
  "/issues",
  requirePermission("seo.audit.read"),
  asyncHandler(async (req, res) => {
    const issues = await seoAuditService.runAudit(req.user!.organizationId);
    sendSuccess(res, { issues });
  })
);

export default router;
