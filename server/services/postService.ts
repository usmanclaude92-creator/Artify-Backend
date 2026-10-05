/**
 * Post management (Phase 8 — docs/CMS_ARCHITECTURE.md,
 * docs/CONTENT_WORKFLOW_ARCHITECTURE.md). Organization-scoped. Revision,
 * workflow, and optimistic-concurrency handling mirror pageService.ts
 * exactly (see its header comment); this file additionally validates and
 * applies category/tag assignment.
 */
import { postRepository, type PostWithRelations } from "../repositories/postRepository";
import { categoryRepository } from "../repositories/categoryRepository";
import { tagRepository } from "../repositories/tagRepository";
import { auditLogRepository } from "../repositories/auditLogRepository";
import { assertFeaturedMediaUsable } from "./mediaService";
import { sanitizeContentHtml } from "../utils/sanitizeHtml";
import { redirectService } from "./redirectService";
import { notificationService } from "./notificationService";
import { eventEngine } from "./automation/EventEngine";
import { prisma } from "../db/prisma";
import { ConflictError, NotFoundError, ValidationError } from "../core/errors";
import type { SanitizedUser } from "../types/domain";
import type { CreatePostInput, UpdatePostInput, ListPostsQuery } from "../schemas/postSchemas";
import type { ScheduleContentInput, RevertContentInput } from "../schemas/contentSchemas";
import type { RequestMeta } from "./authService";
import type { Prisma } from "@prisma/client";

/**
 * ARCHIVED content is fully read-only until restored (PATCH status:"DRAFT")
 * — restoring and editing in the same request is fine (the target status
 * is DRAFT, not ARCHIVED, so the block below never fires for it). PUBLISHED
 * is deliberately NOT in this set: a live edit of already-published content
 * is content.update's job (see the `liveEditOfPublished` branch below),
 * distinct from content.publish's job of taking new content live for the
 * first time. This closes the earlier bug where the only way to fix a typo
 * on a published post was to unpublish it (PATCH status:"DRAFT"), taking it
 * offline until republished.
 */
const CONTENT_EDIT_BLOCKED_STATUSES = new Set(["ARCHIVED"]);

function isUniqueConstraintError(err: unknown): boolean {
  return !!err && typeof err === "object" && "code" in err && (err as { code?: string }).code === "P2002";
}

function assertHasPublishableContent(revision: { title: string; body: string } | null): void {
  if (!revision || !revision.title.trim() || !revision.body.trim()) {
    throw new ValidationError("This post needs a title and body before it can be published or scheduled.");
  }
}

async function loadPostOrThrow(id: string, organizationId: string): Promise<PostWithRelations> {
  const post = await postRepository.findByIdInOrg(id, organizationId);
  if (!post) throw new NotFoundError("Post not found.");
  return post;
}

async function assertCategoryInOrg(categoryId: string | null | undefined, organizationId: string): Promise<void> {
  if (!categoryId) return;
  const category = await categoryRepository.findByIdInOrg(categoryId, organizationId);
  if (!category) throw new ValidationError("categoryId does not refer to a category in this organization.");
}

async function assertTagsInOrg(tagIds: string[] | undefined, organizationId: string): Promise<void> {
  if (!tagIds || tagIds.length === 0) return;
  const found = await tagRepository.findByIdsInOrg(tagIds, organizationId);
  if (found.length !== new Set(tagIds).size) {
    throw new ValidationError("One or more tagIds do not refer to a tag in this organization.");
  }
}

export const postService = {
  async listPosts(
    organizationId: string,
    filters: Pick<ListPostsQuery, "search" | "status" | "categoryId" | "tagId" | "fromDate" | "toDate">,
    page: number,
    limit: number,
    sort: string,
    order: "asc" | "desc"
  ) {
    return postRepository.list(organizationId, filters, page, limit, sort, order);
  },

  async getPost(organizationId: string, id: string): Promise<PostWithRelations> {
    return loadPostOrThrow(id, organizationId);
  },

  async listRevisions(organizationId: string, id: string) {
    await loadPostOrThrow(id, organizationId);
    return postRepository.listRevisions(id);
  },

  async createPost(caller: SanitizedUser, input: CreatePostInput, meta: RequestMeta = {}): Promise<PostWithRelations> {
    const organizationId = caller.organizationId;
    const body = sanitizeContentHtml(input.body);

    await assertCategoryInOrg(input.categoryId, organizationId);
    await assertTagsInOrg(input.tagIds, organizationId);
    if (input.featuredMediaId) await assertFeaturedMediaUsable(input.featuredMediaId, organizationId);

    if (input.slug) {
      const dup = await postRepository.findBySlugInOrg(organizationId, input.slug);
      if (dup) throw new ConflictError(`A post with slug "${input.slug}" already exists.`, { existingPostId: dup.id });
    }
    const slug = input.slug ?? (await postRepository.findUniqueSlugInOrg(organizationId, input.title));

    let createdId: string;
    try {
      createdId = await prisma.$transaction(async (tx) => {
        const post = await tx.post.create({
          data: {
            organizationId,
            slug,
            title: input.title,
            status: "DRAFT",
            categoryId: input.categoryId,
            authorId: input.authorId,
            featuredMediaId: input.featuredMediaId,
            createdById: caller.id,
          },
        });
        const revision = await tx.contentRevision.create({
          data: {
            postId: post.id,
            version: 1,
            status: "DRAFT",
            title: input.title,
            excerpt: input.excerpt,
            body,
            metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
            createdById: caller.id,
          },
        });
        await tx.post.update({ where: { id: post.id }, data: { currentRevisionId: revision.id } });
        if (input.tagIds && input.tagIds.length > 0) {
          await tx.postTag.createMany({ data: input.tagIds.map((tagId) => ({ postId: post.id, tagId })) });
        }
        return post.id;
      });
    } catch (err) {
      throw isUniqueConstraintError(err) ? new ConflictError("A post with this slug already exists.") : err;
    }

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "POST_CREATED",
      resourceType: "post",
      resourceId: createdId,
      afterData: { title: input.title, slug },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return loadPostOrThrow(createdId, organizationId);
  },

  async updatePost(caller: SanitizedUser, id: string, input: UpdatePostInput, meta: RequestMeta = {}): Promise<PostWithRelations> {
    const organizationId = caller.organizationId;
    const existing = await loadPostOrThrow(id, organizationId);
    const sanitizedBody = input.body !== undefined ? sanitizeContentHtml(input.body) : undefined;

    const hasContentEdit =
      input.title !== undefined || input.body !== undefined || input.excerpt !== undefined || input.metadata !== undefined || input.slug !== undefined;
    // Blocked only when the post STAYS archived — target status is always
    // existing.status unless input.status ("DRAFT" only, restoring it) is
    // supplied, so this never blocks a combined restore+edit.
    if (hasContentEdit && input.status === undefined && CONTENT_EDIT_BLOCKED_STATUSES.has(existing.status)) {
      throw new ConflictError(`Post content cannot be edited while status is ${existing.status}. Restore it to draft first.`);
    }

    if (input.slug !== undefined && input.slug !== existing.slug) {
      const dup = await postRepository.findBySlugInOrg(organizationId, input.slug);
      if (dup && dup.id !== id) throw new ConflictError(`A post with slug "${input.slug}" already exists.`, { existingPostId: dup.id });
    }
    if (input.categoryId !== undefined) await assertCategoryInOrg(input.categoryId, organizationId);
    if (input.tagIds !== undefined) await assertTagsInOrg(input.tagIds, organizationId);

    // See pageService.updatePage — the featured image lives on the Post
    // row and can change independently of content edits, except on
    // ARCHIVED content.
    const hasFeaturedMediaEdit = input.featuredMediaId !== undefined;
    if (hasFeaturedMediaEdit) {
      if (existing.status === "ARCHIVED") throw new ConflictError("Post content cannot be edited while status is ARCHIVED.");
      if (input.featuredMediaId) await assertFeaturedMediaUsable(input.featuredMediaId, organizationId);
    }

    const unpublishing = existing.status === "PUBLISHED" && input.status === "DRAFT";
    // A live edit: the post stays PUBLISHED (no status field in the
    // request), so the new content should go live immediately as a new
    // PUBLISHED revision rather than forking into an unseen DRAFT — that
    // DRAFT-fork behavior is reserved for `unpublishing`, an explicit,
    // deliberate status change.
    const liveEditOfPublished = hasContentEdit && input.status === undefined && existing.status === "PUBLISHED";
    const currentRevision = existing.currentRevision;

    try {
      await prisma.$transaction(async (tx) => {
        const postPatch: Record<string, unknown> = {};
        if (input.status !== undefined) postPatch.status = input.status;
        if (input.slug !== undefined) postPatch.slug = input.slug;
        if (input.title !== undefined) postPatch.title = input.title;
        if (input.categoryId !== undefined) postPatch.categoryId = input.categoryId;
        if (input.authorId !== undefined) postPatch.authorId = input.authorId;
        if (hasFeaturedMediaEdit) postPatch.featuredMediaId = input.featuredMediaId;
        if (unpublishing) postPatch.publishedAt = null;

        if (currentRevision && (unpublishing || liveEditOfPublished || (hasContentEdit && currentRevision.status === "PUBLISHED"))) {
          const newRevision = await tx.contentRevision.create({
            data: {
              postId: id,
              version: currentRevision.version + 1,
              status: liveEditOfPublished ? "PUBLISHED" : "DRAFT",
              title: input.title ?? currentRevision.title,
              excerpt: input.excerpt !== undefined ? input.excerpt : currentRevision.excerpt,
              body: sanitizedBody ?? currentRevision.body,
              metadata: (input.metadata ?? currentRevision.metadata) as Prisma.InputJsonValue,
              createdById: caller.id,
              publishedAt: liveEditOfPublished ? new Date() : null,
            },
          });
          postPatch.currentRevisionId = newRevision.id;
        } else if (hasContentEdit && currentRevision) {
          const revisionPatch: Record<string, unknown> = {};
          if (input.title !== undefined) revisionPatch.title = input.title;
          if (input.excerpt !== undefined) revisionPatch.excerpt = input.excerpt;
          if (sanitizedBody !== undefined) revisionPatch.body = sanitizedBody;
          if (input.metadata !== undefined) revisionPatch.metadata = input.metadata as Prisma.InputJsonValue;
          if (Object.keys(revisionPatch).length > 0) {
            await tx.contentRevision.update({ where: { id: currentRevision.id }, data: revisionPatch });
          }
        }

        const willTouchTags = input.tagIds !== undefined;
        if (hasContentEdit && Object.keys(postPatch).length === 0 && !willTouchTags) {
          // See pageService.updatePage — keeps Post.updatedAt a reliable
          // optimistic-concurrency version even for a revision-only edit.
          postPatch.updatedAt = new Date();
        }

        if (Object.keys(postPatch).length > 0) {
          const where: Prisma.PostWhereInput = { id, ...(input.expectedUpdatedAt !== undefined ? { updatedAt: input.expectedUpdatedAt } : {}) };
          const result = await tx.post.updateMany({ where, data: postPatch });
          if (result.count === 0) {
            throw new ConflictError("This post was changed by someone else since you loaded it. Reload and try again.");
          }
        }

        if (input.tagIds !== undefined) {
          await tx.postTag.deleteMany({ where: { postId: id } });
          if (input.tagIds.length > 0) {
            await tx.postTag.createMany({ data: input.tagIds.map((tagId) => ({ postId: id, tagId })) });
          }
        }
      });
    } catch (err) {
      throw isUniqueConstraintError(err) ? new ConflictError("A post with this slug already exists.") : err;
    }

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "POST_UPDATED",
      resourceType: "post",
      resourceId: id,
      beforeData: { status: existing.status, title: existing.title },
      afterData: { status: input.status, title: input.title, slug: input.slug },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    // A slug change on a post that's (still) PUBLISHED after this update
    // means its real, indexed public URL just moved — auto-create a
    // redirect so existing links/search results don't dead-end. Gated on
    // the resulting status, not the prior one: if this same PATCH also
    // unpublishes the post, there's no live page to send visitors to, so
    // no redirect is created. Posts render at /blog/:slug on the public
    // site (artifysolscom) — Pages have no public route yet (Phase 4),
    // so this doesn't run for pageService.updatePage.
    if (input.slug !== undefined && input.slug !== existing.slug) {
      const finalStatus = input.status ?? existing.status;
      if (finalStatus === "PUBLISHED") {
        await redirectService.autoRedirectOnSlugChange({
          organizationId,
          fromPath: `/blog/${existing.slug}`,
          toPath: `/blog/${input.slug}`,
          resourceType: "post",
          resourceId: id,
        });
      }
    }

    if (hasFeaturedMediaEdit && input.featuredMediaId !== existing.featuredMediaId) {
      await auditLogRepository.record({
        organizationId,
        actorUserId: caller.id,
        actorType: "USER",
        action: input.featuredMediaId ? "MEDIA_ATTACHED_TO_CONTENT" : "MEDIA_DETACHED_FROM_CONTENT",
        resourceType: "post",
        resourceId: id,
        beforeData: { featuredMediaId: existing.featuredMediaId },
        afterData: { featuredMediaId: input.featuredMediaId ?? null },
        ipAddress: meta.ip,
        userAgent: meta.userAgent,
      });
    }

    return loadPostOrThrow(id, organizationId);
  },

  async submitForReview(caller: SanitizedUser, id: string, meta: RequestMeta = {}): Promise<PostWithRelations> {
    const organizationId = caller.organizationId;
    const existing = await loadPostOrThrow(id, organizationId);

    if (existing.status !== "DRAFT") throw new ConflictError(`Only a DRAFT post can be submitted for review (current status: ${existing.status}).`);
    if (!existing.currentRevision || !existing.currentRevision.body.trim()) {
      throw new ValidationError("This post needs body content before it can be submitted for review.");
    }

    await prisma.post.update({ where: { id }, data: { status: "IN_REVIEW" } });

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "POST_SUBMITTED_FOR_REVIEW",
      resourceType: "post",
      resourceId: id,
      beforeData: { status: existing.status },
      afterData: { status: "IN_REVIEW" },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    // Phase 16 — real automation trigger (mirrors pageService.submitForReview).
    try {
      await eventEngine.emit({
        eventType: "content.submitted_for_review",
        entityType: "post",
        entityId: id,
        organizationId,
        actorId: caller.id,
        actorType: "USER",
        sourceModule: "CMS",
        payload: { title: existing.title, slug: existing.slug },
      });
    } catch {
      // best-effort — see pageService.submitForReview's comment.
    }

    return loadPostOrThrow(id, organizationId);
  },

  async publishPost(caller: SanitizedUser, id: string, meta: RequestMeta = {}): Promise<PostWithRelations> {
    const organizationId = caller.organizationId;
    const existing = await loadPostOrThrow(id, organizationId);

    if (existing.status === "ARCHIVED") throw new ConflictError("An archived post must be restored before it can be published.");
    if (existing.status === "PUBLISHED") throw new ConflictError("This post is already published.");
    if (!existing.currentRevisionId) throw new ConflictError("This post has no content revision to publish.");
    assertHasPublishableContent(existing.currentRevision);

    const now = new Date();
    await prisma.$transaction([
      prisma.contentRevision.update({ where: { id: existing.currentRevisionId }, data: { status: "PUBLISHED", publishedAt: now } }),
      prisma.post.update({ where: { id }, data: { status: "PUBLISHED", publishedAt: now, scheduledAt: null } }),
    ]);

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "POST_PUBLISHED",
      resourceType: "post",
      resourceId: id,
      beforeData: { status: existing.status },
      afterData: { status: "PUBLISHED" },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    if (existing.createdById && existing.createdById !== caller.id) {
      await notificationService.notify({
        organizationId,
        userId: existing.createdById,
        type: "content_published",
        title: "Your post was published",
        message: `"${existing.title}" is now live.`,
      });
    }

    return loadPostOrThrow(id, organizationId);
  },

  async schedulePost(caller: SanitizedUser, id: string, input: ScheduleContentInput, meta: RequestMeta = {}): Promise<PostWithRelations> {
    const organizationId = caller.organizationId;
    const existing = await loadPostOrThrow(id, organizationId);

    if (existing.status === "ARCHIVED") throw new ConflictError("An archived post must be restored before it can be scheduled.");
    if (existing.status === "PUBLISHED") throw new ConflictError("This post is already published.");
    assertHasPublishableContent(existing.currentRevision);

    await prisma.post.update({ where: { id }, data: { status: "SCHEDULED", scheduledAt: input.scheduledAt } });

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "POST_SCHEDULED",
      resourceType: "post",
      resourceId: id,
      beforeData: { status: existing.status },
      afterData: { status: "SCHEDULED", scheduledAt: input.scheduledAt },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return loadPostOrThrow(id, organizationId);
  },

  async archivePost(caller: SanitizedUser, id: string, meta: RequestMeta = {}): Promise<PostWithRelations> {
    const organizationId = caller.organizationId;
    const existing = await loadPostOrThrow(id, organizationId);

    if (existing.status === "ARCHIVED") throw new ConflictError("This post is already archived.");

    await prisma.post.update({ where: { id }, data: { status: "ARCHIVED" } });

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "POST_ARCHIVED",
      resourceType: "post",
      resourceId: id,
      beforeData: { status: existing.status },
      afterData: { status: "ARCHIVED" },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return loadPostOrThrow(id, organizationId);
  },

  async revertPost(caller: SanitizedUser, id: string, input: RevertContentInput, meta: RequestMeta = {}): Promise<PostWithRelations> {
    const organizationId = caller.organizationId;
    const existing = await loadPostOrThrow(id, organizationId);

    if (existing.status === "ARCHIVED") throw new ConflictError("An archived post must be restored before its content can be reverted.");

    const target = await prisma.contentRevision.findFirst({ where: { id: input.revisionId, postId: id } });
    if (!target) throw new NotFoundError("Revision not found on this post.");

    const current = existing.currentRevision;
    const nextVersion = (current?.version ?? 0) + 1;
    // Reverting a live post restores the old content as the new live
    // content immediately, the same as any other edit to published content
    // (see updatePost's `liveEditOfPublished`) — it must not take the post
    // offline just because the source of the new content was history.
    const wasPublished = existing.status === "PUBLISHED";

    await prisma.$transaction(async (tx) => {
      const newRevision = await tx.contentRevision.create({
        data: {
          postId: id,
          version: nextVersion,
          status: wasPublished ? "PUBLISHED" : "DRAFT",
          title: target.title,
          excerpt: target.excerpt,
          body: target.body,
          metadata: target.metadata as Prisma.InputJsonValue,
          createdById: caller.id,
          publishedAt: wasPublished ? new Date() : null,
        },
      });
      await tx.post.update({
        where: { id },
        data: { currentRevisionId: newRevision.id },
      });
    });

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "POST_REVERTED",
      resourceType: "post",
      resourceId: id,
      beforeData: { fromVersion: current?.version, revertedToRevisionId: target.id, revertedToVersion: target.version },
      afterData: { newVersion: nextVersion },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return loadPostOrThrow(id, organizationId);
  },

  async deletePost(caller: SanitizedUser, id: string, meta: RequestMeta = {}): Promise<void> {
    const organizationId = caller.organizationId;
    const existing = await loadPostOrThrow(id, organizationId);

    await postRepository.softDelete(id);

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "POST_DELETED",
      resourceType: "post",
      resourceId: id,
      beforeData: { status: existing.status, title: existing.title },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });
  },

  /** Phase 7 — Trash view (Content Dashboard): soft-deleted posts, paginated. */
  async listTrash(organizationId: string, page: number, limit: number) {
    return postRepository.listTrash(organizationId, page, limit);
  },

  async restorePost(caller: SanitizedUser, id: string, meta: RequestMeta = {}): Promise<void> {
    const organizationId = caller.organizationId;
    const existing = await postRepository.findTrashedByIdInOrg(id, organizationId);
    if (!existing) throw new NotFoundError("Post not found in trash.");

    await postRepository.restore(id);

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "POST_RESTORED",
      resourceType: "post",
      resourceId: id,
      beforeData: { status: existing.status, title: existing.title },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });
  },

  /**
   * Phase 7 — bulk workflow actions for the Content Dashboard's list view.
   * Each id is processed through the exact same single-item method used
   * by its dedicated endpoint (no duplicated business logic), isolated in
   * its own try/catch so one bad id (wrong status for the transition,
   * already in the target state, a race with another editor) never aborts
   * the rest of the batch — mirrors contentSchedulingService's per-item
   * isolation for the same reason.
   */
  async bulkAction(
    caller: SanitizedUser,
    action: "archive" | "trash" | "restore",
    ids: string[],
    meta: RequestMeta = {}
  ): Promise<{ succeeded: string[]; failed: { id: string; error: string }[] }> {
    const succeeded: string[] = [];
    const failed: { id: string; error: string }[] = [];

    for (const id of ids) {
      try {
        if (action === "archive") await this.archivePost(caller, id, meta);
        else if (action === "trash") await this.deletePost(caller, id, meta);
        else await this.restorePost(caller, id, meta);
        succeeded.push(id);
      } catch (err) {
        failed.push({ id, error: err instanceof Error ? err.message : "Action failed." });
      }
    }

    return { succeeded, failed };
  },
};
