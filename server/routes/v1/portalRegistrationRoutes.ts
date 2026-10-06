/** Operator review of self-registered client-portal accounts (see portalRegistrationService). */
import { Router } from "express";
import { z } from "zod";
import { authenticateToken, requirePermission } from "../../middleware/auth";
import { sensitiveActionLimiter } from "../../middleware/rateLimiter";
import { asyncHandler } from "../../utils/asyncHandler";
import { sendSuccess } from "../../core/apiResponse";
import { portalRegistrationService } from "../../services/portalRegistrationService";

const router = Router();
router.use(authenticateToken);

const meta = (req: { ip?: string; headers: Record<string, unknown> }) => ({ ip: req.ip, userAgent: req.headers["user-agent"] as string | undefined });

router.get(
  "/",
  requirePermission("workspaces.read"),
  asyncHandler(async (req, res) => sendSuccess(res, { registrations: await portalRegistrationService.list(req.user!) }))
);

router.post(
  "/:organizationId/link",
  requirePermission("workspaces.update"),
  sensitiveActionLimiter,
  asyncHandler(async (req, res) => {
    const { clientId } = z.object({ clientId: z.string().uuid() }).parse(req.body);
    await portalRegistrationService.link(req.user!, req.params.organizationId!, clientId, meta(req));
    sendSuccess(res, { linked: true });
  })
);

router.post(
  "/:organizationId/reject",
  requirePermission("workspaces.suspend"),
  sensitiveActionLimiter,
  asyncHandler(async (req, res) => {
    await portalRegistrationService.reject(req.user!, req.params.organizationId!, meta(req));
    sendSuccess(res, { rejected: true });
  })
);

export default router;
