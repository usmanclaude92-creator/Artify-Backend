/** Control Center moderation queue for reader comments on blog posts. Comments stay private until approved here. */
import { Router } from "express";
import { postEngagementService } from "../../services/postEngagementService";
import { authenticateToken, requirePermission } from "../../middleware/auth";
import { asyncHandler } from "../../utils/asyncHandler";
import { sendSuccess } from "../../core/apiResponse";
import { listPostCommentsQuerySchema, moderatePostCommentSchema } from "../../schemas/postEngagementSchemas";

const router = Router();
router.use(authenticateToken);

router.get(
  "/",
  requirePermission("content.read"),
  asyncHandler(async (req, res) => {
    const q = listPostCommentsQuerySchema.parse(req.query);
    const { rows, total } = await postEngagementService.listForModeration(req.user!, q.status, q.page, q.limit);
    sendSuccess(res, { comments: rows }, 200, { page: q.page, limit: q.limit, total });
  })
);

router.get(
  "/pending-count",
  requirePermission("content.read"),
  asyncHandler(async (req, res) => {
    sendSuccess(res, { count: await postEngagementService.pendingCount(req.user!) });
  })
);

router.patch(
  "/:id",
  requirePermission("content.update"),
  asyncHandler(async (req, res) => {
    const input = moderatePostCommentSchema.parse(req.body);
    sendSuccess(res, { comment: await postEngagementService.moderate(req.user!, req.params.id!, input.status) });
  })
);

export default router;
