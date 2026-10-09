/** Data privacy: person lookup, export, erasure preview/request (Step 13). Mounted at /api/v1/privacy. Emails travel in POST bodies, never in URLs. */
import { Router } from "express";
import { z } from "zod";
import { authenticateToken, requirePermission } from "../../middleware/auth";
import { sensitiveActionLimiter } from "../../middleware/rateLimiter";
import { asyncHandler } from "../../utils/asyncHandler";
import { sendSuccess } from "../../core/apiResponse";
import { privacyService } from "../../services/ops/privacyService";

const router = Router();
router.use(authenticateToken);
const meta = (req: { ip?: string; headers: Record<string, unknown> }) => ({ ip: req.ip, userAgent: req.headers["user-agent"] as string | undefined });
const emailBody = z.object({ email: z.string().trim().min(3).max(254) });

router.post("/lookup", requirePermission("privacy.read"), sensitiveActionLimiter, asyncHandler(async (req, res) => {
  sendSuccess(res, await privacyService.lookup(req.user!, emailBody.parse(req.body).email, meta(req)));
}));

router.post("/export", requirePermission("privacy.export"), sensitiveActionLimiter, asyncHandler(async (req, res) => {
  const b = emailBody.extend({ format: z.enum(["json", "csv"]).default("json") }).parse(req.body);
  const f = await privacyService.exportBundle(req.user!, b.email, b.format, meta(req));
  res.setHeader("Content-Type", f.contentType);
  res.setHeader("Content-Disposition", `attachment; filename="${f.filename}"`);
  res.setHeader("Cache-Control", "no-store");
  res.send(f.body);
}));

router.post("/erasure/preview", requirePermission("privacy.read"), sensitiveActionLimiter, asyncHandler(async (req, res) => {
  sendSuccess(res, await privacyService.preview(req.user!, emailBody.parse(req.body).email));
}));

router.post("/erasure-requests", requirePermission("privacy.erase"), sensitiveActionLimiter, asyncHandler(async (req, res) => {
  const b = emailBody.extend({ reason: z.string().trim().min(10).max(500) }).parse(req.body);
  sendSuccess(res, await privacyService.requestErasure(req.user!, b.email, b.reason, meta(req)), 201);
}));

router.get("/requests", requirePermission("privacy.read"), asyncHandler(async (req, res) => {
  sendSuccess(res, { requests: await privacyService.listRequests(req.user!.organizationId) });
}));

router.get("/requests/:id", requirePermission("privacy.read"), asyncHandler(async (req, res) => {
  sendSuccess(res, { request: await privacyService.describeRequest(req.user!.organizationId, req.params.id!) });
}));

export default router;
