/** Opportunity (sales pipeline) CRUD + win/lose (Phase 7 — docs/CRM_ARCHITECTURE.md). */
import { Router } from "express";
import { opportunityService } from "../../services/opportunityService";
import { authenticateToken, requirePermission } from "../../middleware/auth";
import { asyncHandler } from "../../utils/asyncHandler";
import { sendSuccess } from "../../core/apiResponse";
import { createOpportunitySchema, updateOpportunitySchema, listOpportunitiesQuerySchema, loseOpportunitySchema, linkClientSchema } from "../../schemas/opportunitySchemas";

const router = Router();

router.use(authenticateToken);

function requestMeta(req: { ip?: string; headers: Record<string, unknown> }) {
  return { ip: req.ip, userAgent: req.headers["user-agent"] as string | undefined };
}

router.get(
  "/",
  requirePermission("opportunities.read"),
  asyncHandler(async (req, res) => {
    const query = listOpportunitiesQuerySchema.parse(req.query);
    const { rows, total } = await opportunityService.listOpportunities(
      req.user!.organizationId,
      { search: query.search, stage: query.stage, clientId: query.clientId, leadId: query.leadId, productId: query.productId, assignedTo: query.assignedTo },
      query.page,
      query.limit,
      query.sort,
      query.order
    );
    sendSuccess(res, { opportunities: rows }, 200, { page: query.page, limit: query.limit, total });
  })
);

router.get(
  "/:id",
  requirePermission("opportunities.read"),
  asyncHandler(async (req, res) => {
    const opportunity = await opportunityService.getOpportunity(req.user!.organizationId, req.params.id!);
    sendSuccess(res, { opportunity });
  })
);

router.get(
  "/:id/activity",
  requirePermission("opportunities.read"),
  asyncHandler(async (req, res) => {
    const activity = await opportunityService.getActivity(req.user!.organizationId, req.params.id!);
    sendSuccess(res, { activity });
  })
);

router.post(
  "/",
  requirePermission("opportunities.create"),
  asyncHandler(async (req, res) => {
    const input = createOpportunitySchema.parse(req.body);
    const opportunity = await opportunityService.createOpportunity(req.user!, input, requestMeta(req));
    sendSuccess(res, { opportunity }, 201);
  })
);

router.patch(
  "/:id",
  requirePermission("opportunities.update"),
  asyncHandler(async (req, res) => {
    const input = updateOpportunitySchema.parse(req.body);
    const opportunity = await opportunityService.updateOpportunity(req.user!, req.params.id!, input, requestMeta(req));
    sendSuccess(res, { opportunity });
  })
);

router.delete(
  "/:id",
  requirePermission("opportunities.delete"),
  asyncHandler(async (req, res) => {
    await opportunityService.deleteOpportunity(req.user!, req.params.id!, requestMeta(req));
    sendSuccess(res, { message: "Opportunity deleted." });
  })
);

router.post(
  "/:id/link-client",
  requirePermission("opportunities.update"),
  asyncHandler(async (req, res) => {
    const input = linkClientSchema.parse(req.body);
    const opportunity = await opportunityService.linkClient(req.user!, req.params.id!, input, requestMeta(req));
    sendSuccess(res, { opportunity });
  })
);

router.post(
  "/:id/win",
  requirePermission("opportunities.close"),
  asyncHandler(async (req, res) => {
    const opportunity = await opportunityService.winOpportunity(req.user!, req.params.id!, requestMeta(req));
    sendSuccess(res, { opportunity });
  })
);

router.post(
  "/:id/lose",
  requirePermission("opportunities.close"),
  asyncHandler(async (req, res) => {
    const input = loseOpportunitySchema.parse(req.body);
    const opportunity = await opportunityService.loseOpportunity(req.user!, req.params.id!, input, requestMeta(req));
    sendSuccess(res, { opportunity });
  })
);

export default router;
