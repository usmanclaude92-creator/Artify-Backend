/**
 * Meta platform callbacks (Step 15):
 *  - Deauthorize: the person who connected a Page/Instagram account removed the app in Facebook. Their accounts move to NEEDS_REAUTH and the stored tokens are deleted.
 *  - Data deletion: the same person asked Facebook to delete the data the app holds about them. We create a privacy request that waits for a human approver
 *    (same two-step Approvals-center flow as manual erasure); nothing is deleted until it is approved. Meta gets a confirmation code and a status URL immediately.
 * Matching uses the app-scoped user id Meta sends (`user_id`): social accounts connected by that person (`social_accounts.meta_user_id`) and conversations whose
 * participant id equals it (comment/mention authors). Direct-message participants carry page-scoped ids that Meta does not reveal in these callbacks, so they
 * are handled through the public Data Deletion Instructions page instead (docs/META_APP_REVIEW.md §Limits).
 * No personal data is stored in the request rows: only a keyed hash of the id, counts and record ids.
 */
import { createHmac, randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { config } from "../../config/env";
import { auditLogRepository } from "../../repositories/auditLogRepository";
import { notificationService } from "../notificationService";
import { createPrivacyApproval } from "../ops/privacyService";
import { parseSignedRequest } from "./signedRequest";
import type { RequestMeta } from "../authService";

export const META_REQUESTER = "meta-callback";
export const META_DELETION_KIND = "META_DELETION";
const STATUS_URL_PATH = "/data-deletion-status";

export const metaSubjectRef = (userId: string): string => createHmac("sha256", config.sessionSecret).update(`meta-subject:${userId}`).digest("hex").slice(0, 20);
const newCode = (): string => `MDR-${randomBytes(12).toString("base64url")}`;
const siteBase = (): string => (config.publicSiteBaseUrl || "https://artifysols.com").replace(/\/+$/, "");
export const statusUrl = (code: string): string => `${siteBase()}${STATUS_URL_PATH}?code=${encodeURIComponent(code)}`;

interface MetaTargets { accounts: string[]; conversations: string[] }

async function approvers(orgId: string): Promise<string[]> {
  const rows = await prisma.organizationMembership.findMany({
    where: { organizationId: orgId, status: "ACTIVE", user: { status: "ACTIVE", deletedAt: null }, role: { OR: [{ key: "SUPER_ADMIN" }, { rolePermissions: { some: { permission: { key: "privacy.erase" } } } }] } },
    select: { userId: true }, take: 20,
  });
  return rows.map((r) => r.userId);
}

export const metaCallbackService = {
  /** Deauthorize callback. Throws SignedRequestError when the request cannot be verified (the route turns that into 400/503). */
  async deauthorize(signedRequest: unknown, meta: RequestMeta = {}): Promise<{ accountsUpdated: number }> {
    const payload = parseSignedRequest(signedRequest, config.metaAppSecret);
    const ref = metaSubjectRef(payload.user_id);
    const accounts = await prisma.socialAccount.findMany({ where: { metaUserId: payload.user_id, status: { not: "DISCONNECTED" } }, select: { id: true, organizationId: true, provider: true, externalAccountId: true } });
    for (const a of accounts) {
      await prisma.$transaction([
        prisma.socialAccountCredential.deleteMany({ where: { socialAccountId: a.id } }),
        prisma.socialAccount.update({ where: { id: a.id }, data: { status: "NEEDS_REAUTH", tokenExpiresAt: null, lastError: "Facebook reported that the person who connected this account removed the app. Reconnect it to restore access." } }),
      ]);
      await auditLogRepository.record({
        organizationId: a.organizationId, actorType: "SYSTEM", action: "META_DEAUTHORIZED", resourceType: "social_account", resourceId: a.id,
        metadata: { provider: a.provider, externalAccountId: a.externalAccountId, subjectRef: ref, source: "meta_deauthorize_callback" }, ipAddress: meta.ip, userAgent: meta.userAgent,
      });
    }
    await prisma.metaDataRequest.create({ data: { code: newCode(), kind: "DEAUTHORIZE", subjectRef: ref, status: "PROCESSED", matched: { accounts: accounts.length } } });
    if (accounts.length === 0) {
      await auditLogRepository.record({ actorType: "SYSTEM", action: "META_DEAUTHORIZE_RECEIVED", resourceType: "meta_callback", resourceId: ref, metadata: { accounts: 0 }, ipAddress: meta.ip, userAgent: meta.userAgent });
    }
    return { accountsUpdated: accounts.length };
  },

  /** Data-deletion callback. Returns exactly what Meta expects: `{ url, confirmation_code }`. */
  async requestDeletion(signedRequest: unknown, meta: RequestMeta = {}): Promise<{ url: string; confirmation_code: string }> {
    const payload = parseSignedRequest(signedRequest, config.metaAppSecret);
    const ref = metaSubjectRef(payload.user_id);

    // Meta may retry: the same person with an open request gets the same code back (no duplicate approvals).
    const open = await prisma.metaDataRequest.findFirst({ where: { subjectRef: ref, kind: "DELETION", status: "IN_REVIEW" }, orderBy: { createdAt: "desc" } });
    if (open) return { url: statusUrl(open.code), confirmation_code: open.code };

    const [accounts, conversations] = await Promise.all([
      prisma.socialAccount.findMany({ where: { metaUserId: payload.user_id }, select: { id: true, organizationId: true } }),
      prisma.socialConversation.findMany({ where: { participantExternalId: payload.user_id }, select: { id: true, organizationId: true } }),
    ]);
    const orgs = new Map<string, MetaTargets>();
    for (const a of accounts) (orgs.get(a.organizationId) ?? orgs.set(a.organizationId, { accounts: [], conversations: [] }).get(a.organizationId)!).accounts.push(a.id);
    for (const c of conversations) (orgs.get(c.organizationId) ?? orgs.set(c.organizationId, { accounts: [], conversations: [] }).get(c.organizationId)!).conversations.push(c.id);

    const code = newCode();
    if (orgs.size === 0) {
      await prisma.metaDataRequest.create({ data: { code, kind: "DELETION", subjectRef: ref, status: "NOTHING_HELD", matched: { accounts: 0, conversations: 0 } } });
      await auditLogRepository.record({ actorType: "SYSTEM", action: "META_DELETION_RECEIVED", resourceType: "meta_callback", resourceId: ref, metadata: { code, outcome: "nothing_held" }, ipAddress: meta.ip, userAgent: meta.userAgent });
      return { url: statusUrl(code), confirmation_code: code };
    }

    const matched: Array<{ organizationId: string; privacyRequestId: string; accounts: number; conversations: number }> = [];
    for (const [orgId, targets] of orgs) {
      const req = await prisma.privacyRequest.create({
        data: {
          organizationId: orgId, kind: META_DELETION_KIND, status: "PENDING_APPROVAL", subjectRef: ref, requestedById: META_REQUESTER,
          reason: `Meta data deletion callback ${code}`, targetIds: targets as unknown as Prisma.InputJsonValue,
          previewCounts: { socialAccounts: targets.accounts.length, socialConversations: targets.conversations.length },
        },
      });
      await createPrivacyApproval(orgId, req.id, null, `Meta data deletion request ${code} (subject ${ref})`, ref);
      await auditLogRepository.record({
        organizationId: orgId, actorType: "SYSTEM", action: "META_DELETION_RECEIVED", resourceType: "privacy_request", resourceId: req.id,
        afterData: { subjectRef: ref, code, accounts: targets.accounts.length, conversations: targets.conversations.length }, ipAddress: meta.ip, userAgent: meta.userAgent,
      });
      for (const userId of await approvers(orgId)) {
        await notificationService.notify({ organizationId: orgId, userId, type: "approval_requested", title: "Meta data deletion request", message: `Facebook sent a data deletion request (${code}). Review it in Approvals; nothing is deleted until you approve.`, entityType: "privacy_request", entityId: req.id });
      }
      matched.push({ organizationId: orgId, privacyRequestId: req.id, accounts: targets.accounts.length, conversations: targets.conversations.length });
    }
    await prisma.metaDataRequest.create({ data: { code, kind: "DELETION", subjectRef: ref, status: "IN_REVIEW", organizationId: matched[0]!.organizationId, privacyRequestId: matched[0]!.privacyRequestId, matched: matched as unknown as Prisma.InputJsonValue } });
    return { url: statusUrl(code), confirmation_code: code };
  },

  /** Public status for the confirmation code. Reveals nothing about the person, only the state of the request. */
  async deletionStatus(code: string): Promise<{ code: string; status: "IN_REVIEW" | "COMPLETED" | "DECLINED" | "NOTHING_HELD"; receivedAt: string; updatedAt: string; message: string } | null> {
    if (!/^MDR-[A-Za-z0-9_-]{16}$/.test(code)) return null;
    const row = await prisma.metaDataRequest.findUnique({ where: { code } });
    if (!row || row.kind !== "DELETION") return null;
    let status = row.status as "IN_REVIEW" | "COMPLETED" | "DECLINED" | "NOTHING_HELD";
    if (row.status === "IN_REVIEW") {
      const ids = ((row.matched as Array<{ privacyRequestId: string }> | null) ?? []).map((m) => m.privacyRequestId);
      const reqs = ids.length ? await prisma.privacyRequest.findMany({ where: { id: { in: ids } }, select: { status: true, decidedAt: true } }) : [];
      if (reqs.length && reqs.every((r) => r.status === "EXECUTED")) status = "COMPLETED";
      else if (reqs.some((r) => r.status === "REJECTED")) status = "DECLINED";
      if (status !== row.status) await prisma.metaDataRequest.update({ where: { id: row.id }, data: { status } });
    }
    const message = {
      IN_REVIEW: "We received the request and a person on our team is reviewing it. Nothing has been deleted yet.",
      COMPLETED: "The data we held that is linked to this request has been deleted or anonymised.",
      DECLINED: "The request was reviewed and could not be completed automatically. Please use the contact on the Data Deletion page and quote this code.",
      NOTHING_HELD: "We did not find any data linked to this request, so there was nothing to delete.",
    }[status];
    return { code, status, receivedAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), message };
  },

  /** Executes the data part of an approved Meta deletion request. Called only by privacyApprovalService. Idempotent. */
  async execute(orgId: string, requestId: string): Promise<Record<string, number>> {
    const r = await prisma.privacyRequest.findFirst({ where: { id: requestId, organizationId: orgId, kind: META_DELETION_KIND } });
    if (!r) throw new Error("Meta deletion request not found.");
    const t = (r.targetIds as unknown as MetaTargets | null) ?? { accounts: [], conversations: [] };
    return prisma.$transaction(async (tx) => {
      const creds = await tx.socialAccountCredential.deleteMany({ where: { socialAccountId: { in: t.accounts }, account: { organizationId: orgId } } });
      const accounts = await tx.socialAccount.updateMany({ where: { id: { in: t.accounts }, organizationId: orgId }, data: { status: "DISCONNECTED", tokenExpiresAt: null, lastError: null, metaUserId: null, connectedByUserId: null } });
      const msgs = await tx.socialMessage.deleteMany({ where: { conversationId: { in: t.conversations }, organizationId: orgId } });
      const convs = await tx.socialConversation.updateMany({ where: { id: { in: t.conversations }, organizationId: orgId }, data: { participantName: null, participantHandle: null, participantExternalId: null } });
      return { credentialsDeleted: creds.count, socialAccounts: accounts.count, socialMessages: msgs.count, socialConversations: convs.count };
    });
  },
};
