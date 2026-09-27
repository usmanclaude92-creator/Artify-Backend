/**
 * Promotes SCHEDULED Posts/Pages to PUBLISHED once their `scheduledAt`
 * has passed (docs/CONTENT_WORKFLOW_ARCHITECTURE.md). Nothing wrote this
 * transition before this file existed — `schedulePost`/`schedulePage`
 * only ever set `status: "SCHEDULED"` and `scheduledAt`, and no worker
 * ever read them back. Driven by the same Vercel Cron trigger as the
 * automation engine (GET /api/v1/automation/internal/tick — see
 * automationRoutes.ts), since it already solves "run something every
 * minute on a serverless deployment" and there is no reason to invent a
 * second cron mechanism for this.
 *
 * System-initiated, not organization-scoped or caller-scoped — like
 * SchedulerEngine.tick(), this legitimately looks across every
 * organization's due content in one pass.
 */
import { prisma } from "../db/prisma";
import { postRepository } from "../repositories/postRepository";
import { pageRepository } from "../repositories/pageRepository";
import { auditLogRepository } from "../repositories/auditLogRepository";
import { logger } from "../core/logger";

function hasPublishableContent(revision: { title: string; body: string } | null): boolean {
  return !!revision && !!revision.title.trim() && !!revision.body.trim();
}

export const contentSchedulingService = {
  async publishDueScheduled(): Promise<{ postsPublished: number; pagesPublished: number; skipped: number }> {
    const now = new Date();
    const [duePosts, duePages] = await Promise.all([postRepository.findDueScheduled(now), pageRepository.findDueScheduled(now)]);

    let postsPublished = 0;
    let pagesPublished = 0;
    let skipped = 0;

    for (const post of duePosts) {
      if (!post.currentRevisionId || !hasPublishableContent(post.currentRevision)) {
        // Content was scheduled with a body/title, then edited down to
        // empty before the scheduled time arrived — skip rather than
        // publish empty content; it stays SCHEDULED (and visibly overdue)
        // for a human to fix, next tick tries again.
        skipped++;
        logger.warn({ postId: post.id }, "[contentSchedulingService] Skipped due scheduled post with no publishable content");
        continue;
      }
      try {
        await prisma.$transaction([
          prisma.contentRevision.update({ where: { id: post.currentRevisionId }, data: { status: "PUBLISHED", publishedAt: now } }),
          prisma.post.update({ where: { id: post.id }, data: { status: "PUBLISHED", publishedAt: now, scheduledAt: null } }),
        ]);
        await auditLogRepository.record({
          organizationId: post.organizationId,
          actorType: "SYSTEM",
          actorName: "content-scheduler",
          action: "POST_PUBLISHED",
          resourceType: "post",
          resourceId: post.id,
          beforeData: { status: "SCHEDULED", scheduledAt: post.scheduledAt },
          afterData: { status: "PUBLISHED" },
        });
        postsPublished++;
      } catch (err) {
        logger.error({ err, postId: post.id }, "[contentSchedulingService] Failed to publish due scheduled post");
      }
    }

    for (const page of duePages) {
      if (!page.currentRevisionId || !hasPublishableContent(page.currentRevision)) {
        skipped++;
        logger.warn({ pageId: page.id }, "[contentSchedulingService] Skipped due scheduled page with no publishable content");
        continue;
      }
      try {
        await prisma.$transaction([
          prisma.contentRevision.update({ where: { id: page.currentRevisionId }, data: { status: "PUBLISHED", publishedAt: now } }),
          prisma.page.update({ where: { id: page.id }, data: { status: "PUBLISHED", publishedAt: now, scheduledAt: null } }),
        ]);
        await auditLogRepository.record({
          organizationId: page.organizationId,
          actorType: "SYSTEM",
          actorName: "content-scheduler",
          action: "PAGE_PUBLISHED",
          resourceType: "page",
          resourceId: page.id,
          beforeData: { status: "SCHEDULED", scheduledAt: page.scheduledAt },
          afterData: { status: "PUBLISHED" },
        });
        pagesPublished++;
      } catch (err) {
        logger.error({ err, pageId: page.id }, "[contentSchedulingService] Failed to publish due scheduled page");
      }
    }

    return { postsPublished, pagesPublished, skipped };
  },
};
