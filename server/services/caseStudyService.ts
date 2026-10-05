/**
 * Case Study management (Phase 11 — docs/CASE_STUDY_ARCHITECTURE.md).
 * Organization-scoped. Revision, workflow, and optimistic-concurrency
 * handling mirror pageService.ts/postService.ts exactly (see their header
 * comments) — this file additionally validates and applies industry/
 * product/related-page/related-post relationships.
 *
 * The structured Case Study fields (challenge/solution/implementation/
 * results/testimonial/technologies/gallery/CTA) travel in `input.content`
 * and are stored verbatim on ContentRevision.metadata, the exact column
 * Page/Post already use for SEO — `caseStudyContentSchema` is
 * `seoMetadataSchema` extended with those fields, so a save that includes
 * both SEO and structured content fields is a single JSON blob, not two.
 */
import { caseStudyRepository, type CaseStudyWithRelations } from "../repositories/caseStudyRepository";
import { industryRepository } from "../repositories/industryRepository";
import { productRepository } from "../repositories/productRepository";
import { pageRepository } from "../repositories/pageRepository";
import { postRepository } from "../repositories/postRepository";
import { formRepository } from "../repositories/formRepository";
import { auditLogRepository } from "../repositories/auditLogRepository";
import { assertFeaturedMediaUsable } from "./mediaService";
import { sanitizeContentHtml } from "../utils/sanitizeHtml";
import { sanitizeEditorDocument } from "../schemas/editorSchemas";
import { redirectService } from "./redirectService";
import { notificationService } from "./notificationService";
import { prisma } from "../db/prisma";
import { ConflictError, NotFoundError, ValidationError } from "../core/errors";
import type { SanitizedUser } from "../types/domain";
import type { CreateCaseStudyInput, UpdateCaseStudyInput, ListCaseStudiesQuery } from "../schemas/caseStudySchemas";
import type { ScheduleContentInput, RevertContentInput } from "../schemas/contentSchemas";
import type { RequestMeta } from "./authService";
import { Prisma } from "@prisma/client";

/** See postService.ts/pageService.ts — ARCHIVED content is read-only until restored (PATCH status:"DRAFT"). PUBLISHED is not blocked: a live edit of published content is content.update's job. */
const CONTENT_EDIT_BLOCKED_STATUSES = new Set(["ARCHIVED"]);

function resolveEditorBlocksInput(value: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return value === null || value === undefined ? Prisma.DbNull : (value as Prisma.InputJsonValue);
}

function isUniqueConstraintError(err: unknown): boolean {
  return !!err && typeof err === "object" && "code" in err && (err as { code?: string }).code === "P2002";
}

function assertHasPublishableContent(revision: { title: string; body: string } | null): void {
  if (!revision || !revision.title.trim() || !revision.body.trim()) {
    throw new ValidationError("This case study needs a title and body before it can be published or scheduled.");
  }
}

async function loadCaseStudyOrThrow(id: string, organizationId: string): Promise<CaseStudyWithRelations> {
  const caseStudy = await caseStudyRepository.findByIdInOrg(id, organizationId);
  if (!caseStudy) throw new NotFoundError("Case study not found.");
  return caseStudy;
}

async function assertIndustryUsable(industryId: string | null | undefined): Promise<void> {
  if (!industryId) return;
  const industry = await industryRepository.findById(industryId);
  if (!industry) throw new ValidationError("industryId does not refer to a real industry.");
}

/** Products/Services/Solutions are a global catalog (Phase 10) — not organization-scoped, so existence alone is checked, never an org match. */
async function assertProductsUsable(productIds: string[] | undefined): Promise<void> {
  if (!productIds || productIds.length === 0) return;
  const found = await productRepository.findManyByIds(productIds);
  if (found.length !== new Set(productIds).size) {
    throw new ValidationError("One or more productIds do not refer to a real product/service/solution.");
  }
}

async function assertRelatedPagesUsable(pageIds: string[] | undefined, organizationId: string): Promise<void> {
  if (!pageIds || pageIds.length === 0) return;
  const found = await pageRepository.findByIdsInOrg(pageIds, organizationId);
  if (found.length !== new Set(pageIds).size) {
    throw new ValidationError("One or more relatedPageIds do not refer to a page in this organization.");
  }
}

async function assertRelatedPostsUsable(postIds: string[] | undefined, organizationId: string): Promise<void> {
  if (!postIds || postIds.length === 0) return;
  const found = await postRepository.findByIdsInOrg(postIds, organizationId);
  if (found.length !== new Set(postIds).size) {
    throw new ValidationError("One or more relatedPostIds do not refer to a post in this organization.");
  }
}

async function assertCtaFormUsable(ctaFormId: string | undefined, organizationId: string): Promise<void> {
  if (!ctaFormId) return;
  const form = await formRepository.findByIdInOrg(ctaFormId, organizationId);
  if (!form) throw new ValidationError("content.ctaFormId must refer to a real form in this organization.");
}

async function assertGalleryMediaUsable(galleryMediaIds: string[] | undefined, organizationId: string): Promise<void> {
  if (!galleryMediaIds || galleryMediaIds.length === 0) return;
  for (const mediaId of galleryMediaIds) {
    await assertFeaturedMediaUsable(mediaId, organizationId);
  }
}

async function assertRelationshipsUsable(
  input: { content?: { ctaFormId?: string }; productIds?: string[]; relatedPageIds?: string[]; relatedPostIds?: string[]; industryId?: string | null },
  organizationId: string
): Promise<void> {
  await Promise.all([
    assertIndustryUsable(input.industryId),
    assertProductsUsable(input.productIds),
    assertRelatedPagesUsable(input.relatedPageIds, organizationId),
    assertRelatedPostsUsable(input.relatedPostIds, organizationId),
    assertCtaFormUsable(input.content?.ctaFormId, organizationId),
    assertGalleryMediaUsable(input.content?.galleryMediaIds, organizationId),
  ]);
}

export const caseStudyService = {
  async listCaseStudies(
    organizationId: string,
    filters: Pick<ListCaseStudiesQuery, "search" | "status" | "industryId" | "productId" | "fromDate" | "toDate">,
    page: number,
    limit: number,
    sort: string,
    order: "asc" | "desc"
  ) {
    return caseStudyRepository.list(organizationId, filters, page, limit, sort, order);
  },

  async getCaseStudy(organizationId: string, id: string): Promise<CaseStudyWithRelations> {
    return loadCaseStudyOrThrow(id, organizationId);
  },

  async listRevisions(organizationId: string, id: string) {
    await loadCaseStudyOrThrow(id, organizationId);
    return caseStudyRepository.listRevisions(id);
  },

  async createCaseStudy(caller: SanitizedUser, input: CreateCaseStudyInput, meta: RequestMeta = {}): Promise<CaseStudyWithRelations> {
    const organizationId = caller.organizationId;
    const body = sanitizeContentHtml(input.body);
    const editorBlocks = input.editorBlocks ? sanitizeEditorDocument(input.editorBlocks) : undefined;

    await assertRelationshipsUsable(input, organizationId);
    if (input.featuredMediaId) await assertFeaturedMediaUsable(input.featuredMediaId, organizationId);

    if (input.slug) {
      const dup = await caseStudyRepository.findBySlugInOrg(organizationId, input.slug);
      if (dup) throw new ConflictError(`A case study with slug "${input.slug}" already exists.`, { existingCaseStudyId: dup.id });
    }
    const slug = input.slug ?? (await caseStudyRepository.findUniqueSlugInOrg(organizationId, input.title));

    let createdId: string;
    try {
      createdId = await prisma.$transaction(async (tx) => {
        const caseStudy = await tx.caseStudy.create({
          data: {
            organizationId,
            slug,
            title: input.title,
            status: "DRAFT",
            clientName: input.clientName,
            industryId: input.industryId,
            featuredMediaId: input.featuredMediaId,
            createdById: caller.id,
          },
        });
        const revision = await tx.contentRevision.create({
          data: {
            caseStudyId: caseStudy.id,
            version: 1,
            status: "DRAFT",
            title: input.title,
            excerpt: input.excerpt,
            body,
            metadata: (input.content ?? {}) as Prisma.InputJsonValue,
            editorBlocks: editorBlocks ? (editorBlocks as unknown as Prisma.InputJsonValue) : undefined,
            createdById: caller.id,
          },
        });
        await tx.caseStudy.update({ where: { id: caseStudy.id }, data: { currentRevisionId: revision.id } });
        if (input.productIds && input.productIds.length > 0) {
          await tx.caseStudyProduct.createMany({ data: input.productIds.map((productId) => ({ caseStudyId: caseStudy.id, productId })) });
        }
        if (input.relatedPageIds && input.relatedPageIds.length > 0) {
          await tx.caseStudyRelatedPage.createMany({ data: input.relatedPageIds.map((pageId) => ({ caseStudyId: caseStudy.id, pageId })) });
        }
        if (input.relatedPostIds && input.relatedPostIds.length > 0) {
          await tx.caseStudyRelatedPost.createMany({ data: input.relatedPostIds.map((postId) => ({ caseStudyId: caseStudy.id, postId })) });
        }
        return caseStudy.id;
      });
    } catch (err) {
      throw isUniqueConstraintError(err) ? new ConflictError("A case study with this slug already exists.") : err;
    }

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "CASE_STUDY_CREATED",
      resourceType: "case_study",
      resourceId: createdId,
      afterData: { title: input.title, slug },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return loadCaseStudyOrThrow(createdId, organizationId);
  },

  async updateCaseStudy(caller: SanitizedUser, id: string, input: UpdateCaseStudyInput, meta: RequestMeta = {}): Promise<CaseStudyWithRelations> {
    const organizationId = caller.organizationId;
    const existing = await loadCaseStudyOrThrow(id, organizationId);
    const sanitizedBody = input.body !== undefined ? sanitizeContentHtml(input.body) : undefined;
    const sanitizedEditorBlocks =
      input.editorBlocks === undefined ? undefined : input.editorBlocks === null ? null : sanitizeEditorDocument(input.editorBlocks);

    const hasContentEdit =
      input.title !== undefined ||
      input.body !== undefined ||
      input.excerpt !== undefined ||
      input.content !== undefined ||
      input.slug !== undefined ||
      input.editorBlocks !== undefined;
    if (hasContentEdit && input.status === undefined && CONTENT_EDIT_BLOCKED_STATUSES.has(existing.status)) {
      throw new ConflictError(`Case study content cannot be edited while status is ${existing.status}. Restore it to draft first.`);
    }

    if (input.slug !== undefined && input.slug !== existing.slug) {
      const dup = await caseStudyRepository.findBySlugInOrg(organizationId, input.slug);
      if (dup && dup.id !== id) throw new ConflictError(`A case study with slug "${input.slug}" already exists.`, { existingCaseStudyId: dup.id });
    }

    await assertRelationshipsUsable(
      { content: input.content, productIds: input.productIds, relatedPageIds: input.relatedPageIds, relatedPostIds: input.relatedPostIds, industryId: input.industryId },
      organizationId
    );

    const hasFeaturedMediaEdit = input.featuredMediaId !== undefined;
    if (hasFeaturedMediaEdit) {
      if (existing.status === "ARCHIVED") throw new ConflictError("Case study content cannot be edited while status is ARCHIVED.");
      if (input.featuredMediaId) await assertFeaturedMediaUsable(input.featuredMediaId, organizationId);
    }

    const unpublishing = existing.status === "PUBLISHED" && input.status === "DRAFT";
    const liveEditOfPublished = hasContentEdit && input.status === undefined && existing.status === "PUBLISHED";
    const currentRevision = existing.currentRevision;

    try {
      await prisma.$transaction(async (tx) => {
        const patch: Record<string, unknown> = {};
        if (input.status !== undefined) patch.status = input.status;
        if (input.slug !== undefined) patch.slug = input.slug;
        if (input.title !== undefined) patch.title = input.title;
        if (input.clientName !== undefined) patch.clientName = input.clientName;
        if (input.industryId !== undefined) patch.industryId = input.industryId;
        if (hasFeaturedMediaEdit) patch.featuredMediaId = input.featuredMediaId;
        if (unpublishing) patch.publishedAt = null;

        if (currentRevision && (unpublishing || liveEditOfPublished || (hasContentEdit && currentRevision.status === "PUBLISHED"))) {
          const newRevision = await tx.contentRevision.create({
            data: {
              caseStudyId: id,
              version: currentRevision.version + 1,
              status: liveEditOfPublished ? "PUBLISHED" : "DRAFT",
              title: input.title ?? currentRevision.title,
              excerpt: input.excerpt !== undefined ? input.excerpt : currentRevision.excerpt,
              body: sanitizedBody ?? currentRevision.body,
              metadata: (input.content ?? currentRevision.metadata) as Prisma.InputJsonValue,
              editorBlocks: resolveEditorBlocksInput(sanitizedEditorBlocks !== undefined ? sanitizedEditorBlocks : currentRevision.editorBlocks),
              createdById: caller.id,
              publishedAt: liveEditOfPublished ? new Date() : null,
            },
          });
          patch.currentRevisionId = newRevision.id;
        } else if (hasContentEdit && currentRevision) {
          const revisionPatch: Record<string, unknown> = {};
          if (input.title !== undefined) revisionPatch.title = input.title;
          if (input.excerpt !== undefined) revisionPatch.excerpt = input.excerpt;
          if (sanitizedBody !== undefined) revisionPatch.body = sanitizedBody;
          if (input.content !== undefined) revisionPatch.metadata = input.content as Prisma.InputJsonValue;
          if (sanitizedEditorBlocks !== undefined) revisionPatch.editorBlocks = resolveEditorBlocksInput(sanitizedEditorBlocks);
          if (Object.keys(revisionPatch).length > 0) {
            await tx.contentRevision.update({ where: { id: currentRevision.id }, data: revisionPatch });
          }
        }

        const willTouchRelations = input.productIds !== undefined || input.relatedPageIds !== undefined || input.relatedPostIds !== undefined;
        if (hasContentEdit && Object.keys(patch).length === 0 && !willTouchRelations) {
          patch.updatedAt = new Date();
        }

        if (Object.keys(patch).length > 0) {
          const where: Prisma.CaseStudyWhereInput = { id, ...(input.expectedUpdatedAt !== undefined ? { updatedAt: input.expectedUpdatedAt } : {}) };
          const result = await tx.caseStudy.updateMany({ where, data: patch });
          if (result.count === 0) {
            throw new ConflictError("This case study was changed by someone else since you loaded it. Reload and try again.");
          }
        }

        if (input.productIds !== undefined) {
          await tx.caseStudyProduct.deleteMany({ where: { caseStudyId: id } });
          if (input.productIds.length > 0) {
            await tx.caseStudyProduct.createMany({ data: input.productIds.map((productId) => ({ caseStudyId: id, productId })) });
          }
        }
        if (input.relatedPageIds !== undefined) {
          await tx.caseStudyRelatedPage.deleteMany({ where: { caseStudyId: id } });
          if (input.relatedPageIds.length > 0) {
            await tx.caseStudyRelatedPage.createMany({ data: input.relatedPageIds.map((pageId) => ({ caseStudyId: id, pageId })) });
          }
        }
        if (input.relatedPostIds !== undefined) {
          await tx.caseStudyRelatedPost.deleteMany({ where: { caseStudyId: id } });
          if (input.relatedPostIds.length > 0) {
            await tx.caseStudyRelatedPost.createMany({ data: input.relatedPostIds.map((postId) => ({ caseStudyId: id, postId })) });
          }
        }
      });
    } catch (err) {
      throw isUniqueConstraintError(err) ? new ConflictError("A case study with this slug already exists.") : err;
    }

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "CASE_STUDY_UPDATED",
      resourceType: "case_study",
      resourceId: id,
      beforeData: { status: existing.status, title: existing.title },
      afterData: { status: input.status, title: input.title, slug: input.slug },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    if (hasFeaturedMediaEdit && input.featuredMediaId !== existing.featuredMediaId) {
      await auditLogRepository.record({
        organizationId,
        actorUserId: caller.id,
        actorType: "USER",
        action: input.featuredMediaId ? "MEDIA_ATTACHED_TO_CONTENT" : "MEDIA_DETACHED_FROM_CONTENT",
        resourceType: "case_study",
        resourceId: id,
        beforeData: { featuredMediaId: existing.featuredMediaId },
        afterData: { featuredMediaId: input.featuredMediaId ?? null },
        ipAddress: meta.ip,
        userAgent: meta.userAgent,
      });
    }

    // A slug change on a case study that's (still) PUBLISHED after this
    // update means its real, indexed public URL just moved — same
    // auto-redirect postService.updatePost/pageService.updatePage apply.
    // Case studies render at /case-studies/:slug (Phase 11).
    if (input.slug !== undefined && input.slug !== existing.slug) {
      const finalStatus = input.status ?? existing.status;
      if (finalStatus === "PUBLISHED") {
        await redirectService.autoRedirectOnSlugChange({
          organizationId,
          fromPath: `/case-studies/${existing.slug}`,
          toPath: `/case-studies/${input.slug}`,
          resourceType: "case_study",
          resourceId: id,
        });
      }
    }

    return loadCaseStudyOrThrow(id, organizationId);
  },

  async submitForReview(caller: SanitizedUser, id: string, meta: RequestMeta = {}): Promise<CaseStudyWithRelations> {
    const organizationId = caller.organizationId;
    const existing = await loadCaseStudyOrThrow(id, organizationId);

    if (existing.status !== "DRAFT") throw new ConflictError(`Only a DRAFT case study can be submitted for review (current status: ${existing.status}).`);
    if (!existing.currentRevision || !existing.currentRevision.body.trim()) {
      throw new ValidationError("This case study needs body content before it can be submitted for review.");
    }

    await prisma.caseStudy.update({ where: { id }, data: { status: "IN_REVIEW" } });

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "CASE_STUDY_SUBMITTED_FOR_REVIEW",
      resourceType: "case_study",
      resourceId: id,
      beforeData: { status: existing.status },
      afterData: { status: "IN_REVIEW" },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return loadCaseStudyOrThrow(id, organizationId);
  },

  async publishCaseStudy(caller: SanitizedUser, id: string, meta: RequestMeta = {}): Promise<CaseStudyWithRelations> {
    const organizationId = caller.organizationId;
    const existing = await loadCaseStudyOrThrow(id, organizationId);

    if (existing.status === "ARCHIVED") throw new ConflictError("An archived case study must be restored before it can be published.");
    if (existing.status === "PUBLISHED") throw new ConflictError("This case study is already published.");
    if (!existing.currentRevisionId) throw new ConflictError("This case study has no content revision to publish.");
    assertHasPublishableContent(existing.currentRevision);

    const now = new Date();
    await prisma.$transaction([
      prisma.contentRevision.update({ where: { id: existing.currentRevisionId }, data: { status: "PUBLISHED", publishedAt: now } }),
      prisma.caseStudy.update({ where: { id }, data: { status: "PUBLISHED", publishedAt: now, scheduledAt: null } }),
    ]);

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "CASE_STUDY_PUBLISHED",
      resourceType: "case_study",
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
        title: "Your case study was published",
        message: `"${existing.title}" is now live.`,
      });
    }

    return loadCaseStudyOrThrow(id, organizationId);
  },

  async scheduleCaseStudy(caller: SanitizedUser, id: string, input: ScheduleContentInput, meta: RequestMeta = {}): Promise<CaseStudyWithRelations> {
    const organizationId = caller.organizationId;
    const existing = await loadCaseStudyOrThrow(id, organizationId);

    if (existing.status === "ARCHIVED") throw new ConflictError("An archived case study must be restored before it can be scheduled.");
    if (existing.status === "PUBLISHED") throw new ConflictError("This case study is already published.");
    assertHasPublishableContent(existing.currentRevision);

    await prisma.caseStudy.update({ where: { id }, data: { status: "SCHEDULED", scheduledAt: input.scheduledAt } });

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "CASE_STUDY_SCHEDULED",
      resourceType: "case_study",
      resourceId: id,
      beforeData: { status: existing.status },
      afterData: { status: "SCHEDULED", scheduledAt: input.scheduledAt },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return loadCaseStudyOrThrow(id, organizationId);
  },

  async archiveCaseStudy(caller: SanitizedUser, id: string, meta: RequestMeta = {}): Promise<CaseStudyWithRelations> {
    const organizationId = caller.organizationId;
    const existing = await loadCaseStudyOrThrow(id, organizationId);

    if (existing.status === "ARCHIVED") throw new ConflictError("This case study is already archived.");

    await prisma.caseStudy.update({ where: { id }, data: { status: "ARCHIVED" } });

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "CASE_STUDY_ARCHIVED",
      resourceType: "case_study",
      resourceId: id,
      beforeData: { status: existing.status },
      afterData: { status: "ARCHIVED" },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return loadCaseStudyOrThrow(id, organizationId);
  },

  async revertCaseStudy(caller: SanitizedUser, id: string, input: RevertContentInput, meta: RequestMeta = {}): Promise<CaseStudyWithRelations> {
    const organizationId = caller.organizationId;
    const existing = await loadCaseStudyOrThrow(id, organizationId);

    if (existing.status === "ARCHIVED") throw new ConflictError("An archived case study must be restored before its content can be reverted.");

    const target = await prisma.contentRevision.findFirst({ where: { id: input.revisionId, caseStudyId: id } });
    if (!target) throw new NotFoundError("Revision not found on this case study.");

    const current = existing.currentRevision;
    const nextVersion = (current?.version ?? 0) + 1;
    const wasPublished = existing.status === "PUBLISHED";

    await prisma.$transaction(async (tx) => {
      const newRevision = await tx.contentRevision.create({
        data: {
          caseStudyId: id,
          version: nextVersion,
          status: wasPublished ? "PUBLISHED" : "DRAFT",
          title: target.title,
          excerpt: target.excerpt,
          body: target.body,
          metadata: target.metadata as Prisma.InputJsonValue,
          editorBlocks: resolveEditorBlocksInput(target.editorBlocks),
          createdById: caller.id,
          publishedAt: wasPublished ? new Date() : null,
        },
      });
      await tx.caseStudy.update({ where: { id }, data: { currentRevisionId: newRevision.id } });
    });

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "CASE_STUDY_REVERTED",
      resourceType: "case_study",
      resourceId: id,
      beforeData: { fromVersion: current?.version, revertedToRevisionId: target.id, revertedToVersion: target.version },
      afterData: { newVersion: nextVersion },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return loadCaseStudyOrThrow(id, organizationId);
  },

  async deleteCaseStudy(caller: SanitizedUser, id: string, meta: RequestMeta = {}): Promise<void> {
    const organizationId = caller.organizationId;
    const existing = await loadCaseStudyOrThrow(id, organizationId);

    await caseStudyRepository.softDelete(id);

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "CASE_STUDY_DELETED",
      resourceType: "case_study",
      resourceId: id,
      beforeData: { status: existing.status, title: existing.title },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });
  },

  async listTrash(organizationId: string, page: number, limit: number) {
    return caseStudyRepository.listTrash(organizationId, page, limit);
  },

  async restoreCaseStudy(caller: SanitizedUser, id: string, meta: RequestMeta = {}): Promise<void> {
    const organizationId = caller.organizationId;
    const existing = await caseStudyRepository.findTrashedByIdInOrg(id, organizationId);
    if (!existing) throw new NotFoundError("Case study not found in trash.");

    await caseStudyRepository.restore(id);

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "CASE_STUDY_RESTORED",
      resourceType: "case_study",
      resourceId: id,
      beforeData: { status: existing.status, title: existing.title },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });
  },

  /** Bulk workflow actions for the list view — same per-item isolation as postService.bulkAction/pageService.bulkAction. */
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
        if (action === "archive") await this.archiveCaseStudy(caller, id, meta);
        else if (action === "trash") await this.deleteCaseStudy(caller, id, meta);
        else await this.restoreCaseStudy(caller, id, meta);
        succeeded.push(id);
      } catch (err) {
        failed.push({ id, error: err instanceof Error ? err.message : "Action failed." });
      }
    }

    return { succeeded, failed };
  },
};
