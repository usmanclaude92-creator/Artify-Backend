/**
 * Social analytics (Step 9b). READ-ONLY views of stored snapshots: social.analytics.read. Everything is scoped to the caller's workspace.
 * The only mutation is "Refresh now" (social.accounts.manage), which makes read-only calls to the network and writes snapshots.
 */
import { Router, type Request } from "express";
import { z } from "zod";
import { authenticateToken, requirePermission } from "../../middleware/auth";
import { sensitiveActionLimiter } from "../../middleware/rateLimiter";
import { asyncHandler } from "../../utils/asyncHandler";
import { sendSuccess } from "../../core/apiResponse";
import { analyticsExport, analyticsQueries } from "../../services/social/analytics/analyticsQueries";
import { analyticsIngest } from "../../services/social/analytics/analyticsIngest";
import { aiConfigured, socialAiService } from "../../services/social/socialAiService";

const meta = (req: Request) => ({ ip: req.ip, userAgent: req.headers["user-agent"] });
const range = z.object({ from: z.string().optional(), to: z.string().optional() });
const read = requirePermission("social.analytics.read");

export const socialAnalyticsRouter = Router();
socialAnalyticsRouter.use(authenticateToken);

socialAnalyticsRouter.get("/summary", read, asyncHandler(async (req, res) => {
  const q = range.parse(req.query);
  sendSuccess(res, { ...(await analyticsQueries.summary(req.user!.organizationId, q)), aiAvailable: aiConfigured() });
}));

socialAnalyticsRouter.get("/accounts/:id", read, asyncHandler(async (req, res) => {
  sendSuccess(res, { ...(await analyticsQueries.accountDetail(req.user!.organizationId, req.params.id!, range.parse(req.query))), aiAvailable: aiConfigured() });
}));

socialAnalyticsRouter.get("/accounts/:id/posts", read, asyncHandler(async (req, res) => {
  const q = range.extend({ sort: z.string().optional(), limit: z.coerce.number().int().min(1).max(100).optional() }).parse(req.query);
  sendSuccess(res, await analyticsQueries.topPosts(req.user!.organizationId, req.params.id!, q));
}));

socialAnalyticsRouter.get("/accounts/:id/audience", read, asyncHandler(async (req, res) => {
  sendSuccess(res, await analyticsQueries.audience(req.user!.organizationId, req.params.id!, range.parse(req.query)));
}));

socialAnalyticsRouter.get("/accounts/:id/best-times", read, asyncHandler(async (req, res) => {
  const q = z.object({ metric: z.string().optional(), tz: z.string().max(60).optional() }).parse(req.query);
  sendSuccess(res, await analyticsQueries.bestTimes(req.user!.organizationId, req.params.id!, q));
}));

socialAnalyticsRouter.get("/posts/:targetId", read, asyncHandler(async (req, res) => {
  sendSuccess(res, await analyticsQueries.postDetail(req.user!.organizationId, req.params.targetId!));
}));

socialAnalyticsRouter.get("/accounts/:id/export", read, asyncHandler(async (req, res) => {
  const q = range.extend({ kind: z.enum(["account", "posts"]).default("account") }).parse(req.query);
  const { filename, body } = await analyticsExport.csv(req.user!.organizationId, req.params.id!, q.kind, q);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Cache-Control", "no-store");
  res.send(body);
}));

socialAnalyticsRouter.post("/accounts/:id/summary", read, sensitiveActionLimiter, asyncHandler(async (req, res) => {
  sendSuccess(res, await socialAiService.analyticsSummary(req.user!, req.params.id!, range.parse(req.body ?? {}), meta(req)));
}));

socialAnalyticsRouter.post("/accounts/:id/refresh", requirePermission("social.accounts.manage"), sensitiveActionLimiter, asyncHandler(async (req, res) => {
  sendSuccess(res, await analyticsIngest.refreshNow(req.user!, req.params.id!, meta(req)));
}));
