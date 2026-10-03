/**
 * Phase 3 (Site Identity + Global Styles) — typed convenience endpoints on
 * top of the generic `/settings` KV API (server/routes/v1/settingsRoutes.ts),
 * reusing its exact `settings.read`/`settings.manage` permissions (no new
 * permission keys — see siteSettingsService.ts's header comment for the
 * draft/publish/revert shape).
 */
import { Router } from "express";
import { siteSettingsService } from "../../services/siteSettingsService";
import { authenticateToken, requirePermission } from "../../middleware/auth";
import { asyncHandler } from "../../utils/asyncHandler";
import { sendSuccess } from "../../core/apiResponse";
import { siteIdentitySchema, globalStylesSchema } from "../../schemas/siteSettingsSchemas";

const router = Router();

router.use(authenticateToken);

function requestMeta(req: { ip?: string; headers: Record<string, unknown> }) {
  return { ip: req.ip, userAgent: req.headers["user-agent"] as string | undefined };
}

router.get(
  "/identity",
  requirePermission("settings.read"),
  asyncHandler(async (req, res) => {
    const identity = await siteSettingsService.getSiteIdentity(req.user!.organizationId);
    sendSuccess(res, identity);
  })
);

router.put(
  "/identity/draft",
  requirePermission("settings.manage"),
  asyncHandler(async (req, res) => {
    const input = siteIdentitySchema.parse(req.body);
    const draft = await siteSettingsService.saveSiteIdentityDraft(req.user!, input, requestMeta(req));
    sendSuccess(res, { draft });
  })
);

router.post(
  "/identity/publish",
  requirePermission("settings.manage"),
  asyncHandler(async (req, res) => {
    const published = await siteSettingsService.publishSiteIdentity(req.user!, requestMeta(req));
    sendSuccess(res, { published });
  })
);

router.post(
  "/identity/revert",
  requirePermission("settings.manage"),
  asyncHandler(async (req, res) => {
    const draft = await siteSettingsService.revertSiteIdentityDraft(req.user!, requestMeta(req));
    sendSuccess(res, { draft });
  })
);

router.get(
  "/global-styles",
  requirePermission("settings.read"),
  asyncHandler(async (req, res) => {
    const globalStyles = await siteSettingsService.getGlobalStyles(req.user!.organizationId);
    sendSuccess(res, globalStyles);
  })
);

router.put(
  "/global-styles/draft",
  requirePermission("settings.manage"),
  asyncHandler(async (req, res) => {
    const input = globalStylesSchema.parse(req.body);
    const draft = await siteSettingsService.saveGlobalStylesDraft(req.user!, input, requestMeta(req));
    sendSuccess(res, { draft });
  })
);

router.post(
  "/global-styles/publish",
  requirePermission("settings.manage"),
  asyncHandler(async (req, res) => {
    const published = await siteSettingsService.publishGlobalStyles(req.user!, requestMeta(req));
    sendSuccess(res, { published });
  })
);

router.post(
  "/global-styles/revert",
  requirePermission("settings.manage"),
  asyncHandler(async (req, res) => {
    const draft = await siteSettingsService.revertGlobalStylesDraft(req.user!, requestMeta(req));
    sendSuccess(res, { draft });
  })
);

export default router;
