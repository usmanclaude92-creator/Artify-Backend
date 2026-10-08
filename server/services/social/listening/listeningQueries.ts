/** Read side of Listening and Reviews. Everything is scoped to the caller's workspace; items are the inbox's own MENTION / REVIEW conversations. */
import type { Prisma, SocialConversationStatus } from "@prisma/client";
import { prisma } from "../../../db/prisma";
import { NotFoundError } from "../../../core/errors";
import { connectorRegistry } from "../connectors/registry";
import { CRISIS_TAG } from "./listeningPolicy";
import type { SanitizedUser } from "../../../types/domain";

export interface ListeningQuery { status?: SocialConversationStatus; sentiment?: string; topic?: string; assignee?: string; crisis?: boolean; accountId?: string; search?: string; page: number; limit: number }

const INCLUDE = {
  account: { select: { id: true, provider: true, displayName: true, handle: true } },
  triages: { orderBy: { createdAt: "desc" as const }, take: 1, select: { suggestedCategory: true, intent: true, confidence: true, source: true } },
  messages: { where: { authorKind: "CUSTOMER" as const }, orderBy: { createdAt: "desc" as const }, take: 1, select: { body: true, mediaRefs: true } },
} satisfies Prisma.SocialConversationInclude;
type Row = Prisma.SocialConversationGetPayload<{ include: typeof INCLUDE }>;

function project(c: Row) {
  const last = c.messages[0];
  const ref = last?.mediaRefs as { permalink?: string } | null;
  const connector = connectorRegistry.get(c.account.provider);
  const cap = connector?.replyCapability?.({ type: c.type, providerThreadId: c.providerThreadId }) ?? { mode: "platform" as const };
  return {
    id: c.id, type: c.type, status: c.status, priority: c.priority, sentiment: c.sentiment, intent: c.intent, topic: c.triages[0]?.suggestedCategory ?? null,
    crisis: c.tags.includes(CRISIS_TAG), needsHuman: c.needsHuman, tags: c.tags, isRead: c.isRead, assigneeId: c.assigneeId, leadId: c.leadId, contactId: c.contactId,
    participant: { handle: c.participantHandle, name: c.participantName }, account: c.account, subjectRef: c.subjectRef,
    preview: last?.body.slice(0, 200) ?? null, permalink: ref?.permalink ?? null, replyMode: cap.mode, lastMessageAt: c.lastMessageAt, triaged: c.triages.length > 0,
  };
}

function where(caller: SanitizedUser, type: "MENTION" | "REVIEW", q: ListeningQuery): Prisma.SocialConversationWhereInput {
  return {
    organizationId: caller.organizationId, type,
    ...(q.status ? { status: q.status } : {}), ...(q.sentiment ? { sentiment: q.sentiment } : {}), ...(q.accountId ? { socialAccountId: q.accountId } : {}),
    ...(q.crisis ? { tags: { has: CRISIS_TAG } } : {}),
    ...(q.topic ? { triages: { some: { suggestedCategory: { equals: q.topic, mode: "insensitive" } } } } : {}),
    ...(q.assignee === "me" ? { assigneeId: caller.id } : q.assignee === "unassigned" ? { assigneeId: null } : q.assignee ? { assigneeId: q.assignee } : {}),
    ...(q.search ? { OR: [{ participantName: { contains: q.search, mode: "insensitive" } }, { participantHandle: { contains: q.search, mode: "insensitive" } }, { messages: { some: { body: { contains: q.search, mode: "insensitive" } } } }] } : {}),
  };
}

async function listItems(caller: SanitizedUser, type: "MENTION" | "REVIEW", q: ListeningQuery) {
  const w = where(caller, type, q);
  const [rows, total] = await Promise.all([
    prisma.socialConversation.findMany({ where: w, include: INCLUDE, orderBy: [{ isRead: "asc" }, { lastMessageAt: "desc" }], skip: (q.page - 1) * q.limit, take: q.limit }),
    prisma.socialConversation.count({ where: w }),
  ]);
  return { items: rows.map(project), total, page: q.page, limit: q.limit };
}

/** Why a network has (or has no) review feed. Static facts from docs/SOCIAL_LISTENING.md §1.3/§1.4; never a guess about the account. */
const REVIEW_SOURCES: Record<string, { available: boolean; reason: string }> = {
  meta_facebook: { available: false, reason: "Facebook no longer provides Page reviews or recommendations to apps (removed from the Graph API in v22.0). Read and answer them on Facebook." },
  meta_instagram: { available: false, reason: "Instagram has no reviews." },
  linkedin: { available: false, reason: "LinkedIn offers no reviews API for member accounts." },
  mock: { available: true, reason: "Demo provider." },
};
export const GOOGLE_REVIEWS_REASON = "Google Business Profile reviews need Google's API access approval (a verified profile active for 60+ days, then a request reviewed in about 14 days). Not connected. See docs/SOCIAL_LISTENING.md.";

export const listeningQueries = {
  list: (caller: SanitizedUser, q: ListeningQuery) => listItems(caller, "MENTION", q),
  reviews: (caller: SanitizedUser, q: ListeningQuery) => listItems(caller, "REVIEW", q),

  async topics(caller: SanitizedUser) {
    const rows = await prisma.socialTriage.groupBy({ by: ["suggestedCategory"], where: { organizationId: caller.organizationId, conversation: { type: "MENTION" }, suggestedCategory: { not: null } }, _count: { _all: true }, orderBy: { _count: { suggestedCategory: "desc" } }, take: 30 });
    return rows.map((r) => ({ topic: r.suggestedCategory as string, count: r._count._all }));
  },

  async summary(caller: SanitizedUser) {
    const org = caller.organizationId;
    const open = { in: ["OPEN", "PENDING"] as SocialConversationStatus[] };
    const since = new Date(Date.now() - 7 * 86400_000);
    const [mentionsOpen, negativeOpen, crisisOpen, unassigned, last7d, reviewsOpen] = await Promise.all([
      prisma.socialConversation.count({ where: { organizationId: org, type: "MENTION", status: open } }),
      prisma.socialConversation.count({ where: { organizationId: org, type: { in: ["MENTION", "REVIEW"] }, status: open, sentiment: "negative" } }),
      prisma.socialConversation.count({ where: { organizationId: org, type: { in: ["MENTION", "REVIEW"] }, status: open, tags: { has: CRISIS_TAG } } }),
      prisma.socialConversation.count({ where: { organizationId: org, type: "MENTION", status: "OPEN", assigneeId: null } }),
      prisma.socialConversation.count({ where: { organizationId: org, type: "MENTION", createdAt: { gte: since } } }),
      prisma.socialConversation.count({ where: { organizationId: org, type: "REVIEW", status: open } }),
    ]);
    return { mentionsOpen, negativeOpen, crisisOpen, unassigned, mentionsLast7d: last7d, reviewsOpen };
  },

  /** Review sources per connected account + the rating snapshots (null = the network gave no value; never 0). */
  async reviewOverview(caller: SanitizedUser, days: number) {
    const org = caller.organizationId;
    const since = new Date(Date.now() - days * 86400_000);
    const accounts = await prisma.socialAccount.findMany({ where: { organizationId: org, status: { not: "DISCONNECTED" } }, select: { id: true, provider: true, displayName: true, handle: true }, orderBy: { displayName: "asc" }, take: 50 });
    const snaps = await prisma.socialReviewSnapshot.findMany({ where: { organizationId: org, capturedOn: { gte: since } }, orderBy: { capturedOn: "asc" }, take: 5000 });
    const byAccount = new Map<string, typeof snaps>();
    for (const s of snaps) byAccount.set(s.socialAccountId, [...(byAccount.get(s.socialAccountId) ?? []), s]);
    return {
      days,
      accounts: accounts.map((a) => {
        const src = REVIEW_SOURCES[a.provider] ?? { available: false, reason: "No review source for this network." };
        const rows = byAccount.get(a.id) ?? [];
        const latest = rows.length ? rows[rows.length - 1]! : null;
        return {
          ...a, reviewsAvailable: src.available, reviewsReason: src.reason,
          series: rows.map((r) => ({ date: r.capturedOn.toISOString().slice(0, 10), averageRating: r.averageRating, reviewCount: r.reviewCount, status: r.status, note: r.note })),
          latest: latest ? { date: latest.capturedOn.toISOString().slice(0, 10), averageRating: latest.averageRating, reviewCount: latest.reviewCount, status: latest.status, note: latest.note } : null,
        };
      }),
      google: { connected: false, reason: GOOGLE_REVIEWS_REASON },
    };
  },

  /** 404 unless the conversation is a REVIEW of this workspace (the reviews endpoints only touch reviews). */
  async assertReview(caller: SanitizedUser, id: string) {
    const c = await prisma.socialConversation.findFirst({ where: { id, organizationId: caller.organizationId, type: "REVIEW" }, select: { id: true } });
    if (!c) throw new NotFoundError("Review not found.");
  },
};
