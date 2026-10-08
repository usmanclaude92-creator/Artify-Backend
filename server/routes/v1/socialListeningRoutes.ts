/**
 * Social Listening & Reviews. Reading both streams = social.listening.read (same roles as the inbox read permission).
 * Replying to a REVIEW = social.reviews.respond (same roles as the inbox reply permission). Working an item (assign, status, lead, mention replies)
 * uses the inbox endpoints and social.reply: one workflow, one audit trail. Everything is read-only against the networks except an approved reply.
 */
import { Router, type Request } from "express";
import { authenticateToken, requirePermission } from "../../middleware/auth";
import { aiExecutionLimiter } from "../../middleware/rateLimiter";
import { asyncHandler } from "../../utils/asyncHandler";
import { sendSuccess } from "../../core/apiResponse";
import { inboxService } from "../../services/social/inbox/inboxService";
import { listeningQueries } from "../../services/social/listening/listeningQueries";
import { listeningQuerySchema, reviewOverviewSchema } from "../../schemas/socialListeningSchemas";
import { sendReplySchema } from "../../schemas/socialInboxSchemas";

const meta = (req: Request) => ({ ip: req.ip, userAgent: req.headers["user-agent"], requestId: req.requestId });
const id = (req: Request) => String(req.params.id);
const read = requirePermission("social.listening.read");
const respond = requirePermission("social.reviews.respond");

export const socialListeningRouter = Router();
socialListeningRouter.use(authenticateToken);
socialListeningRouter.get("/", read, asyncHandler(async (req, res) => sendSuccess(res, await listeningQueries.list(req.user!, listeningQuerySchema.parse(req.query)))));
socialListeningRouter.get("/topics", read, asyncHandler(async (req, res) => sendSuccess(res, { topics: await listeningQueries.topics(req.user!) })));
socialListeningRouter.get("/summary", read, asyncHandler(async (req, res) => sendSuccess(res, { summary: await listeningQueries.summary(req.user!) })));

export const socialReviewsRouter = Router();
socialReviewsRouter.use(authenticateToken);
socialReviewsRouter.get("/", read, asyncHandler(async (req, res) => sendSuccess(res, await listeningQueries.reviews(req.user!, listeningQuerySchema.parse(req.query)))));
socialReviewsRouter.get("/overview", read, asyncHandler(async (req, res) => sendSuccess(res, await listeningQueries.reviewOverview(req.user!, reviewOverviewSchema.parse(req.query).days))));
socialReviewsRouter.post("/:id/draft", respond, aiExecutionLimiter, asyncHandler(async (req, res) => {
  await listeningQueries.assertReview(req.user!, id(req));
  sendSuccess(res, { draft: await inboxService.draft(req.user!, id(req), meta(req)) });
}));
socialReviewsRouter.post("/:id/reply", respond, asyncHandler(async (req, res) => {
  await listeningQueries.assertReview(req.user!, id(req));
  sendSuccess(res, await inboxService.send(req.user!, id(req), sendReplySchema.parse(req.body), meta(req)));
}));
