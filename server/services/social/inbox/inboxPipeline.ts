/**
 * Inbox pipeline: webhook + polling ingestion (idempotent by provider message id), deterministic prefilter, AI triage, routing
 * rules, auto-lead, AI reply drafts, guarded auto-reply, SLA notifications and retention purge. Message text is never logged.
 */
import { Prisma } from "@prisma/client";
import type { SocialAccount } from "@prisma/client";
import { prisma } from "../../../db/prisma";
import { logger } from "../../../core/logger";
import { AuthenticationError, NotFoundError } from "../../../core/errors";
import { connectorRegistry } from "../connectors/registry";
import { ConnectorNotImplementedError, type InboundEvent } from "../connectors/types";
import { socialPostService } from "../socialPostService";
import { socialAccountService } from "../socialAccountService";
import { publishingSettingsService } from "../publishing/publishingSettingsService";
import { inboxAi } from "./inboxAi";
import {
  applyRules, autoReplyKind, fallbackTriage, maxPriority, prefilter, retentionCutoff, slaDueAt, spamTriage, type InboxRule, type Priority, type Triage,
} from "./inboxPolicy";
import { auditInbox, getInboxSettings, handoffToCrm, handoffToCrmSafe, notifyInbox, repliers, safeText, sendReply, type InboxSettings } from "./inboxCore";

const MAX_EVENTS_PER_DELIVERY = 100;
const TRIAGE_MAX_ATTEMPTS = 3;
const systemActor = (organizationId: string) => ({ id: null, organizationId });

// ---------------- ingestion ----------------
export interface IngestResult { duplicate: boolean; conversationId: string; messageId: string | null }

/** Stores one inbound event for one of OUR accounts. Idempotent: the same provider message id is stored once per account. Fast: no AI here. */
export async function ingestEvent(account: Pick<SocialAccount, "id" | "organizationId" | "provider">, ev: InboundEvent, settings?: InboxSettings): Promise<IngestResult> {
  const s = settings ?? (await getInboxSettings(account.organizationId));
  const existing = await prisma.socialMessage.findUnique({ where: { socialAccountId_providerMessageId: { socialAccountId: account.id, providerMessageId: ev.providerMessageId } }, select: { id: true, conversationId: true } });
  if (existing) return { duplicate: true, conversationId: existing.conversationId, messageId: existing.id };

  const at = ev.createdAt && !Number.isNaN(Date.parse(ev.createdAt)) ? new Date(ev.createdAt) : new Date();
  const text = ev.text.slice(0, 5000);
  const voice = await socialPostService.getBrandVoice(account.organizationId);
  const pre = prefilter(text, voice.bannedWords);

  try {
    return await prisma.$transaction(async (tx) => {
      const prev = await tx.socialConversation.findUnique({ where: { socialAccountId_providerThreadId: { socialAccountId: account.id, providerThreadId: ev.providerThreadId } } });
      const reopen = !prev || prev.status === "RESOLVED" || (prev.status === "PENDING");
      const waiting = !prev || reopen || !prev.firstResponseAt;
      const conv = prev
        ? await tx.socialConversation.update({
            where: { id: prev.id },
            data: {
              lastMessageAt: at, lastInboundAt: at, isRead: false,
              ...(reopen && prev.status !== "SPAM" ? { status: "OPEN", firstResponseAt: null, awaitingSince: at, slaDueAt: slaDueAt(at, s.firstResponseMinutes), slaNotifiedAt: null } : {}),
              ...(!reopen && waiting && !prev.awaitingSince ? { awaitingSince: at } : {}),
              participantName: ev.participant.name ?? prev.participantName, participantHandle: ev.participant.handle ?? prev.participantHandle,
            },
          })
        : await tx.socialConversation.create({
            data: {
              organizationId: account.organizationId, socialAccountId: account.id, providerThreadId: ev.providerThreadId, type: ev.type,
              participantExternalId: ev.participant.externalId ?? null, participantHandle: ev.participant.handle ?? null, participantName: ev.participant.name ?? null, subjectRef: ev.subjectRef ?? null,
              status: "OPEN", lastMessageAt: at, lastInboundAt: at, awaitingSince: at, slaDueAt: slaDueAt(at, s.firstResponseMinutes), isRead: false,
            },
          });
      const message = await tx.socialMessage.create({
        data: {
          conversationId: conv.id, organizationId: account.organizationId, socialAccountId: account.id, direction: "INBOUND", authorKind: "CUSTOMER", providerMessageId: ev.providerMessageId,
          body: text, sendStatus: "RECEIVED", createdAt: at, triageStatus: pre.spam ? "DONE" : s.autoTriage ? "PENDING" : "SKIPPED",
        },
      });
      if (pre.spam) {
        const t = spamTriage(pre.spamScore);
        await tx.socialTriage.create({ data: { conversationId: conv.id, messageId: message.id, organizationId: account.organizationId, intent: t.intent, sentiment: t.sentiment, priority: t.priority, spamScore: t.spamScore, suggestedCategory: t.category, confidence: t.confidence, source: t.source, flaggedForHuman: false } });
        await tx.socialConversation.update({ where: { id: conv.id }, data: { status: "SPAM", intent: "spam", priority: "LOW", slaDueAt: null } });
      } else if (pre.bannedWordHit) {
        await tx.socialConversation.update({ where: { id: conv.id }, data: { needsHuman: true } });
      }
      return { duplicate: false, conversationId: conv.id, messageId: message.id };
    });
  } catch (err) {
    // A concurrent delivery of the same event wins the unique index; that is a duplicate, not an error.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const again = await prisma.socialMessage.findUnique({ where: { socialAccountId_providerMessageId: { socialAccountId: account.id, providerMessageId: ev.providerMessageId } }, select: { id: true, conversationId: true } });
      if (again) return { duplicate: true, conversationId: again.conversationId, messageId: again.id };
    }
    throw err;
  }
}

/** Verified webhook delivery → ingest. The signature is checked by the provider's connector and fails closed. */
export async function ingestWebhook(provider: string, rawBody: Buffer | undefined, headers: Record<string, string | string[] | undefined>): Promise<{ accepted: number; duplicates: number; ignored: number }> {
  const connector = connectorRegistry.get(provider);
  if (!connector || !connector.isConfigured() || !connector.verifyWebhook || !connector.parseWebhook) throw new NotFoundError("Not found.");
  let verified = false;
  try { verified = !!rawBody && connector.verifyWebhook({ rawBody, headers }); } catch (err) {
    if (err instanceof ConnectorNotImplementedError) throw new NotFoundError("Not found.");
    verified = false;
  }
  if (!verified) throw new AuthenticationError("Missing or invalid webhook signature.");
  const events = connector.parseWebhook({ rawBody: rawBody! }).slice(0, MAX_EVENTS_PER_DELIVERY);
  let accepted = 0, duplicates = 0, ignored = 0;
  for (const ev of events) {
    const accounts = await prisma.socialAccount.findMany({ where: { provider, externalAccountId: ev.accountExternalId, status: { not: "DISCONNECTED" } } });
    if (accounts.length === 0) { ignored += 1; continue; }
    for (const account of accounts) {
      const r = await ingestEvent(account, ev);
      if (r.duplicate) duplicates += 1; else accepted += 1;
    }
  }
  logger.info({ provider, accepted, duplicates, ignored }, "[social-inbox] webhook processed");
  return { accepted, duplicates, ignored };
}

/** Polling fallback: only for connectors that declare `pollsInbox`. Bounded per tick; at most one poll per account every 4 minutes. */
export async function pollInboxes(limit = 20): Promise<{ polled: number; events: number }> {
  const accounts = await prisma.socialAccount.findMany({ where: { status: "CONNECTED" }, take: 200 });
  let polled = 0, events = 0;
  const due = new Date(Date.now() - 4 * 60_000);
  for (const account of accounts) {
    if (polled >= limit) break;
    const connector = connectorRegistry.getAvailable(account.provider);
    if (!connector?.pollsInbox || !connector.fetchInbox) continue;
    const cursor = await prisma.socialInboxCursor.findUnique({ where: { socialAccountId: account.id } });
    if (cursor && cursor.polledAt > due) continue;
    polled += 1;
    try {
      const tokens = await socialAccountService.loadTokens(account.id);
      if (!tokens) continue;
      const res = await connector.fetchInbox(tokens, { accountExternalId: account.externalAccountId, cursor: cursor?.cursor ?? undefined });
      const settings = await getInboxSettings(account.organizationId);
      for (const ev of res.events.slice(0, MAX_EVENTS_PER_DELIVERY)) {
        if (ev.accountExternalId !== account.externalAccountId) continue;
        if (!(await ingestEvent(account, ev, settings)).duplicate) events += 1;
      }
      await prisma.socialInboxCursor.upsert({ where: { socialAccountId: account.id }, create: { socialAccountId: account.id, cursor: res.nextCursor ?? null }, update: { cursor: res.nextCursor ?? null, polledAt: new Date() } });
    } catch (err) {
      logger.error({ accountId: account.id, err: safeText(err) }, "[social-inbox] poll failed");
    }
  }
  return { polled, events };
}

// ---------------- triage ----------------
async function loadRules(organizationId: string): Promise<InboxRule[]> {
  const rows = await prisma.socialInboxRule.findMany({ where: { organizationId, enabled: true }, orderBy: { position: "asc" }, take: 100 });
  return rows.map((r) => ({ ...r, setPriority: r.setPriority as Priority | null }));
}

/** Persists a triage result, applies routing rules and the follow-up automations (auto-lead, draft, guarded auto-reply). */
async function applyTriage(messageId: string, conversationId: string, organizationId: string, triage: Triage, executionId: string | null, settings: InboxSettings) {
  await prisma.socialTriage.upsert({
    where: { messageId },
    create: { messageId, conversationId, organizationId, intent: triage.intent, sentiment: triage.sentiment, priority: triage.priority, language: triage.language, spamScore: triage.spamScore, suggestedCategory: triage.category, confidence: triage.confidence, source: triage.source, flaggedForHuman: triage.flaggedForHuman, aiExecutionId: executionId },
    update: { intent: triage.intent, sentiment: triage.sentiment, priority: triage.priority, language: triage.language, spamScore: triage.spamScore, suggestedCategory: triage.category, confidence: triage.confidence, source: triage.source, flaggedForHuman: triage.flaggedForHuman, aiExecutionId: executionId },
  });
  await prisma.socialMessage.update({ where: { id: messageId }, data: { triageStatus: "DONE" } });

  const conv = await prisma.socialConversation.findUniqueOrThrow({ where: { id: conversationId }, include: { account: true } });
  const msg = await prisma.socialMessage.findUniqueOrThrow({ where: { id: messageId }, select: { body: true } });
  const outcome = applyRules(await loadRules(organizationId), { text: msg.body, intent: triage.intent, sentiment: triage.sentiment });
  const priority = maxPriority(maxPriority(conv.priority as Priority, triage.priority), outcome.priority ?? "LOW");
  const tags = [...new Set([...conv.tags, ...outcome.tags])];
  const newAssignee = !conv.assigneeId && outcome.assigneeId ? outcome.assigneeId : null;
  await prisma.socialConversation.update({
    where: { id: conversationId },
    data: {
      intent: triage.intent, sentiment: triage.sentiment, priority, tags, needsHuman: conv.needsHuman || triage.flaggedForHuman,
      ...(triage.intent === "spam" ? { status: "SPAM", slaDueAt: null } : {}), ...(newAssignee ? { assigneeId: newAssignee } : {}),
    },
  });
  if (outcome.matchedRuleIds.length) await auditInbox(organizationId, "SOCIAL_INBOX_RULES_APPLIED", conversationId, { rules: outcome.matchedRuleIds, assigned: !!newAssignee, tags: outcome.tags }, null);
  if (newAssignee) await notifyInbox(organizationId, [newAssignee], "social_inbox_assigned", "Inbox conversation assigned to you", conversationId, msg.body);
  else if (triage.flaggedForHuman && !conv.assigneeId && triage.intent !== "spam") {
    await notifyInbox(organizationId, await repliers(organizationId), "social_inbox_attention", triage.intent === "complaint" ? "Complaint needs attention" : "Inbox item needs a human", conversationId, msg.body);
  }
  if (triage.intent === "spam") return;

  if (settings.autoLead && triage.intent === "lead" && !conv.leadId && !conv.contactId) await handoffToCrmSafe(conv, null);

  if (conv.type === "REVIEW") return;
  const needsDraft = settings.autoDraft || settings.autoReply;
  if (!needsDraft || conv.status === "RESOLVED") return;
  const auto = settings.autoReply ? autoReplyKind(triage, msg.body, await prisma.socialCannedReply.findMany({ where: { organizationId, approvedForAuto: true }, take: 100 })) : null;
  try {
    if (auto?.kind === "faq" && auto.reply) {
      await autoSend(organizationId, conversationId, auto.reply.body);
    } else {
      const draft = await generateDraft(systemActor(organizationId), organizationId, conversationId);
      if (auto?.kind === "thanks" && draft.guardrail.passed && (draft.confidence ?? 0) >= 0.8) await autoSend(organizationId, conversationId, undefined, draft.messageId);
    }
  } catch (err) {
    logger.warn({ conversationId, err: safeText(err) }, "[social-inbox] draft/auto-reply skipped");
  }
}

async function autoSend(organizationId: string, conversationId: string, body?: string, messageId?: string) {
  // Auto-reply = same sender as humans, plus: live publishing only (not dry-run), kill switch, guardrails, rate limit.
  await sendReply(organizationId, conversationId, { actor: null, body, messageId, autoSent: true, requireLive: true });
}

/** Generates (or regenerates) the AI draft for a conversation. Stored as an AI_DRAFT message; NEVER sent from here. */
export async function generateDraft(actor: { id: string | null; organizationId: string }, organizationId: string, conversationId: string): Promise<{ messageId: string; body: string; confidence: number | null; guardrail: import("../guardrails").GuardrailResult }> {
  const conv = await prisma.socialConversation.findFirst({ where: { id: conversationId, organizationId }, include: { account: true } });
  if (!conv) throw new NotFoundError("Conversation not found.");
  const thread = await prisma.socialMessage.findMany({ where: { conversationId, authorKind: { in: ["CUSTOMER", "PAGE"] }, sendStatus: { in: ["RECEIVED", "SENT"] } }, orderBy: { createdAt: "asc" }, take: 30, select: { id: true, authorKind: true, body: true } });
  const lastInbound = [...thread].reverse().find((m) => m.authorKind === "CUSTOMER");
  if (!lastInbound) throw new NotFoundError("There is nothing to reply to yet.");
  const approved = await prisma.socialCannedReply.findMany({ where: { organizationId, approvedForAuto: true }, take: 20, select: { title: true, body: true } });
  const run = await inboxAi.draftReply(actor, {
    conversationId, messageId: lastInbound.id, account: conv.account, type: conv.type.toLowerCase(),
    thread: thread.map((m) => ({ who: m.authorKind === "CUSTOMER" ? "Customer" : "Page", text: m.body })), approved,
  });
  await prisma.socialMessage.deleteMany({ where: { conversationId, authorKind: "AI_DRAFT", sendStatus: "DRAFT" } });
  const draft = await prisma.socialMessage.create({
    data: { conversationId, organizationId, socialAccountId: conv.socialAccountId, direction: "OUTBOUND", authorKind: "AI_DRAFT", body: run.body, sendStatus: "DRAFT", aiExecutionId: run.executionId, aiConfidence: run.confidence, guardrailResult: run.guardrail as unknown as Prisma.InputJsonValue },
  });
  await auditInbox(organizationId, "SOCIAL_INBOX_DRAFT_GENERATED", conversationId, { messageId: draft.id, chars: run.body.length, confidence: run.confidence, guardrailPassed: run.guardrail.passed, executionId: run.executionId }, actor.id ? { id: actor.id } : null);
  return { messageId: draft.id, body: run.body, confidence: run.confidence, guardrail: run.guardrail };
}

/** Triage pending messages: bounded, optimistic-claimed so parallel ticks never double-classify. */
export async function processTriage(limit = 10, budgetMs = 8000): Promise<{ triaged: number; failed: number }> {
  const started = Date.now();
  const pending = await prisma.socialMessage.findMany({ where: { triageStatus: "PENDING", direction: "INBOUND" }, orderBy: { createdAt: "asc" }, take: limit, include: { conversation: { select: { type: true } } } });
  let triaged = 0, failed = 0;
  for (const m of pending) {
    if (Date.now() - started > budgetMs) break;
    const claim = await prisma.socialMessage.updateMany({ where: { id: m.id, triageStatus: "PENDING", triageAttempts: m.triageAttempts }, data: { triageAttempts: m.triageAttempts + 1 } });
    if (claim.count !== 1) continue;
    const settings = await getInboxSettings(m.organizationId);
    try {
      const { triage, executionId } = await inboxAi.triage(systemActor(m.organizationId), { messageId: m.id, conversationId: m.conversationId, type: m.conversation.type.toLowerCase(), text: m.body });
      await applyTriage(m.id, m.conversationId, m.organizationId, triage, executionId, settings);
      triaged += 1;
    } catch (err) {
      failed += 1;
      logger.warn({ messageId: m.id, attempt: m.triageAttempts + 1, err: safeText(err) }, "[social-inbox] triage failed");
      if (m.triageAttempts + 1 >= TRIAGE_MAX_ATTEMPTS) await applyTriage(m.id, m.conversationId, m.organizationId, fallbackTriage(), null, settings).catch(() => undefined);
    }
  }
  return { triaged, failed };
}

// ---------------- SLA ----------------
export async function notifyOverdue(now = new Date()): Promise<number> {
  const rows = await prisma.socialConversation.findMany({ where: { status: { in: ["OPEN", "PENDING"] }, firstResponseAt: null, slaDueAt: { lt: now }, slaNotifiedAt: null }, take: 100, orderBy: { slaDueAt: "asc" } });
  let n = 0;
  for (const c of rows) {
    const claim = await prisma.socialConversation.updateMany({ where: { id: c.id, slaNotifiedAt: null }, data: { slaNotifiedAt: now } });
    if (claim.count !== 1) continue;
    n += 1;
    const targets = c.assigneeId ? [c.assigneeId] : await repliers(c.organizationId);
    await notifyInbox(c.organizationId, targets, "social_inbox_overdue", "Reply overdue", c.id);
  }
  return n;
}

// ---------------- retention ----------------
export async function purgeExpired(now = new Date()): Promise<{ messages: number; conversations: number }> {
  const orgs = await prisma.socialConversation.findMany({ distinct: ["organizationId"], select: { organizationId: true }, take: 500 });
  let messages = 0, conversations = 0;
  for (const { organizationId } of orgs) {
    const { retentionDays } = await getInboxSettings(organizationId);
    const cutoff = retentionCutoff(now, retentionDays);
    const m = await prisma.socialMessage.deleteMany({ where: { organizationId, createdAt: { lt: cutoff } } });
    const c = await prisma.socialConversation.deleteMany({ where: { organizationId, lastMessageAt: { lt: cutoff }, messages: { none: {} } } });
    if (m.count || c.count) await auditInbox(organizationId, "SOCIAL_INBOX_RETENTION_PURGE", organizationId, { messages: m.count, conversations: c.count, retentionDays, cutoff: cutoff.toISOString() }, null, undefined, "SUCCESS", "social_inbox");
    messages += m.count; conversations += c.count;
  }
  return { messages, conversations };
}

/** One scheduler pass: poll, triage, SLA notifications, and (in the 02–04 UTC window) the retention purge. Never throws. */
export async function inboxTick(now = new Date(), opts: { forcePurge?: boolean } = {}) {
  const out = { polled: { polled: 0, events: 0 }, triage: { triaged: 0, failed: 0 }, overdueNotified: 0, purged: { messages: 0, conversations: 0 } };
  const step = async <T>(name: string, fn: () => Promise<T>, fallback: T): Promise<T> => { try { return await fn(); } catch (err) { logger.error({ step: name, err: safeText(err) }, "[social-inbox] tick step failed"); return fallback; } };
  out.polled = await step("poll", () => pollInboxes(), out.polled);
  out.triage = await step("triage", () => processTriage(), out.triage);
  out.overdueNotified = await step("sla", () => notifyOverdue(now), 0);
  const h = now.getUTCHours();
  if (opts.forcePurge || (h >= 2 && h <= 4)) out.purged = await step("purge", () => purgeExpired(now), out.purged);
  return out;
}

export { handoffToCrm, publishingSettingsService };
