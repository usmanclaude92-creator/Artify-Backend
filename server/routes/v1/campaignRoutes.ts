/** Campaign CRUD + lifecycle (Phase 14 — docs/MARKETING_ARCHITECTURE.md). */
import { Router } from "express";
import { campaignService } from "../../services/campaignService";
import { authenticateToken, requirePermission } from "../../middleware/auth";
import { asyncHandler } from "../../utils/asyncHandler";
import { sendSuccess } from "../../core/apiResponse";
import { createCampaignSchema, updateCampaignSchema, listCampaignsQuerySchema, duplicateCampaignSchema } from "../../schemas/campaignSchemas";

const router = Router();

router.use(authenticateToken);

function requestMeta(req: { ip?: string; headers: Record<string, unknown> }) {
  return { ip: req.ip, userAgent: req.headers["user-agent"] as string | undefined };
}

router.get(
  "/",
  requirePermission("campaigns.read"),
  asyncHandler(async (req, res) => {
    const query = listCampaignsQuerySchema.parse(req.query);
    const { rows, total } = await campaignService.listCampaigns(
      req.user!.organizationId,
      { search: query.search, status: query.status, channel: query.channel, ownerId: query.ownerId },
      query.page,
      query.limit,
      query.sort,
      query.order
    );
    sendSuccess(res, { campaigns: rows }, 200, { page: query.page, limit: query.limit, total });
  })
);

router.get(
  "/:id",
  requirePermission("campaigns.read"),
  asyncHandler(async (req, res) => {
    const campaign = await campaignService.getCampaign(req.user!.organizationId, req.params.id!);
    sendSuccess(res, { campaign });
  })
);

router.get(
  "/:id/activity",
  requirePermission("campaigns.read"),
  asyncHandler(async (req, res) => {
    const activity = await campaignService.getActivity(req.user!.organizationId, req.params.id!);
    sendSuccess(res, { activity });
  })
);

router.get(
  "/:id/preview",
  requirePermission("campaigns.read"),
  asyncHandler(async (req, res) => {
    const preview = await campaignService.previewCampaign(req.user!.organizationId, req.params.id!);
    sendSuccess(res, { preview });
  })
);

router.post(
  "/",
  requirePermission("campaigns.create"),
  asyncHandler(async (req, res) => {
    const input = createCampaignSchema.parse(req.body);
    const campaign = await campaignService.createCampaign(req.user!, input, requestMeta(req));
    sendSuccess(res, { campaign }, 201);
  })
);

router.patch(
  "/:id",
  requirePermission("campaigns.update"),
  asyncHandler(async (req, res) => {
    const input = updateCampaignSchema.parse(req.body);
    const campaign = await campaignService.updateCampaign(req.user!, req.params.id!, input, requestMeta(req));
    sendSuccess(res, { campaign });
  })
);

router.post(
  "/:id/duplicate",
  requirePermission("campaigns.create"),
  asyncHandler(async (req, res) => {
    const input = duplicateCampaignSchema.parse(req.body || {});
    const campaign = await campaignService.duplicateCampaign(req.user!, req.params.id!, input, requestMeta(req));
    sendSuccess(res, { campaign }, 201);
  })
);

router.post(
  "/:id/activate",
  requirePermission("campaigns.update"),
  asyncHandler(async (req, res) => {
    const campaign = await campaignService.activateCampaign(req.user!, req.params.id!, requestMeta(req));
    sendSuccess(res, { campaign });
  })
);

router.post(
  "/:id/pause",
  requirePermission("campaigns.update"),
  asyncHandler(async (req, res) => {
    const campaign = await campaignService.pauseCampaign(req.user!, req.params.id!, requestMeta(req));
    sendSuccess(res, { campaign });
  })
);

router.post(
  "/:id/publish",
  requirePermission("campaigns.publish"),
  asyncHandler(async (req, res) => {
    const campaign = await campaignService.publishCampaign(req.user!, req.params.id!, requestMeta(req));
    sendSuccess(res, { campaign });
  })
);

router.post(
  "/:id/archive",
  requirePermission("campaigns.archive"),
  asyncHandler(async (req, res) => {
    const campaign = await campaignService.archiveCampaign(req.user!, req.params.id!, requestMeta(req));
    sendSuccess(res, { campaign });
  })
);

export default router;
