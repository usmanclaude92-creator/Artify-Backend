/**
 * Social content: posts, calendar, brand voice, workspace settings, content plans, AI drafting.
 * read = social.read · create/edit/submit/schedule = social.publish · approve/reject = social.approve ·
 * brand voice / settings = social.accounts.manage. Nothing here publishes to a network (Step 6).
 */
import { Router, type Request } from "express";
import { authenticateToken, requirePermission } from "../../middleware/auth";
import { aiExecutionLimiter, sensitiveActionLimiter } from "../../middleware/rateLimiter";
import { asyncHandler } from "../../utils/asyncHandler";
import { sendSuccess } from "../../core/apiResponse";
import { prisma } from "../../db/prisma";
import { socialPostService } from "../../services/social/socialPostService";
import { socialAiService } from "../../services/social/socialAiService";
import { connectorRegistry } from "../../services/social/connectors/registry";
import {
  aiDraftSchema, aiPlanSchema, aiRewriteSchema, brandVoiceSchema, calendarQuerySchema, commentSchema, contentSourcesQuerySchema, createSocialPostSchema, listSocialPostsQuerySchema,
  rejectSchema, rescheduleSchema, scheduleSchema, updateSocialPostSchema, workspaceSettingsSchema,
} from "../../schemas/socialPostSchemas";

const meta = (req: Request) => ({ ip: req.ip, userAgent: req.headers["user-agent"], requestId: req.requestId });

export const socialContentRouter = Router();
socialContentRouter.use(authenticateToken);

const read = requirePermission("social.read");
const publish = requirePermission("social.publish");
const approve = requirePermission("social.approve");
const manage = requirePermission("social.accounts.manage");

// ---- reference data for the Composer ----
socialContentRouter.get(
  "/constraints",
  read,
  asyncHandler(async (req, res) => {
    const accounts = await prisma.socialAccount.findMany({ where: { organizationId: req.user!.organizationId }, select: { id: true, provider: true, accountType: true } });
    sendSuccess(res, { constraints: Object.fromEntries(accounts.map((a) => [a.id, connectorRegistry.constraintsFor(a.provider, a.accountType)])) });
  })
);
socialContentRouter.get("/content-sources", read, asyncHandler(async (req, res) => {
  const q = contentSourcesQuerySchema.parse(req.query);
  sendSuccess(res, { items: await socialPostService.listSourceContent(req.user!.organizationId, q.type, q.search) });
}));

// ---- brand voice & workspace settings ----
socialContentRouter.get("/brand-voice", read, asyncHandler(async (req, res) => sendSuccess(res, { brandVoice: await socialPostService.getBrandVoice(req.user!.organizationId) })));
socialContentRouter.put("/brand-voice", manage, sensitiveActionLimiter, asyncHandler(async (req, res) => {
  sendSuccess(res, { brandVoice: await socialPostService.updateBrandVoice(req.user!, brandVoiceSchema.parse(req.body), meta(req)) });
}));
socialContentRouter.get("/settings", read, asyncHandler(async (req, res) => sendSuccess(res, { settings: await socialPostService.getSettings(req.user!.organizationId) })));
socialContentRouter.put("/settings", manage, sensitiveActionLimiter, asyncHandler(async (req, res) => {
  sendSuccess(res, { settings: await socialPostService.updateSettings(req.user!, workspaceSettingsSchema.parse(req.body).approvalMode, meta(req)) });
}));

// ---- calendar & plans ----
socialContentRouter.get("/calendar", read, asyncHandler(async (req, res) => {
  const q = calendarQuerySchema.parse(req.query);
  sendSuccess(res, await socialPostService.calendar(req.user!.organizationId, q));
}));
socialContentRouter.get("/plans", read, asyncHandler(async (req, res) => sendSuccess(res, { plans: await socialAiService.listPlans(req.user!.organizationId) })));

// ---- posts ----
socialContentRouter.get("/posts", read, asyncHandler(async (req, res) => {
  const { posts, total, page, limit } = await socialPostService.list(req.user!.organizationId, listSocialPostsQuerySchema.parse(req.query));
  sendSuccess(res, { posts }, 200, { page, limit, total });
}));
socialContentRouter.post("/posts", publish, asyncHandler(async (req, res) => {
  sendSuccess(res, { post: await socialPostService.create(req.user!, createSocialPostSchema.parse(req.body), meta(req)) }, 201);
}));
socialContentRouter.get("/posts/:id", read, asyncHandler(async (req, res) => sendSuccess(res, { post: await socialPostService.get(req.user!.organizationId, req.params.id!) })));
socialContentRouter.patch("/posts/:id", publish, asyncHandler(async (req, res) => {
  sendSuccess(res, { post: await socialPostService.update(req.user!, req.params.id!, updateSocialPostSchema.parse(req.body), meta(req)) });
}));
socialContentRouter.patch("/posts/:id/schedule", publish, asyncHandler(async (req, res) => {
  const input = rescheduleSchema.parse(req.body);
  sendSuccess(res, { post: await socialPostService.update(req.user!, req.params.id!, { scheduledAt: input.scheduledAt, ...(input.timezone ? { timezone: input.timezone } : {}) }, meta(req)) });
}));
socialContentRouter.delete("/posts/:id", publish, asyncHandler(async (req, res) => {
  await socialPostService.remove(req.user!, req.params.id!, meta(req));
  sendSuccess(res, { message: "Post deleted." });
}));

const transitions: Array<[string, "PENDING_APPROVAL" | "DRAFT" | "CANCELLED" | "APPROVED", ReturnType<typeof requirePermission>]> = [
  ["submit", "PENDING_APPROVAL", publish],
  ["withdraw", "DRAFT", publish],
  ["reopen", "DRAFT", publish],
  ["cancel", "CANCELLED", publish],
  ["unschedule", "APPROVED", publish],
];
for (const [path, to, guard] of transitions) {
  socialContentRouter.post(`/posts/:id/${path}`, guard, asyncHandler(async (req, res) => {
    const { comment } = commentSchema.parse(req.body ?? {});
    sendSuccess(res, { post: await socialPostService.transition(req.user!, req.params.id!, to, { comment }, meta(req)) });
  }));
}
socialContentRouter.post("/posts/:id/approve", approve, asyncHandler(async (req, res) => {
  const { comment } = commentSchema.parse(req.body ?? {});
  sendSuccess(res, { post: await socialPostService.transition(req.user!, req.params.id!, "APPROVED", { comment }, meta(req)) });
}));
socialContentRouter.post("/posts/:id/reject", approve, asyncHandler(async (req, res) => {
  const { comment } = rejectSchema.parse(req.body ?? {});
  sendSuccess(res, { post: await socialPostService.transition(req.user!, req.params.id!, "REJECTED", { comment }, meta(req)) });
}));
socialContentRouter.post("/posts/:id/schedule", publish, asyncHandler(async (req, res) => {
  const input = scheduleSchema.parse(req.body);
  sendSuccess(res, { post: await socialPostService.transition(req.user!, req.params.id!, "SCHEDULED", { scheduledAt: input.scheduledAt, timezone: input.timezone }, meta(req)) });
}));

// ---- AI (through the AI module; output is always a DRAFT) ----
socialContentRouter.post("/ai/draft", publish, aiExecutionLimiter, asyncHandler(async (req, res) => {
  sendSuccess(res, await socialAiService.draftFromBrief(req.user!, aiDraftSchema.parse(req.body), meta(req)), 201);
}));
socialContentRouter.post("/ai/plan", publish, aiExecutionLimiter, asyncHandler(async (req, res) => {
  sendSuccess(res, await socialAiService.generatePlan(req.user!, aiPlanSchema.parse(req.body), meta(req)), 201);
}));
socialContentRouter.post("/posts/:id/ai/rewrite", publish, aiExecutionLimiter, asyncHandler(async (req, res) => {
  sendSuccess(res, await socialAiService.rewrite(req.user!, req.params.id!, aiRewriteSchema.parse(req.body), meta(req)));
}));
