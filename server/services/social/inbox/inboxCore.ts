/** Shared inbox helpers: workspace settings, audit/notify wrappers (never carrying message text), the CRM hand-off and the reply sender. */
import type { Prisma, SocialConversation, SocialMessage } from "@prisma/client";
import { prisma } from "../../../db/prisma";
import { config } from "../../../config/env";
import { logger } from "../../../core/logger";
import { AuthorizationError, ConflictError, NotFoundError, RateLimitError, ValidationError } from "../../../core/errors";
import { auditLogRepository } from "../../../repositories/auditLogRepository";
import { leadRepository } from "../../../repositories/leadRepository";
import { notificationService } from "../../notificationService";
import { eventEngine } from "../../automation/EventEngine";
import { connectorRegistry } from "../connectors/registry";
import { SocialPublishError } from "../publishing/publishErrors";
import { publishingSettingsService } from "../publishing/publishingSettingsService";
import { socialAccountService } from "../socialAccountService";
import { redactSecrets } from "../tokenVault";
import { runGuardrails, type GuardrailResult } from "../guardrails";
import { socialPostService } from "../socialPostService";
import { redactPreview, socialLeadSource } from "./inboxPolicy";
import { randomUUID } from "node:crypto";
import type { SanitizedUser } from "../../../types/domain";
import type { RequestMeta } from "../../authService";

export interface InboxSettings {
  autoTriage: boolean; autoDraft: boolean; autoReply: boolean; autoLead: boolean; firstResponseMinutes: number; retentionDays: number;
}
export const DEFAULT_INBOX_SETTINGS: InboxSettings = { autoTriage: true, autoDraft: false, autoReply: false, autoLead: false, firstResponseMinutes: 60, retentionDays: 180 };

export async function getInboxSettings(organizationId: string): Promise<InboxSettings> {
  const row = await prisma.socialInboxSetting.findUnique({ where: { organizationId } });
  return row ? { autoTriage: row.autoTriage, autoDraft: row.autoDraft, autoReply: row.autoReply, autoLead: row.autoLead, firstResponseMinutes: row.firstResponseMinutes, retentionDays: row.retentionDays } : DEFAULT_INBOX_SETTINGS;
}

export const safeText = (err: unknown, secrets: Array<string | undefined> = []) => redactSecrets(err, secrets).slice(0, 300);

/** Audit entries carry ids, counts and labels only — never message text. */
export async function auditInbox(organizationId: string, action: string, resourceId: string, metadata: Record<string, unknown>, actor?: { id: string } | null, meta?: RequestMeta, result: "SUCCESS" | "FAILURE" = "SUCCESS", resourceType = "social_conversation") {
  await auditLogRepository.record({
    organizationId, actorUserId: actor?.id, actorType: actor ? "USER" : "SYSTEM", action, resourceType, resourceId, result, metadata,
    ipAddress: meta?.ip, userAgent: meta?.userAgent,
  }).catch((err) => logger.error({ resourceId, action, err: safeText(err) }, "[social-inbox] audit write failed"));
}

/** Users who may work the inbox (social.reply), bounded. */
export async function repliers(organizationId: string): Promise<string[]> {
  const rows = await prisma.organizationMembership.findMany({
    where: { organizationId, status: "ACTIVE", user: { status: "ACTIVE", deletedAt: null }, role: { rolePermissions: { some: { permission: { key: "social.reply" } } } } },
    select: { userId: true }, take: 20,
  });
  return rows.map((r) => r.userId);
}

/** Notification with a short redacted preview only. The preview is never the full message. */
export async function notifyInbox(organizationId: string, userIds: string[], type: string, title: string, conversationId: string, previewSource?: string) {
  const preview = previewSource ? redactPreview(previewSource) : "";
  await Promise.all(userIds.map((userId) => notificationService.notify({ organizationId, userId, type, title, message: preview ? `“${preview}”` : "Open the inbox to see it.", entityType: "social_conversation", entityId: conversationId })));
}

export async function assertAssignable(organizationId: string, userId: string): Promise<void> {
  const ok = await prisma.organizationMembership.findFirst({
    where: { organizationId, userId, status: "ACTIVE", user: { status: "ACTIVE", deletedAt: null }, role: { rolePermissions: { some: { permission: { key: "social.reply" } } } } }, select: { id: true },
  });
  if (!ok) throw new ValidationError("That person is not an active member of this workspace with permission to reply.");
}

// ---------------- CRM hand-off ----------------
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/;
export type LeadHandoff = { outcome: "created" | "linked_lead" | "linked_contact"; leadId: string | null; contactId: string | null };

/** Shared by the "Create lead" button and the auto-lead rule. Reuses the CRM's own dedupe: open lead by email, then by the social source tag; existing contact by email is linked, not duplicated. */
export async function handoffToCrm(conv: SocialConversation & { account: { provider: string } }, actor: { id: string } | null, opts: { email?: string; name?: string; note?: string } = {}, meta?: RequestMeta): Promise<LeadHandoff> {
  if (conv.leadId || conv.contactId) return { outcome: conv.leadId ? "linked_lead" : "linked_contact", leadId: conv.leadId, contactId: conv.contactId };
  const inbound = await prisma.socialMessage.findMany({ where: { conversationId: conv.id, direction: "INBOUND" }, orderBy: { createdAt: "asc" }, take: 20, select: { body: true } });
  const email = (opts.email?.trim() || inbound.map((m) => EMAIL_RE.exec(m.body)?.[0]).find(Boolean) || "").toLowerCase() || undefined;
  const handle = conv.participantHandle ?? conv.participantExternalId ?? conv.id;
  const source = socialLeadSource(conv.account.provider, handle);
  const name = (opts.name?.trim() || conv.participantName || conv.participantHandle || "Social contact").slice(0, 200);
  const excerpt = (inbound[0]?.body ?? "").replace(/\s+/g, " ").slice(0, 280);
  const link = `Social conversation: /social/inbox?conversation=${conv.id}`;
  const orgId = conv.organizationId;

  const done = async (outcome: LeadHandoff["outcome"], leadId: string | null, contactId: string | null) => {
    await prisma.socialConversation.update({ where: { id: conv.id }, data: { leadId, contactId } });
    await auditInbox(orgId, "SOCIAL_INBOX_LEAD_LINKED", conv.id, { outcome, leadId, contactId, auto: !actor }, actor, meta);
    return { outcome, leadId, contactId };
  };

  if (email) {
    const contact = await prisma.contact.findFirst({ where: { organizationId: orgId, email: { equals: email, mode: "insensitive" }, deletedAt: null }, select: { id: true } });
    if (contact) return done("linked_contact", null, contact.id);
    const byEmail = (await leadRepository.findByEmailInOrg(orgId, email))[0];
    if (byEmail) {
      await prisma.lead.update({ where: { id: byEmail.id }, data: { notes: `${byEmail.notes ? `${byEmail.notes}\n\n---\n\n` : ""}${link}` } });
      return done("linked_lead", byEmail.id, null);
    }
  }
  const bySource = await prisma.lead.findFirst({ where: { organizationId: orgId, source, deletedAt: null, status: { notIn: ["CONVERTED", "LOST"] } }, orderBy: { createdAt: "desc" } });
  if (bySource) {
    await prisma.lead.update({ where: { id: bySource.id }, data: { notes: `${bySource.notes ? `${bySource.notes}\n\n---\n\n` : ""}${link}` } });
    return done("linked_lead", bySource.id, null);
  }

  const lead = await leadRepository.create({
    organizationId: orgId, companyName: name, contactName: name, email, source,
    notes: [`Social lead from ${conv.account.provider} (${conv.type.toLowerCase()}) ${conv.participantHandle ? `@${conv.participantHandle.replace(/^@/, "")}` : ""}`.trim(), excerpt ? `Excerpt: ${excerpt}` : "", opts.note ?? "", link].filter(Boolean).join("\n\n"),
    assignedTo: conv.assigneeId ?? undefined,
  });
  await auditLogRepository.record({ organizationId: orgId, actorUserId: actor?.id, actorType: actor ? "USER" : "SYSTEM", action: "LEAD_CREATED", resourceType: "lead", resourceId: lead.id, afterData: { companyName: lead.companyName, source: lead.source }, ipAddress: meta?.ip, userAgent: meta?.userAgent });
  try {
    await eventEngine.emit({ eventType: "lead.created", entityType: "lead", entityId: lead.id, organizationId: orgId, actorId: actor?.id, actorType: actor ? "USER" : "SYSTEM", sourceModule: "CRM", payload: { companyName: lead.companyName, source: lead.source } } as never);
  } catch { /* best-effort, same as every other lead intake path */ }
  return done("created", lead.id, null);
}

// ---------------- sending ----------------
async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([p, new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new SocialPublishError("uncertain", "The network did not answer in time; the reply may or may not have been sent.")), ms); })]);
  } finally { if (timer) clearTimeout(timer); }
}

export interface SendOptions {
  /** A human: permission already checked by the route. null = the system (auto-reply only). */
  actor: SanitizedUser | null;
  messageId?: string;
  body?: string;
  resolve?: boolean;
  confirmNotSent?: boolean;
  autoSent?: boolean;
  meta?: RequestMeta;
  /** Auto-reply additionally needs live (non-dry-run) publishing. */
  requireLive?: boolean;
}

/**
 * Sends one reply through the connector interface. Checks (in order): workspace scope, kill switch (and live gate for auto-reply),
 * account state, guardrails, per-account rate limit, then an atomic DRAFT/FAILED → SENDING claim so a message is never sent twice.
 * An unknown outcome (timeout) becomes UNCERTAIN and is never retried without `confirmNotSent`.
 */
export async function sendReply(organizationId: string, conversationId: string, o: SendOptions): Promise<SocialMessage> {
  const conv = await prisma.socialConversation.findFirst({ where: { id: conversationId, organizationId }, include: { account: true } });
  if (!conv) throw new NotFoundError("Conversation not found.");
  if (conv.status === "SPAM") throw new ConflictError("This conversation is marked as spam. Reopen it before replying.");

  const kill = await publishingSettingsService.killed(organizationId);
  if (kill.killed) throw new ConflictError(`Sending is paused (${kill.reason.replace(/_/g, " ")}).`);
  if (o.requireLive) {
    const gate = await publishingSettingsService.gate(organizationId);
    if (!gate.allowed || gate.dryRun) throw new ConflictError("Live sending is not enabled for this workspace.");
  }
  if (conv.account.status !== "CONNECTED") throw new ConflictError(`${conv.account.displayName} is ${conv.account.status.toLowerCase().replace("_", " ")}. Reconnect it first.`);
  const connector = connectorRegistry.getAvailable(conv.account.provider);
  if (!connector?.sendReply) throw new ConflictError(`Replies are not supported for ${conv.account.provider} yet.`);
  // Network messaging policy (e.g. Messenger's 24-hour window): checked BEFORE anything is created or claimed.
  const win = connector.replyWindow?.({ type: conv.type, lastInboundAt: conv.lastInboundAt, now: new Date() });
  if (win && !win.open) throw new ConflictError(win.reason ?? "This reply is outside the network's messaging window.");

  // Resolve the message to send.
  let msg: SocialMessage;
  if (o.messageId) {
    const found = await prisma.socialMessage.findFirst({ where: { id: o.messageId, conversationId, organizationId, direction: "OUTBOUND" } });
    if (!found || found.authorKind === "NOTE") throw new NotFoundError("Draft not found.");
    if (found.sendStatus === "UNCERTAIN" && !o.confirmNotSent) throw new ValidationError("Confirm that the reply is NOT visible on the network before sending it again (otherwise it may be sent twice).");
    if (!["DRAFT", "FAILED", "UNCERTAIN"].includes(found.sendStatus)) throw new ConflictError(`This message is ${found.sendStatus.toLowerCase()}.`);
    msg = found;
  } else {
    const body = o.body?.trim();
    if (!body) throw new ValidationError("Write a reply first.");
    msg = await prisma.socialMessage.create({ data: { conversationId, organizationId, socialAccountId: conv.socialAccountId, direction: "OUTBOUND", authorKind: "PAGE", body, sendStatus: "DRAFT", sentById: o.actor?.id ?? null } });
  }
  const text = (o.body?.trim() || msg.body).trim();
  if (!text) throw new ValidationError("The reply is empty.");

  const guard = await replyGuardrails(organizationId, conv.account, text);
  if (!guard.passed) throw new ValidationError("Fix the blocking issues before sending.", { issues: guard.issues.filter((i) => i.severity === "block") });

  const sinceMinute = new Date(Date.now() - 60_000);
  const recent = await prisma.socialMessage.count({ where: { socialAccountId: conv.socialAccountId, direction: "OUTBOUND", sendStatus: { in: ["SENDING", "SENT"] }, authorKind: { not: "NOTE" }, sentAt: { gte: sinceMinute } } });
  if (recent >= config.socialReplyRatePerMinute) throw new RateLimitError("This account is sending replies too quickly. Try again in a minute.");

  const key = msg.sendIdempotencyKey ?? `rep_${randomUUID()}`;
  const claim = await prisma.socialMessage.updateMany({
    where: { id: msg.id, sendStatus: msg.sendStatus },
    data: { sendStatus: "SENDING", body: text, sendIdempotencyKey: key, sentById: o.actor?.id ?? msg.sentById, sentAt: new Date(), sendError: null, autoSent: !!o.autoSent, guardrailResult: guard as unknown as Prisma.InputJsonValue },
  });
  if (claim.count !== 1) throw new ConflictError("This reply is already being sent.");

  const inReplyTo = (await prisma.socialMessage.findFirst({ where: { conversationId, direction: "INBOUND", providerMessageId: { not: null } }, orderBy: { createdAt: "desc" }, select: { providerMessageId: true } }))?.providerMessageId ?? undefined;
  let tokens;
  try { tokens = await socialAccountService.loadTokens(conv.socialAccountId); } catch { tokens = null; }
  const fail = async (status: "FAILED" | "UNCERTAIN", message: string, kind: string) => {
    const updated = await prisma.socialMessage.update({ where: { id: msg.id }, data: { sendStatus: status, sendError: `${kind}: ${message}` } });
    await auditInbox(organizationId, "SOCIAL_INBOX_REPLY_FAILED", conversationId, { messageId: msg.id, kind, status }, o.actor, o.meta, "FAILURE");
    return updated;
  };
  if (!tokens) return fail("FAILED", "No stored credentials. Reconnect the account.", "auth");

  try {
    const result = await withTimeout(connector.sendReply(tokens, { accountExternalId: conv.account.externalAccountId, conversationType: conv.type, providerThreadId: conv.providerThreadId, inReplyToProviderMessageId: inReplyTo, participantExternalId: conv.participantExternalId ?? undefined, text, idempotencyKey: key }), 25_000);
    const now = new Date();
    const sent = await prisma.socialMessage.update({ where: { id: msg.id }, data: { sendStatus: "SENT", providerMessageId: result.providerMessageId, sentAt: now, authorKind: "PAGE", sendError: null } });
    await prisma.socialConversation.update({ where: { id: conversationId }, data: { status: o.resolve ? "RESOLVED" : "PENDING", isRead: true, lastMessageAt: now, slaDueAt: null, needsHuman: false, ...(conv.firstResponseAt ? {} : { firstResponseAt: now }) } });
    await auditInbox(organizationId, o.autoSent ? "SOCIAL_INBOX_AUTO_REPLY_SENT" : "SOCIAL_INBOX_REPLY_SENT", conversationId, { messageId: msg.id, chars: text.length, resolved: !!o.resolve, provider: conv.account.provider }, o.actor, o.meta);
    return sent;
  } catch (err) {
    const kind = err instanceof SocialPublishError ? err.kind : "uncertain";
    const message = safeText(err instanceof SocialPublishError ? err.message : `Unexpected error: ${(err as Error)?.message ?? err}`, [tokens.accessToken, tokens.refreshToken]);
    if (kind === "auth") await prisma.socialAccount.update({ where: { id: conv.socialAccountId }, data: { status: "NEEDS_REAUTH", lastError: message } });
    return fail(kind === "uncertain" ? "UNCERTAIN" : "FAILED", message, kind);
  }
}

/** Guardrails for a reply (banned words, length, account state). Disclaimers are a post rule, so they are not required here. */
export async function replyGuardrails(organizationId: string, account: { id: string; provider: string; accountType: string; displayName: string; status: string }, text: string): Promise<GuardrailResult> {
  const voice = await socialPostService.getBrandVoice(organizationId);
  const constraints = connectorRegistry.constraintsFor(account.provider, account.accountType);
  return runGuardrails({
    targets: [{ socialAccountId: account.id, label: account.displayName, text, constraints: { ...constraints, maxChars: Math.min(constraints.maxChars, 1000), requiresMedia: false }, accountStatus: account.status }],
    fallbackText: text, linkUrl: null, mediaCount: 0, hasSourceContent: false, brandVoice: { bannedWords: voice.bannedWords, requiredDisclaimers: [] }, recentBodies: [],
  });
}

export { AuthorizationError };

/** Auto-lead must never break triage. */
export async function handoffToCrmSafe(conv: Parameters<typeof handoffToCrm>[0], actor: { id: string } | null) {
  try { return await handoffToCrm(conv, actor); } catch (err) { logger.warn({ conversationId: conv.id, err: safeText(err) }, "[social-inbox] auto-lead skipped"); return null; }
}
