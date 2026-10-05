/**
 * Content Approval (Phase 16 — docs/AUTOMATION_ARCHITECTURE.md §2). Mounted
 * at /api/v1/automation/content-approvals, alongside the rest of the
 * automation surface it's built on. "Submit" reuses `content.update` (same
 * permission as content.submit-review, since submitting an already
 * IN_REVIEW page/post into the approval queue isn't itself a publish
 * action); "decide" reuses `content.publish` (approving a request directly
 * publishes the content via the same `content.publish`-gated code path the
 * generic publish route already uses, so the decider must hold the same
 * permission that action itself would require).
 */
import { Router } from "express";
import { z } from "zod";
import { authenticateToken, requirePermission } from "../../middleware/auth";
import { asyncHandler } from "../../utils/asyncHandler";
import { sendSuccess } from "../../core/apiResponse";
import { contentApprovalService } from "../../services/automation/ContentApprovalService";

const router = Router();

router.use(authenticateToken);

const SubmitSchema = z.object({
  contentType: z.enum(["page", "post"]),
  contentId: z.string().min(1),
});

const DecideSchema = z.object({
  decision: z.enum(["APPROVED", "REJECTED", "CHANGES_REQUESTED"]),
  reason: z.string().max(2000).optional(),
});

router.get(
  "/",
  requirePermission("content.update"),
  asyncHandler(async (req, res) => {
    const result = await contentApprovalService.listForOrg(
      req.user!.organizationId,
      req.query.status as string | undefined,
      req.query.page ? Number(req.query.page) : 1,
      req.query.limit ? Number(req.query.limit) : 20
    );
    sendSuccess(res, result);
  })
);

router.post(
  "/",
  requirePermission("content.update"),
  asyncHandler(async (req, res) => {
    const body = SubmitSchema.parse(req.body);
    const result = await contentApprovalService.submitForApproval(req.user!, body.contentType, body.contentId);
    sendSuccess(res, result, 201);
  })
);

router.post(
  "/:id/decide",
  requirePermission("content.publish"),
  asyncHandler(async (req, res) => {
    const body = DecideSchema.parse(req.body);
    const result = await contentApprovalService.decide(req.user!, req.params.id!, body.decision, body.reason);
    sendSuccess(res, result);
  })
);

export default router;
