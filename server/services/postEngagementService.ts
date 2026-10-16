/**
 * Real reader engagement on public blog posts. Nothing is ever seeded: counts are what readers actually did. Likes and ratings are one per
 * browser (a salted hash of a random per-browser id); comments are held PENDING until a Control Center user approves them.
 */
import { createHash } from "node:crypto";
import { prisma } from "../db/prisma";
import { config } from "../config/env";
import { NotFoundError, ValidationError } from "../core/errors";
import { logger } from "../core/logger";
import { userRepository } from "../repositories/userRepository";
import { notificationService } from "./notificationService";
import type { SanitizedUser } from "../types/domain";

export interface PostEngagement {
  likes: number;
  rating: { average: number; count: number };
  commentCount: number;
}

const EMPTY: PostEngagement = { likes: 0, rating: { average: 0, count: 0 }, commentCount: 0 };

function hash(scope: string, value: string): string {
  return createHash("sha256").update(`${scope}:${config.publicWebsiteOrganizationId}:${value}`).digest("hex");
}

/** Plain text only: tags are stripped and whitespace collapsed, so a comment can never carry markup into the public page. */
export function cleanCommentText(value: string): string {
  return value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

async function findPublishedPost(slug: string) {
  const post = await prisma.post.findFirst({
    where: { organizationId: config.publicWebsiteOrganizationId, slug, status: "PUBLISHED", deletedAt: null },
    select: { id: true, organizationId: true, title: true },
  });
  if (!post) throw new NotFoundError("Post not found.");
  return post;
}

const COMMENT_NOTIFICATION_TYPE = "post_comment_pending";
const COMMENT_NOTIFICATION_GROUP_MS = 24 * 60 * 60 * 1000;

/**
 * Tells every active Administrator and Super Administrator (bell icon) that a visitor comment is waiting for review. Unread notifications
 * of this type from the last 24 hours are grouped into one ("N comments are waiting for review", N = the real pending count) so a burst of
 * comments cannot flood the bell. Never throws: the comment is already saved, and a notification failure must not fail the visitor's request.
 */
async function notifyReviewers(organizationId: string, post: { title: string }, commenter: string, commentId: string): Promise<void> {
  try {
    const [recipients, pending] = await Promise.all([
      userRepository.listActiveByRoleKeysInOrg(organizationId, ["ADMIN", "SUPER_ADMIN"]),
      prisma.postComment.count({ where: { organizationId, status: "PENDING" } }),
    ]);
    const since = new Date(Date.now() - COMMENT_NOTIFICATION_GROUP_MS);
    const where = "Open Website → Content → Blog Comments to approve or reject.";
    for (const user of recipients) {
      const recent = await prisma.notification.findFirst({
        where: { organizationId, userId: user.id, type: COMMENT_NOTIFICATION_TYPE, status: "UNREAD", createdAt: { gte: since } },
        orderBy: { createdAt: "desc" },
      });
      if (recent) {
        await prisma.notification.update({
          where: { id: recent.id },
          data:
            pending > 1
              ? { title: "Blog comments awaiting review", message: `${pending} comments are waiting for review. ${where}`, createdAt: new Date() }
              : { title: "New blog comment awaiting review", message: `${commenter} commented on "${post.title}". ${where}`, createdAt: new Date() },
        });
      } else {
        await notificationService.notify({
          organizationId, userId: user.id, type: COMMENT_NOTIFICATION_TYPE,
          title: "New blog comment awaiting review",
          message: `${commenter} commented on "${post.title}". ${where}`,
          entityType: "post_comment", entityId: commentId,
        });
      }
    }
  } catch (err) {
    logger.warn({ err }, "[post-comments] reviewer notification skipped");
  }
}

export const postEngagementService = {
  /** Counts for many posts in three grouped queries; a failure reads as "no engagement", never as a broken post API. */
  async statsFor(postIds: string[]): Promise<Map<string, PostEngagement>> {
    const out = new Map<string, PostEngagement>();
    if (postIds.length === 0) return out;
    const get = (id: string) => {
      let v = out.get(id);
      if (!v) { v = { likes: 0, rating: { average: 0, count: 0 }, commentCount: 0 }; out.set(id, v); }
      return v;
    };
    const [likes, ratings, comments] = await Promise.all([
      prisma.postLike.groupBy({ by: ["postId"], where: { postId: { in: postIds } }, _count: { _all: true } }),
      prisma.postRating.groupBy({ by: ["postId"], where: { postId: { in: postIds } }, _count: { _all: true }, _avg: { score: true } }),
      prisma.postComment.groupBy({ by: ["postId"], where: { postId: { in: postIds }, status: "APPROVED" }, _count: { _all: true } }),
    ]);
    for (const r of likes) get(r.postId).likes = r._count._all;
    for (const r of ratings) get(r.postId).rating = { average: Math.round((r._avg.score ?? 0) * 10) / 10, count: r._count._all };
    for (const r of comments) get(r.postId).commentCount = r._count._all;
    return out;
  },

  empty(): PostEngagement {
    return { ...EMPTY, rating: { ...EMPTY.rating } };
  },

  /** Approved comments only, oldest first (a thread reads top to bottom). */
  async approvedComments(postId: string) {
    const rows = await prisma.postComment.findMany({
      where: { postId, status: "APPROVED" },
      orderBy: { createdAt: "asc" },
      take: 100,
      select: { id: true, authorName: true, authorRole: true, body: true, createdAt: true },
    });
    return rows.map((r) => ({ id: r.id, authorName: r.authorName, authorRole: r.authorRole, body: r.body, createdAt: r.createdAt }));
  },

  async setLike(slug: string, clientId: string, liked: boolean): Promise<{ likes: number; liked: boolean }> {
    const post = await findPublishedPost(slug);
    const clientKey = hash("like", clientId);
    if (liked) {
      await prisma.postLike.upsert({
        where: { postId_clientKey: { postId: post.id, clientKey } },
        create: { organizationId: post.organizationId, postId: post.id, clientKey },
        update: {},
      });
    } else {
      await prisma.postLike.deleteMany({ where: { postId: post.id, clientKey } });
    }
    return { likes: await prisma.postLike.count({ where: { postId: post.id } }), liked };
  },

  async setRating(slug: string, clientId: string, score: number): Promise<{ rating: { average: number; count: number }; score: number }> {
    const post = await findPublishedPost(slug);
    const clientKey = hash("rating", clientId);
    await prisma.postRating.upsert({
      where: { postId_clientKey: { postId: post.id, clientKey } },
      create: { organizationId: post.organizationId, postId: post.id, clientKey, score },
      update: { score },
    });
    const agg = await prisma.postRating.aggregate({ where: { postId: post.id }, _count: { _all: true }, _avg: { score: true } });
    return { rating: { average: Math.round((agg._avg.score ?? 0) * 10) / 10, count: agg._count._all }, score };
  },

  /** Stores a PENDING comment. A filled honeypot is accepted silently (the bot learns nothing) but nothing is saved. */
  async addComment(slug: string, input: { name: string; role?: string; body: string; website?: string }, ip: string | undefined): Promise<{ status: "pending" }> {
    const post = await findPublishedPost(slug);
    if (input.website && input.website.trim() !== "") return { status: "pending" };
    const body = cleanCommentText(input.body);
    const authorName = cleanCommentText(input.name);
    if (body.length < 5 || authorName.length < 2) throw new ValidationError("Please enter your name and a comment.");
    if (/https?:\/\/|www\./i.test(body)) throw new ValidationError("Links are not allowed in comments.");
    const ipHash = ip ? hash("ip", ip) : null;
    const duplicate = await prisma.postComment.findFirst({ where: { postId: post.id, body, authorName }, select: { id: true } });
    if (!duplicate) {
      const created = await prisma.postComment.create({
        data: { organizationId: post.organizationId, postId: post.id, authorName, authorRole: input.role ? cleanCommentText(input.role) || null : null, body, status: "PENDING", ipHash },
        select: { id: true },
      });
      await notifyReviewers(post.organizationId, post, authorName, created.id);
    }
    return { status: "pending" };
  },

  // ---- Control Center moderation (organization-scoped) ----
  async listForModeration(caller: SanitizedUser, status: "PENDING" | "APPROVED" | "REJECTED", page: number, limit: number) {
    const where = { organizationId: caller.organizationId, status };
    const [rows, total] = await Promise.all([
      prisma.postComment.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        include: { post: { select: { slug: true, title: true } } },
      }),
      prisma.postComment.count({ where }),
    ]);
    return {
      rows: rows.map((r) => ({
        id: r.id, authorName: r.authorName, authorRole: r.authorRole, body: r.body, status: r.status,
        createdAt: r.createdAt, moderatedAt: r.moderatedAt, post: r.post,
      })),
      total,
    };
  },

  async pendingCount(caller: SanitizedUser): Promise<number> {
    return prisma.postComment.count({ where: { organizationId: caller.organizationId, status: "PENDING" } });
  },

  async moderate(caller: SanitizedUser, id: string, status: "APPROVED" | "REJECTED") {
    const found = await prisma.postComment.findFirst({ where: { id, organizationId: caller.organizationId }, select: { id: true } });
    if (!found) throw new NotFoundError("Comment not found.");
    await prisma.postComment.update({ where: { id }, data: { status, moderatedAt: new Date(), moderatedById: caller.id } });
    return { id, status };
  },
};
