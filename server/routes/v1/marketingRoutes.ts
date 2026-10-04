/** Marketing dashboard summary (Phase 14 — docs/MARKETING_ARCHITECTURE.md §1). */
import { Router } from "express";
import { marketingService } from "../../services/marketingService";
import { authenticateToken } from "../../middleware/auth";
import { asyncHandler } from "../../utils/asyncHandler";
import { sendSuccess } from "../../core/apiResponse";

const router = Router();

router.use(authenticateToken);

router.get(
  "/summary",
  asyncHandler(async (req, res) => {
    const summary = await marketingService.getSummary(req.user!.organizationId, req.user!.role.permissions);
    sendSuccess(res, summary);
  })
);

export default router;
