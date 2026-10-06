/** Sidebar helpers. Session-only (like /auth/me): counts are filtered to what the caller's permissions allow inside the service. */
import { Router } from "express";
import { authenticateToken } from "../../middleware/auth";
import { asyncHandler } from "../../utils/asyncHandler";
import { sendSuccess } from "../../core/apiResponse";
import { navBadgeService } from "../../services/navBadgeService";

const router = Router();
router.use(authenticateToken);

router.get(
  "/badges",
  asyncHandler(async (req, res) => {
    sendSuccess(res, { badges: await navBadgeService.get(req.user!) });
  })
);

export default router;
