/**
 * Social publishing: queue, failures, per-target actions, controls, metrics (+ the CRON_SECRET-protected scheduler tick).
 * read = social.read · retry/reschedule/mark-published/cancel = social.publish · workspace controls = social.accounts.manage (+ ADMIN) ·
 * global controls = SUPER_ADMIN only. Tokens never appear in any response.
 */
import { timingSafeEqual } from "node:crypto";
import { Router, type Request } from "express";
import { authenticateToken, requirePermission } from "../../middleware/auth";
import { sensitiveActionLimiter } from "../../middleware/rateLimiter";
import { asyncHandler } from "../../utils/asyncHandler";
import { sendSuccess } from "../../core/apiResponse";
import { heartbeat } from "../../services/ops/heartbeat";
import { config } from "../../config/env";
import { AuthenticationError, NotFoundError } from "../../core/errors";
import { publisher, publishingActions, publishingQueries } from "../../services/social/publishing/publisher";
import { publishingSettingsService } from "../../services/social/publishing/publishingSettingsService";
import { failuresQuerySchema, markPublishedSchema, publishingGlobalSchema, publishingSettingsSchema, rescheduleTargetSchema, retryTargetSchema } from "../../schemas/socialPostSchemas";

const meta = (req: Request) => ({ ip: req.ip, userAgent: req.headers["user-agent"], requestId: req.requestId });
const constantTimeEquals = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** Mounted BEFORE the authenticated social routers. GET and POST both work (Vercel Cron uses GET, GitHub Actions/cron-job.org can use either). */
export const socialInternalRouter = Router();
socialInternalRouter.all(
  "/publish-tick",
  asyncHandler(async (req, res) => {
    if (req.method !== "GET" && req.method !== "POST") throw new NotFoundError("Not found.");
    if (!config.cronSecret) throw new NotFoundError("Not found.");
    if (!constantTimeEquals(req.headers.authorization ?? "", `Bearer ${config.cronSecret}`)) throw new AuthenticationError("Invalid cron credentials.");
    sendSuccess(res, { publish: await heartbeat.around("publish_tick", () => publisher.tick()) });
  })
);

export const socialPublishingRouter = Router();
socialPublishingRouter.use(authenticateToken);
const read = requirePermission("social.read");
const publish = requirePermission("social.publish");
const manage = requirePermission("social.accounts.manage");

socialPublishingRouter.get("/queue", read, asyncHandler(async (req, res) => sendSuccess(res, await publishingQueries.queue(req.user!.organizationId))));
socialPublishingRouter.get("/failures", read, asyncHandler(async (req, res) => {
  const q = failuresQuerySchema.parse(req.query);
  sendSuccess(res, await publishingQueries.failures(req.user!.organizationId, q));
}));
socialPublishingRouter.get("/metrics", read, asyncHandler(async (req, res) => sendSuccess(res, { metrics: await publishingQueries.metrics(req.user!.organizationId) })));
socialPublishingRouter.get("/settings", read, asyncHandler(async (req, res) => sendSuccess(res, await publishingSettingsService.view(req.user!.organizationId))));
socialPublishingRouter.put("/settings", manage, sensitiveActionLimiter, asyncHandler(async (req, res) => {
  sendSuccess(res, await publishingSettingsService.updateWorkspace(req.user!, publishingSettingsSchema.parse(req.body), meta(req)));
}));
socialPublishingRouter.put("/global", manage, sensitiveActionLimiter, asyncHandler(async (req, res) => {
  sendSuccess(res, await publishingSettingsService.updateGlobal(req.user!, publishingGlobalSchema.parse(req.body), meta(req)));
}));

socialPublishingRouter.get("/targets/:id", read, asyncHandler(async (req, res) => sendSuccess(res, { target: await publishingQueries.getTarget(req.user!.organizationId, String(req.params.id)) })));
socialPublishingRouter.post("/targets/:id/retry", publish, sensitiveActionLimiter, asyncHandler(async (req, res) => {
  sendSuccess(res, await publishingActions.retryNow(req.user!, String(req.params.id), retryTargetSchema.parse(req.body ?? {}), meta(req)));
}));
socialPublishingRouter.post("/targets/:id/reschedule", publish, sensitiveActionLimiter, asyncHandler(async (req, res) => {
  const body = rescheduleTargetSchema.parse(req.body);
  sendSuccess(res, { target: await publishingActions.reschedule(req.user!, String(req.params.id), body, meta(req)) });
}));
socialPublishingRouter.post("/targets/:id/mark-published", publish, sensitiveActionLimiter, asyncHandler(async (req, res) => {
  sendSuccess(res, { target: await publishingActions.markPublished(req.user!, String(req.params.id), markPublishedSchema.parse(req.body), meta(req)) });
}));
socialPublishingRouter.post("/targets/:id/cancel", publish, sensitiveActionLimiter, asyncHandler(async (req, res) => {
  sendSuccess(res, { target: await publishingActions.cancel(req.user!, String(req.params.id), meta(req)) });
}));
