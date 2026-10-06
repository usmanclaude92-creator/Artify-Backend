/**
 * Global Approvals center (read-only aggregation + decision dispatch to the existing per-source services).
 * `approvals.read` is the front door; each source additionally requires its own existing permission
 * (checked in approvalCenterService), so nobody sees or decides a source they couldn't before.
 */
import { Router, type Request } from "express";
import { authenticateToken, requirePermission } from "../../middleware/auth";
import { asyncHandler } from "../../utils/asyncHandler";
import { sendSuccess } from "../../core/apiResponse";
import { approvalCenterService } from "../../services/approvalCenterService";
import { approvalDecisionSchema, approvalSourceParamSchema, listApprovalsQuerySchema } from "../../schemas/approvalCenterSchemas";
import { clearNavBadgeCache } from "../../services/navBadgeService";

const router = Router();
router.use(authenticateToken);

const requestMeta = (req: Request) => ({ ip: req.ip, userAgent: req.headers["user-agent"] });

router.get(
  "/",
  requirePermission("approvals.read"),
  asyncHandler(async (req, res) => {
    const query = listApprovalsQuerySchema.parse(req.query);
    const { approvals, total, page, limit, sources } = await approvalCenterService.list(req.user!, query);
    sendSuccess(res, { approvals, sources }, 200, { page, limit, total });
  })
);

router.get(
  "/summary",
  requirePermission("approvals.read"),
  asyncHandler(async (req, res) => {
    sendSuccess(res, await approvalCenterService.summary(req.user!));
  })
);

router.post(
  "/:source/:id/decision",
  requirePermission("approvals.read"),
  asyncHandler(async (req, res) => {
    const source = approvalSourceParamSchema.parse(req.params.source);
    const input = approvalDecisionSchema.parse(req.body);
    const result = await approvalCenterService.decide(req.user!, source, req.params.id!, input, requestMeta(req));
    clearNavBadgeCache();
    sendSuccess(res, result);
  })
);

export default router;
