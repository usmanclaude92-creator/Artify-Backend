/** AI approval-request routes (Phase 12 — docs/AI_GOVERNANCE.md §17). */
import { Router } from "express";
import { aiApprovalService } from "../../services/aiApprovalService";
import { authenticateToken, requirePermission } from "../../middleware/auth";
import { asyncHandler } from "../../utils/asyncHandler";
import { sendSuccess } from "../../core/apiResponse";
import { decideAiApprovalSchema, listAiApprovalsQuerySchema } from "../../schemas/aiSchemas";

const router = Router();

router.use(authenticateToken);

function requestMeta(req: { ip?: string; headers: Record<string, unknown>; requestId?: string }) {
  return { ip: req.ip, userAgent: req.headers["user-agent"] as string | undefined, requestId: req.requestId };
}

router.get(
  "/",
  requirePermission("ai.approvals.read"),
  asyncHandler(async (req, res) => {
    const query = listAiApprovalsQuerySchema.parse(req.query);
    const { rows, total } = await aiApprovalService.listApprovals(
      req.user!.organizationId,
      { status: query.status },
      query.page,
      query.limit,
      query.sort,
      query.order
    );
    sendSuccess(res, { approvals: rows }, 200, { page: query.page, limit: query.limit, total });
  })
);

router.get(
  "/:id",
  requirePermission("ai.approvals.read"),
  asyncHandler(async (req, res) => {
    const approval = await aiApprovalService.getApproval(req.user!.organizationId, req.params.id!);
    sendSuccess(res, { approval });
  })
);

router.post(
  "/:id/decide",
  requirePermission("ai.approvals.decide"),
  asyncHandler(async (req, res) => {
    const input = decideAiApprovalSchema.parse(req.body);
    const approval = await aiApprovalService.decide(req.user!, req.params.id!, input, requestMeta(req));
    sendSuccess(res, { approval });
  })
);

export default router;
