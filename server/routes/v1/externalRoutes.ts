/**
 * Phase 17 — the machine-facing surface. API keys (artify_ak_…) authenticate
 * ONLY here; every other route keeps requiring a user session. Intentionally
 * minimal: it lets an integration verify its key and see what it may do.
 */
import { Router } from "express";
import { authenticateApiKey } from "../../middleware/apiKeyAuth";
import { generalApiLimiter } from "../../middleware/rateLimiter";
import { asyncHandler } from "../../utils/asyncHandler";
import { sendSuccess } from "../../core/apiResponse";
import { prisma } from "../../db/prisma";

const router = Router();
router.use(generalApiLimiter, authenticateApiKey);

router.get(
  "/whoami",
  asyncHandler(async (req, res) => {
    const org = await prisma.organization.findUnique({ where: { id: req.apiKey!.organizationId }, select: { id: true, name: true, slug: true } });
    sendSuccess(res, { organization: org, apiKey: { id: req.apiKey!.id, scopes: req.apiKey!.scopes } });
  })
);

export default router;
