/** Marketing → Landing Pages (Step 12, docs/MARKETING_LANDING_PAGES.md). Mounted at /api/v1/marketing/landing-pages. */
import { Router } from "express";
import { landingPageService } from "../../services/landing/landingPageService";
import { landingApprovalService } from "../../services/landing/landingApprovalService";
import { landingStatsService } from "../../services/landing/landingStatsService";
import { authenticateToken, requirePermission } from "../../middleware/auth";
import { asyncHandler } from "../../utils/asyncHandler";
import { sendSuccess } from "../../core/apiResponse";
import {
  createLandingSchema, updateLandingSchema, restoreLandingSchema, previewTokenSchema, listLandingQuerySchema, landingStatsQuerySchema, utmLinkQuerySchema,
} from "../../schemas/landingSchemas";

const router = Router();
router.use(authenticateToken);

const meta = (req: { ip?: string; headers: Record<string, unknown> }) => ({ ip: req.ip, userAgent: req.headers["user-agent"] as string | undefined });
const id = (req: { params: Record<string, string | undefined> }) => req.params.id!;

router.get("/templates", requirePermission("marketing.landing.read"), asyncHandler(async (_req, res) => sendSuccess(res, { templates: landingPageService.templates() })));
router.get("/live", requirePermission("marketing.landing.read"), asyncHandler(async (req, res) => sendSuccess(res, { pages: await landingPageService.listLive(req.user!) })));

router.get("/", requirePermission("marketing.landing.read"), asyncHandler(async (req, res) => {
  const q = listLandingQuerySchema.parse(req.query);
  const { rows, total } = await landingPageService.list(req.user!, q);
  sendSuccess(res, { pages: rows }, 200, { page: q.page, limit: q.limit, total });
}));
router.post("/", requirePermission("marketing.landing.edit"), asyncHandler(async (req, res) => {
  sendSuccess(res, { page: await landingPageService.create(req.user!, createLandingSchema.parse(req.body), meta(req)) }, 201);
}));
router.get("/:id", requirePermission("marketing.landing.read"), asyncHandler(async (req, res) => sendSuccess(res, { page: await landingPageService.get(req.user!, id(req)) })));
router.patch("/:id", requirePermission("marketing.landing.edit"), asyncHandler(async (req, res) => {
  sendSuccess(res, { page: await landingPageService.update(req.user!, id(req), updateLandingSchema.parse(req.body), meta(req)) });
}));

router.get("/:id/revisions", requirePermission("marketing.landing.read"), asyncHandler(async (req, res) => sendSuccess(res, { revisions: await landingPageService.listRevisions(req.user!, id(req)) })));
router.post("/:id/restore", requirePermission("marketing.landing.edit"), asyncHandler(async (req, res) => {
  sendSuccess(res, { page: await landingPageService.restoreRevision(req.user!, id(req), restoreLandingSchema.parse(req.body).revisionId, meta(req)) });
}));

router.post("/:id/submit-for-approval", requirePermission("marketing.landing.edit"), asyncHandler(async (req, res) => {
  const out = await landingApprovalService.submit(req.user!, id(req), meta(req));
  sendSuccess(res, { ...out, page: await landingPageService.get(req.user!, id(req)) }, 201);
}));
router.post("/:id/withdraw", requirePermission("marketing.landing.edit"), asyncHandler(async (req, res) => {
  await landingApprovalService.withdraw(req.user!, id(req), meta(req));
  sendSuccess(res, { page: await landingPageService.get(req.user!, id(req)) });
}));
router.post("/:id/unpublish", requirePermission("marketing.landing.publish"), asyncHandler(async (req, res) => sendSuccess(res, { page: await landingPageService.unpublish(req.user!, id(req), meta(req)) })));
router.post("/:id/archive", requirePermission("marketing.landing.edit"), asyncHandler(async (req, res) => sendSuccess(res, { page: await landingPageService.archive(req.user!, id(req), meta(req)) })));
router.post("/:id/unarchive", requirePermission("marketing.landing.edit"), asyncHandler(async (req, res) => sendSuccess(res, { page: await landingPageService.unarchive(req.user!, id(req), meta(req)) })));

router.post("/:id/preview", requirePermission("marketing.landing.edit"), asyncHandler(async (req, res) => {
  const { ttlHours } = previewTokenSchema.parse(req.body ?? {});
  sendSuccess(res, { preview: await landingPageService.createPreview(req.user!, id(req), ttlHours, meta(req)) }, 201);
}));
router.post("/:id/preview/revoke", requirePermission("marketing.landing.edit"), asyncHandler(async (req, res) => sendSuccess(res, await landingPageService.revokePreviews(req.user!, id(req), meta(req)))));
router.get("/:id/utm-link", requirePermission("marketing.landing.read"), asyncHandler(async (req, res) => sendSuccess(res, await landingPageService.utmLink(req.user!, id(req), utmLinkQuerySchema.parse(req.query)))));
router.get("/:id/stats", requirePermission("marketing.landing.read"), asyncHandler(async (req, res) => sendSuccess(res, { stats: await landingStatsService.forPage(req.user!, id(req), landingStatsQuerySchema.parse(req.query).days) })));

export default router;
