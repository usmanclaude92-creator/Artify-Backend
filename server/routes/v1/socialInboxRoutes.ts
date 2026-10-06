/**
 * Social inbox. read = social.read · work the inbox (reply, assign, notes, status, lead, canned) = social.reply ·
 * rules + settings = social.accounts.manage (settings also need ADMIN). The public webhook receiver is separate and signature-checked.
 */
import { Router, type Request } from "express";
import { authenticateToken, requirePermission } from "../../middleware/auth";
import { aiExecutionLimiter, sensitiveActionLimiter, webhookLimiter } from "../../middleware/rateLimiter";
import { asyncHandler } from "../../utils/asyncHandler";
import { sendSuccess } from "../../core/apiResponse";
import { NotFoundError } from "../../core/errors";
import { connectorRegistry } from "../../services/social/connectors/registry";
import { config } from "../../config/env";
import { inboxService } from "../../services/social/inbox/inboxService";
import { ingestWebhook } from "../../services/social/inbox/inboxPipeline";
import {
  assignSchema, bulkSchema, cannedSchema, editDraftSchema, hideSchema, inboxSettingsSchema, injectSchema, leadSchema, listConversationsSchema, noteSchema, prioritySchema,
  readSchema, ruleSchema, sendReplySchema, statusSchema,
} from "../../schemas/socialInboxSchemas";

const meta = (req: Request) => ({ ip: req.ip, userAgent: req.headers["user-agent"], requestId: req.requestId });
const id = (req: Request) => String(req.params.id);

/** Mounted BEFORE the authenticated social routers: providers call this without a session; the connector verifies the signature (fails closed). */
export const socialWebhookRouter = Router();
socialWebhookRouter.post(
  "/:provider",
  webhookLimiter,
  asyncHandler(async (req, res) => {
    const result = await ingestWebhook(String(req.params.provider), req.rawBody, req.headers);
    sendSuccess(res, { ...result });
  })
);

/** GET verification handshake (e.g. Meta hub.challenge). Echoes the challenge only when the connector accepts the verify token; fails closed with 403. */
socialWebhookRouter.get(
  "/:provider",
  webhookLimiter,
  asyncHandler(async (req, res) => {
    const connector = connectorRegistry.get(String(req.params.provider));
    if (!connector || !connector.isConfigured() || !connector.handleWebhookChallenge) throw new NotFoundError("Not found.");
    const query: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(req.query)) query[k] = typeof v === "string" ? v : undefined;
    const challenge = connector.handleWebhookChallenge({ query });
    if (challenge === null) {
      res.status(403).type("text/plain").send("Forbidden");
      return;
    }
    res.status(200).type("text/plain").send(challenge);
  })
);

export const socialInboxRouter = Router();
socialInboxRouter.use(authenticateToken);
const read = requirePermission("social.read");
const reply = requirePermission("social.reply");
const manage = requirePermission("social.accounts.manage");

socialInboxRouter.get("/conversations", read, asyncHandler(async (req, res) => sendSuccess(res, await inboxService.list(req.user!, listConversationsSchema.parse(req.query)))));
socialInboxRouter.get("/conversations/:id", read, asyncHandler(async (req, res) => sendSuccess(res, await inboxService.get(req.user!, id(req)))));
socialInboxRouter.get("/assignees", read, asyncHandler(async (req, res) => sendSuccess(res, { assignees: await inboxService.assignees(req.user!.organizationId) })));
socialInboxRouter.get("/metrics", read, asyncHandler(async (req, res) => sendSuccess(res, { metrics: await inboxService.metrics(req.user!) })));

socialInboxRouter.post("/conversations/:id/draft", reply, aiExecutionLimiter, asyncHandler(async (req, res) => sendSuccess(res, { draft: await inboxService.draft(req.user!, id(req), meta(req)) })));
socialInboxRouter.post("/conversations/:id/reply", reply, asyncHandler(async (req, res) => sendSuccess(res, await inboxService.send(req.user!, id(req), sendReplySchema.parse(req.body), meta(req)))));
socialInboxRouter.patch("/messages/:id", reply, asyncHandler(async (req, res) => sendSuccess(res, { draft: await inboxService.editDraft(req.user!, id(req), editDraftSchema.parse(req.body).body) })));
socialInboxRouter.post("/messages/:id/hide", reply, asyncHandler(async (req, res) => sendSuccess(res, await inboxService.hideComment(req.user!, id(req), hideSchema.parse(req.body).hidden, meta(req)))));
socialInboxRouter.post("/conversations/:id/notes", reply, asyncHandler(async (req, res) => sendSuccess(res, await inboxService.addNote(req.user!, id(req), noteSchema.parse(req.body).body, meta(req)), 201)));
socialInboxRouter.post("/conversations/:id/status", reply, asyncHandler(async (req, res) => sendSuccess(res, { conversation: await inboxService.setStatus(req.user!, id(req), statusSchema.parse(req.body).status, meta(req)) })));
socialInboxRouter.post("/conversations/:id/priority", reply, asyncHandler(async (req, res) => sendSuccess(res, { conversation: await inboxService.setPriority(req.user!, id(req), prioritySchema.parse(req.body).priority, meta(req)) })));
socialInboxRouter.post("/conversations/:id/assign", reply, asyncHandler(async (req, res) => sendSuccess(res, { conversation: await inboxService.assign(req.user!, id(req), assignSchema.parse(req.body).assigneeId, meta(req)) })));
socialInboxRouter.post("/conversations/:id/read", reply, asyncHandler(async (req, res) => sendSuccess(res, await inboxService.markRead(req.user!, id(req), readSchema.parse(req.body).read))));
socialInboxRouter.post("/conversations/:id/lead", reply, asyncHandler(async (req, res) => sendSuccess(res, { handoff: await inboxService.createLead(req.user!, id(req), leadSchema.parse(req.body ?? {}), meta(req)) })));
socialInboxRouter.post("/bulk", reply, sensitiveActionLimiter, asyncHandler(async (req, res) => {
  const b = bulkSchema.parse(req.body);
  sendSuccess(res, await inboxService.bulk(req.user!, b.ids, b.patch, meta(req)));
}));

socialInboxRouter.get("/settings", read, asyncHandler(async (req, res) => sendSuccess(res, { settings: await inboxService.getSettings(req.user!.organizationId) })));
socialInboxRouter.put("/settings", manage, sensitiveActionLimiter, asyncHandler(async (req, res) => sendSuccess(res, { settings: await inboxService.updateSettings(req.user!, inboxSettingsSchema.parse(req.body), meta(req)) })));

socialInboxRouter.get("/rules", read, asyncHandler(async (req, res) => sendSuccess(res, { rules: await inboxService.listRules(req.user!.organizationId) })));
socialInboxRouter.post("/rules", manage, sensitiveActionLimiter, asyncHandler(async (req, res) => sendSuccess(res, { rule: await inboxService.saveRule(req.user!, null, ruleSchema.parse(req.body), meta(req)) }, 201)));
socialInboxRouter.put("/rules/:id", manage, sensitiveActionLimiter, asyncHandler(async (req, res) => sendSuccess(res, { rule: await inboxService.saveRule(req.user!, id(req), ruleSchema.parse(req.body), meta(req)) })));
socialInboxRouter.delete("/rules/:id", manage, sensitiveActionLimiter, asyncHandler(async (req, res) => { await inboxService.deleteRule(req.user!, id(req), meta(req)); sendSuccess(res, { deleted: true }); }));

socialInboxRouter.get("/canned", read, asyncHandler(async (req, res) => sendSuccess(res, { replies: await inboxService.listCanned(req.user!.organizationId) })));
socialInboxRouter.post("/canned", reply, asyncHandler(async (req, res) => sendSuccess(res, { reply: await inboxService.saveCanned(req.user!, null, cannedSchema.parse(req.body), meta(req)) }, 201)));
socialInboxRouter.put("/canned/:id", reply, asyncHandler(async (req, res) => sendSuccess(res, { reply: await inboxService.saveCanned(req.user!, id(req), cannedSchema.parse(req.body), meta(req)) })));
socialInboxRouter.delete("/canned/:id", reply, asyncHandler(async (req, res) => { await inboxService.deleteCanned(req.user!, id(req), meta(req)); sendSuccess(res, { deleted: true }); }));

// Dev/demo only: absent in production (404), mock accounts only.
socialInboxRouter.post("/dev/inject", manage, asyncHandler(async (req, res) => {
  if (config.nodeEnv === "production") throw new NotFoundError("Not found.");
  sendSuccess(res, { result: await inboxService.injectMock(req.user!, injectSchema.parse(req.body)) }, 201);
}));
