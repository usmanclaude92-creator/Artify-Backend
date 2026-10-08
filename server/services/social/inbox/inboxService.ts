/** User-facing inbox operations. Every query is scoped to the caller's ACTIVE workspace; mutations are audited without message text. */
import type { Prisma, SocialConversationPriority, SocialConversationStatus, SocialConversationType } from "@prisma/client";
import { prisma } from "../../../db/prisma";
import { config } from "../../../config/env";
import { AuthorizationError, ConflictError, NotFoundError, ValidationError } from "../../../core/errors";
import { connectorRegistry } from "../connectors/registry";
import { ConnectorNotImplementedError, type InboundEvent } from "../connectors/types";
import { socialAccountService } from "../socialAccountService";
import { generateDraft, ingestEvent, inboxTick } from "./inboxPipeline";
import { assertAssignable, auditInbox, getInboxSettings, handoffToCrm, notifyInbox, replyGuardrails, safeText, sendReply, DEFAULT_INBOX_SETTINGS, type InboxSettings } from "./inboxCore";
import { isOverdue, median } from "./inboxPolicy";
import type { SanitizedUser } from "../../../types/domain";
import type { RequestMeta } from "../../authService";

const isAdmin = (u: SanitizedUser) => u.role.key === "ADMIN" || u.role.key === "SUPER_ADMIN";
const canRespondToReviews = (u: SanitizedUser) => u.role.key === "SUPER_ADMIN" || u.role.permissions.includes("social.reviews.respond");
/** Reviews have their own permission on top of social.reply: drafting/sending/editing a review reply needs social.reviews.respond. */
async function assertReviewAccess(caller: SanitizedUser, conversationId: string) {
  const conv = await prisma.socialConversation.findFirst({ where: { id: conversationId, organizationId: caller.organizationId }, select: { type: true } });
  if (conv?.type === "REVIEW" && !canRespondToReviews(caller)) throw new AuthorizationError('Permission denied. Required privilege: "social.reviews.respond"');
}
const CONV_INCLUDE = { account: { select: { id: true, provider: true, displayName: true, handle: true, accountType: true, status: true, avatarUrl: true } } } satisfies Prisma.SocialConversationInclude;
type ConvRow = Prisma.SocialConversationGetPayload<{ include: typeof CONV_INCLUDE }>;

function project(c: ConvRow, now: Date, extra: { preview?: string | null; failedSend?: boolean } = {}) {
  return {
    id: c.id, type: c.type, status: c.status, priority: c.priority, intent: c.intent, sentiment: c.sentiment, needsHuman: c.needsHuman, tags: c.tags, isRead: c.isRead,
    participant: { externalId: c.participantExternalId, handle: c.participantHandle, name: c.participantName }, subjectRef: c.subjectRef,
    assigneeId: c.assigneeId, lastMessageAt: c.lastMessageAt, firstResponseAt: c.firstResponseAt, slaDueAt: c.slaDueAt, overdue: isOverdue(c, now),
    leadId: c.leadId, contactId: c.contactId, account: c.account, preview: extra.preview ?? null, failedSend: !!extra.failedSend,
  };
}

export interface ListQuery { status?: SocialConversationStatus; accountId?: string; type?: SocialConversationType; assignee?: string; priority?: SocialConversationPriority; sentiment?: string; overdue?: boolean; unread?: boolean; search?: string; page: number; limit: number }

export const inboxService = {
  async list(caller: SanitizedUser, q: ListQuery) {
    const now = new Date();
    const where: Prisma.SocialConversationWhereInput = {
      organizationId: caller.organizationId,
      ...(q.status ? { status: q.status } : {}), ...(q.accountId ? { socialAccountId: q.accountId } : {}), type: q.type ?? { in: ["COMMENT", "DM"] as SocialConversationType[] },
      ...(q.priority ? { priority: q.priority } : {}), ...(q.sentiment ? { sentiment: q.sentiment } : {}), ...(q.unread ? { isRead: false } : {}),
      ...(q.assignee === "me" ? { assigneeId: caller.id } : q.assignee === "unassigned" ? { assigneeId: null } : q.assignee ? { assigneeId: q.assignee } : {}),
      ...(q.overdue ? { status: { in: ["OPEN", "PENDING"] as SocialConversationStatus[] }, firstResponseAt: null, slaDueAt: { lt: now } } : {}),
      ...(q.search ? { OR: [{ participantName: { contains: q.search, mode: "insensitive" } }, { participantHandle: { contains: q.search, mode: "insensitive" } }, { messages: { some: { body: { contains: q.search, mode: "insensitive" } } } }] } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.socialConversation.findMany({ where, include: CONV_INCLUDE, orderBy: [{ isRead: "asc" }, { lastMessageAt: "desc" }], skip: (q.page - 1) * q.limit, take: q.limit }),
      prisma.socialConversation.count({ where }),
    ]);
    const ids = rows.map((r) => r.id);
    const [lasts, failed] = await Promise.all([
      Promise.all(ids.map((id) => prisma.socialMessage.findFirst({ where: { conversationId: id, authorKind: { in: ["CUSTOMER", "PAGE"] } }, orderBy: { createdAt: "desc" }, select: { body: true } }))),
      prisma.socialMessage.groupBy({ by: ["conversationId"], where: { conversationId: { in: ids }, sendStatus: { in: ["FAILED", "UNCERTAIN"] }, authorKind: { not: "NOTE" } }, _count: { _all: true } }),
    ]);
    const failedSet = new Set(failed.map((f) => f.conversationId));
    return { conversations: rows.map((r, i) => project(r, now, { preview: lasts[i]?.body.slice(0, 120) ?? null, failedSend: failedSet.has(r.id) })), total, page: q.page, limit: q.limit };
  },

  async get(caller: SanitizedUser, id: string) {
    const conv = await prisma.socialConversation.findFirst({ where: { id, organizationId: caller.organizationId }, include: CONV_INCLUDE });
    if (!conv) throw new NotFoundError("Conversation not found.");
    const [messages, triage] = await Promise.all([
      prisma.socialMessage.findMany({ where: { conversationId: id }, orderBy: { createdAt: "asc" }, take: 300 }),
      prisma.socialTriage.findFirst({ where: { conversationId: id }, orderBy: { createdAt: "desc" } }),
    ]);
    const connector = connectorRegistry.get(conv.account.provider);
    const win = connector?.replyWindow?.({ type: conv.type, lastInboundAt: conv.lastInboundAt, now: new Date() }) ?? { open: true, closesAt: null };
    const cap = conv.type === "MENTION" || conv.type === "REVIEW" ? (connector?.replyCapability?.({ type: conv.type, providerThreadId: conv.providerThreadId }) ?? { mode: "platform" as const, reason: "This network does not let apps reply here. Reply on the platform." }) : { mode: "api" as const };
    const ref = messages.map((m) => m.mediaRefs as { permalink?: string } | null).find((r) => r && typeof r.permalink === "string");
    return {
      permalink: ref?.permalink ?? null,
      reply: { mode: cap.mode, reason: "reason" in cap ? cap.reason ?? null : null },
      replyWindow: { open: win.open, closesAt: win.closesAt, reason: win.reason ?? null },
      conversation: project(conv, new Date(), { failedSend: messages.some((m) => (m.sendStatus === "FAILED" || m.sendStatus === "UNCERTAIN") && m.authorKind !== "NOTE") }),
      messages: messages.map((m) => ({
        id: m.id, direction: m.direction, authorKind: m.authorKind, body: m.body, sendStatus: m.sendStatus, sendError: m.sendError, sentById: m.sentById, sentAt: m.sentAt, hidden: m.hidden,
        aiConfidence: m.aiConfidence, guardrailResult: m.guardrailResult, autoSent: m.autoSent, createdAt: m.createdAt,
      })),
      triage: triage ? { intent: triage.intent, sentiment: triage.sentiment, priority: triage.priority, language: triage.language, spamScore: triage.spamScore, category: triage.suggestedCategory, confidence: triage.confidence, source: triage.source, flaggedForHuman: triage.flaggedForHuman } : null,
    };
  },

  async metrics(caller: SanitizedUser) {
    const now = new Date();
    const org = caller.organizationId;
    const since = new Date(now.getTime() - 30 * 86400_000);
    const [open, overdue, unassigned, answered] = await Promise.all([
      prisma.socialConversation.count({ where: { organizationId: org, status: { in: ["OPEN", "PENDING"] } } }),
      prisma.socialConversation.count({ where: { organizationId: org, status: { in: ["OPEN", "PENDING"] }, firstResponseAt: null, slaDueAt: { lt: now } } }),
      prisma.socialConversation.count({ where: { organizationId: org, status: "OPEN", assigneeId: null } }),
      prisma.socialConversation.findMany({ where: { organizationId: org, firstResponseAt: { gte: since }, awaitingSince: { not: null } }, select: { firstResponseAt: true, awaitingSince: true }, take: 1000 }),
    ]);
    const frt = median(answered.map((c) => c.firstResponseAt!.getTime() - c.awaitingSince!.getTime()).filter((n) => n >= 0));
    return { open, overdue, unassigned, medianFirstResponseMs: frt, answeredLast30d: answered.length };
  },

  /** Sidebar badge: unassigned open items plus overdue items (each counted once). */
  async badgeCount(organizationId: string): Promise<number> {
    return prisma.socialConversation.count({
      where: { organizationId, status: { in: ["OPEN", "PENDING"] }, OR: [{ status: "OPEN", assigneeId: null }, { firstResponseAt: null, slaDueAt: { lt: new Date() } }] },
    });
  },

  // ---- drafts & replies ----
  async draft(caller: SanitizedUser, id: string, meta: RequestMeta = {}) {
    void meta;
    await assertReviewAccess(caller, id);
    const r = await generateDraft({ id: caller.id, organizationId: caller.organizationId }, caller.organizationId, id);
    return r;
  },

  async editDraft(caller: SanitizedUser, messageId: string, body: string) {
    const msg = await prisma.socialMessage.findFirst({ where: { id: messageId, organizationId: caller.organizationId, direction: "OUTBOUND", authorKind: { in: ["AI_DRAFT", "PAGE"] }, sendStatus: { in: ["DRAFT", "FAILED"] } }, include: { conversation: { include: { account: true } } } });
    if (!msg) throw new NotFoundError("Draft not found.");
    if (msg.conversation.type === "REVIEW" && !canRespondToReviews(caller)) throw new AuthorizationError('Permission denied. Required privilege: "social.reviews.respond"');
    const guard = await replyGuardrails(caller.organizationId, msg.conversation.account, body);
    const updated = await prisma.socialMessage.update({ where: { id: messageId }, data: { body, guardrailResult: guard as unknown as Prisma.InputJsonValue, sentById: caller.id } });
    return { id: updated.id, body: updated.body, guardrailResult: guard };
  },

  async send(caller: SanitizedUser, conversationId: string, input: { messageId?: string; body?: string; resolve?: boolean; confirmNotSent?: boolean }, meta: RequestMeta = {}) {
    await assertReviewAccess(caller, conversationId);
    const m = await sendReply(caller.organizationId, conversationId, { actor: caller, ...input, meta });
    return { message: { id: m.id, sendStatus: m.sendStatus, sendError: m.sendError, sentAt: m.sentAt } };
  },

  async addNote(caller: SanitizedUser, conversationId: string, body: string, meta: RequestMeta = {}) {
    const conv = await prisma.socialConversation.findFirst({ where: { id: conversationId, organizationId: caller.organizationId } });
    if (!conv) throw new NotFoundError("Conversation not found.");
    const note = await prisma.socialMessage.create({ data: { conversationId, organizationId: caller.organizationId, socialAccountId: conv.socialAccountId, direction: "OUTBOUND", authorKind: "NOTE", body, sendStatus: "RECEIVED", sentById: caller.id } });
    await auditInbox(caller.organizationId, "SOCIAL_INBOX_NOTE_ADDED", conversationId, { messageId: note.id, chars: body.length }, caller, meta);
    return { id: note.id };
  },

  // ---- workflow ----
  async setStatus(caller: SanitizedUser, id: string, status: SocialConversationStatus, meta: RequestMeta = {}) {
    const conv = await prisma.socialConversation.findFirst({ where: { id, organizationId: caller.organizationId } });
    if (!conv) throw new NotFoundError("Conversation not found.");
    const settings = await getInboxSettings(caller.organizationId);
    const reopening = status === "OPEN" && conv.status !== "OPEN";
    await prisma.socialConversation.update({ where: { id }, data: { status, ...(status === "SPAM" || status === "RESOLVED" ? { slaDueAt: null } : {}), ...(reopening && !conv.firstResponseAt && conv.lastInboundAt ? { slaDueAt: new Date(conv.lastInboundAt.getTime() + settings.firstResponseMinutes * 60_000) } : {}) } });
    await auditInbox(caller.organizationId, status === "SPAM" ? "SOCIAL_INBOX_MARKED_SPAM" : "SOCIAL_INBOX_STATUS_CHANGED", id, { from: conv.status, to: status }, caller, meta);
    return this.get(caller, id).then((r) => r.conversation);
  },

  async setPriority(caller: SanitizedUser, id: string, priority: SocialConversationPriority, meta: RequestMeta = {}) {
    const conv = await prisma.socialConversation.findFirst({ where: { id, organizationId: caller.organizationId } });
    if (!conv) throw new NotFoundError("Conversation not found.");
    await prisma.socialConversation.update({ where: { id }, data: { priority } });
    await auditInbox(caller.organizationId, "SOCIAL_INBOX_PRIORITY_CHANGED", id, { from: conv.priority, to: priority }, caller, meta);
    return this.get(caller, id).then((r) => r.conversation);
  },

  async assign(caller: SanitizedUser, id: string, assigneeId: string | null, meta: RequestMeta = {}) {
    const conv = await prisma.socialConversation.findFirst({ where: { id, organizationId: caller.organizationId } });
    if (!conv) throw new NotFoundError("Conversation not found.");
    if (assigneeId) await assertAssignable(caller.organizationId, assigneeId);
    await prisma.socialConversation.update({ where: { id }, data: { assigneeId } });
    await auditInbox(caller.organizationId, "SOCIAL_INBOX_ASSIGNED", id, { from: conv.assigneeId, to: assigneeId }, caller, meta);
    if (assigneeId && assigneeId !== caller.id) {
      const last = await prisma.socialMessage.findFirst({ where: { conversationId: id, authorKind: "CUSTOMER" }, orderBy: { createdAt: "desc" }, select: { body: true } });
      await notifyInbox(caller.organizationId, [assigneeId], "social_inbox_assigned", "Inbox conversation assigned to you", id, last?.body);
    }
    return this.get(caller, id).then((r) => r.conversation);
  },

  async markRead(caller: SanitizedUser, id: string, read: boolean) {
    const conv = await prisma.socialConversation.findFirst({ where: { id, organizationId: caller.organizationId }, include: { account: true } });
    if (!conv) throw new NotFoundError("Conversation not found.");
    await prisma.socialConversation.update({ where: { id }, data: { isRead: read } });
    if (read) await syncProviderRead(conv);
    return { id, isRead: read };
  },

  async hideComment(caller: SanitizedUser, messageId: string, hidden: boolean, meta: RequestMeta = {}) {
    const msg = await prisma.socialMessage.findFirst({ where: { id: messageId, organizationId: caller.organizationId, direction: "INBOUND" }, include: { conversation: { include: { account: true } } } });
    if (!msg || !msg.providerMessageId) throw new NotFoundError("Message not found.");
    if (msg.conversation.type !== "COMMENT") throw new ValidationError("Only comments can be hidden.");
    const connector = connectorRegistry.getAvailable(msg.conversation.account.provider);
    if (!connector?.hideComment) throw new ConflictError(`Hiding comments is not supported for ${msg.conversation.account.provider} yet.`);
    const tokens = await socialAccountService.loadTokens(msg.socialAccountId).catch(() => null);
    if (!tokens) throw new ConflictError("No stored credentials. Reconnect the account.");
    try {
      await connector.hideComment(tokens, { providerMessageId: msg.providerMessageId, hidden });
    } catch (err) {
      if (err instanceof ConnectorNotImplementedError) throw new ConflictError("Hiding comments is not supported for this provider yet.");
      await auditInbox(caller.organizationId, "SOCIAL_INBOX_HIDE_FAILED", msg.conversationId, { messageId, hidden, error: safeText(err, [tokens.accessToken]) }, caller, meta, "FAILURE");
      throw new ConflictError("The network did not accept the request. Try again.");
    }
    await prisma.socialMessage.update({ where: { id: messageId }, data: { hidden } });
    await auditInbox(caller.organizationId, hidden ? "SOCIAL_INBOX_COMMENT_HIDDEN" : "SOCIAL_INBOX_COMMENT_UNHIDDEN", msg.conversationId, { messageId }, caller, meta);
    return { id: messageId, hidden };
  },

  async createLead(caller: SanitizedUser, id: string, input: { email?: string; name?: string; note?: string }, meta: RequestMeta = {}) {
    const conv = await prisma.socialConversation.findFirst({ where: { id, organizationId: caller.organizationId }, include: { account: { select: { provider: true } } } });
    if (!conv) throw new NotFoundError("Conversation not found.");
    if (conv.leadId || conv.contactId) throw new ConflictError("This conversation is already linked to the CRM.", { leadId: conv.leadId, contactId: conv.contactId });
    return handoffToCrm(conv, caller, input, meta);
  },

  async bulk(caller: SanitizedUser, ids: string[], patch: { status?: SocialConversationStatus; assigneeId?: string | null; priority?: SocialConversationPriority; markRead?: boolean }, meta: RequestMeta = {}) {
    if (patch.assigneeId) await assertAssignable(caller.organizationId, patch.assigneeId);
    const where = { id: { in: ids }, organizationId: caller.organizationId };
    const data: Prisma.SocialConversationUpdateManyMutationInput & { assigneeId?: string | null } = {};
    if (patch.status) { data.status = patch.status; if (patch.status === "SPAM" || patch.status === "RESOLVED") data.slaDueAt = null; }
    if (patch.priority) data.priority = patch.priority;
    if (patch.markRead !== undefined) data.isRead = patch.markRead;
    if ("assigneeId" in patch) data.assigneeId = patch.assigneeId;
    const res = await prisma.socialConversation.updateMany({ where, data });
    await auditInbox(caller.organizationId, "SOCIAL_INBOX_BULK_UPDATE", caller.organizationId, { count: res.count, requested: ids.length, patch: Object.keys(patch) }, caller, meta, "SUCCESS", "social_inbox");
    return { updated: res.count };
  },

  /** People who can work the inbox (for the assignee picker). Names only. */
  async assignees(organizationId: string) {
    const rows = await prisma.organizationMembership.findMany({
      where: { organizationId, status: "ACTIVE", user: { status: "ACTIVE", deletedAt: null }, role: { rolePermissions: { some: { permission: { key: "social.reply" } } } } },
      select: { user: { select: { id: true, firstName: true, lastName: true } } }, take: 100,
    });
    return rows.map((r) => ({ id: r.user.id, name: `${r.user.firstName} ${r.user.lastName}`.trim() }));
  },

  // ---- settings, rules, canned replies ----
  async getSettings(organizationId: string) {
    return getInboxSettings(organizationId);
  },

  async updateSettings(caller: SanitizedUser, input: Partial<InboxSettings>, meta: RequestMeta = {}) {
    if (!isAdmin(caller)) throw new AuthorizationError("Only administrators can change inbox settings.");
    const before = await getInboxSettings(caller.organizationId);
    await prisma.socialInboxSetting.upsert({ where: { organizationId: caller.organizationId }, create: { organizationId: caller.organizationId, ...DEFAULT_INBOX_SETTINGS, ...input, updatedById: caller.id }, update: { ...input, updatedById: caller.id } });
    const after = await getInboxSettings(caller.organizationId);
    await auditInbox(caller.organizationId, "SOCIAL_INBOX_SETTINGS_CHANGED", caller.organizationId, { before, after }, caller, meta, "SUCCESS", "social_inbox");
    return after;
  },

  listRules: (organizationId: string) => prisma.socialInboxRule.findMany({ where: { organizationId }, orderBy: { position: "asc" }, take: 100 }),
  async saveRule(caller: SanitizedUser, id: string | null, input: { name: string; enabled?: boolean; position?: number; matchKeywords?: string[]; matchIntents?: string[]; matchSentiments?: string[]; assigneeId?: string | null; setPriority?: SocialConversationPriority | null; addTags?: string[] }, meta: RequestMeta = {}) {
    if (input.assigneeId) await assertAssignable(caller.organizationId, input.assigneeId);
    if (!(input.matchKeywords?.length || input.matchIntents?.length || input.matchSentiments?.length)) throw new ValidationError("A rule needs at least one condition (keyword, intent or sentiment).");
    let rule;
    if (id) {
      const existing = await prisma.socialInboxRule.findFirst({ where: { id, organizationId: caller.organizationId } });
      if (!existing) throw new NotFoundError("Rule not found.");
      rule = await prisma.socialInboxRule.update({ where: { id }, data: input });
    } else rule = await prisma.socialInboxRule.create({ data: { ...input, organizationId: caller.organizationId } });
    await auditInbox(caller.organizationId, id ? "SOCIAL_INBOX_RULE_UPDATED" : "SOCIAL_INBOX_RULE_CREATED", rule.id, { name: rule.name }, caller, meta, "SUCCESS", "social_inbox_rule");
    return rule;
  },
  async deleteRule(caller: SanitizedUser, id: string, meta: RequestMeta = {}) {
    const res = await prisma.socialInboxRule.deleteMany({ where: { id, organizationId: caller.organizationId } });
    if (res.count !== 1) throw new NotFoundError("Rule not found.");
    await auditInbox(caller.organizationId, "SOCIAL_INBOX_RULE_DELETED", id, {}, caller, meta, "SUCCESS", "social_inbox_rule");
  },

  listCanned: (organizationId: string) => prisma.socialCannedReply.findMany({ where: { organizationId }, orderBy: { title: "asc" }, take: 200 }),
  async saveCanned(caller: SanitizedUser, id: string | null, input: { title: string; body: string; category?: string | null; approvedForAuto?: boolean; matchKeywords?: string[] }, meta: RequestMeta = {}) {
    // Only administrators can mark an answer as approved for auto-reply; everyone with social.reply manages ordinary canned replies.
    if (input.approvedForAuto && !isAdmin(caller)) throw new AuthorizationError("Only administrators can approve answers for auto-reply.");
    let row;
    if (id) {
      const existing = await prisma.socialCannedReply.findFirst({ where: { id, organizationId: caller.organizationId } });
      if (!existing) throw new NotFoundError("Canned reply not found.");
      if (existing.approvedForAuto && !isAdmin(caller)) throw new AuthorizationError("Only administrators can edit answers approved for auto-reply.");
      row = await prisma.socialCannedReply.update({ where: { id }, data: input });
    } else row = await prisma.socialCannedReply.create({ data: { ...input, organizationId: caller.organizationId, createdById: caller.id } });
    await auditInbox(caller.organizationId, id ? "SOCIAL_INBOX_CANNED_UPDATED" : "SOCIAL_INBOX_CANNED_CREATED", row.id, { title: row.title, approvedForAuto: row.approvedForAuto }, caller, meta, "SUCCESS", "social_canned_reply");
    return row;
  },
  async deleteCanned(caller: SanitizedUser, id: string, meta: RequestMeta = {}) {
    const existing = await prisma.socialCannedReply.findFirst({ where: { id, organizationId: caller.organizationId } });
    if (!existing) throw new NotFoundError("Canned reply not found.");
    if (existing.approvedForAuto && !isAdmin(caller)) throw new AuthorizationError("Only administrators can delete answers approved for auto-reply.");
    await prisma.socialCannedReply.delete({ where: { id } });
    await auditInbox(caller.organizationId, "SOCIAL_INBOX_CANNED_DELETED", id, {}, caller, meta, "SUCCESS", "social_canned_reply");
  },

  /** DEV/TEST ONLY (route is disabled in production): injects a mock event through the same ingest path the webhook uses. */
  async injectMock(caller: SanitizedUser, input: { accountId: string; type: InboundEvent["type"]; text: string; handle?: string; name?: string; threadId?: string; messageId?: string }) {
    if (config.nodeEnv === "production") throw new NotFoundError("Not found.");
    const account = await prisma.socialAccount.findFirst({ where: { id: input.accountId, organizationId: caller.organizationId } });
    if (!account || account.provider !== "mock") throw new ValidationError("Events can only be injected into mock accounts.");
    const stamp = Date.now().toString(36);
    const handle = input.handle ?? "demo_customer";
    return ingestEvent(account, { type: input.type, accountExternalId: account.externalAccountId, providerThreadId: input.threadId ?? `thread-${handle}-${input.type.toLowerCase()}`, providerMessageId: input.messageId ?? `msg-${stamp}-${Math.random().toString(36).slice(2, 7)}`, participant: { externalId: `ext-${handle}`, handle, name: input.name ?? handle }, text: input.text });
  },

  tick: inboxTick,
};

async function syncProviderRead(conv: { providerThreadId: string; account: { id: string; provider: string } }) {
  try {
    const connector = connectorRegistry.getAvailable(conv.account.provider);
    if (!connector?.markRead) return;
    const tokens = await socialAccountService.loadTokens(conv.account.id);
    if (tokens) await connector.markRead(tokens, { providerThreadId: conv.providerThreadId });
  } catch { /* provider read-sync is best-effort; "not supported" and network errors never block the UI */ }
}
