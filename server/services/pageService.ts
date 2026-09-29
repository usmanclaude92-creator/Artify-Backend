/**
 * Page management (Phase 8 — docs/CMS_ARCHITECTURE.md,
 * docs/CONTENT_WORKFLOW_ARCHITECTURE.md). Organization-scoped.
 *
 * Workflow: DRAFT -> IN_REVIEW -> PUBLISHED -> ARCHIVED, and
 * IN_REVIEW -> SCHEDULED -> PUBLISHED, each a dedicated, permission-gated,
 * content-validated endpoint (submitForReview/publishPage/schedulePage/
 * archivePage) — never reachable through the generic PATCH, which only
 * ever moves status back to DRAFT (reopen for editing) plus content-field
 * edits. See docs/CONTENT_WORKFLOW_ARCHITECTURE.md for the full state
 * machine and why each transition is its own method.
 *
 * Revisions: a revision is immutable once published at the application
 * layer (schema.prisma's own doc comment on ContentRevision). A content
 * edit mutates the current revision in place unless that revision's own
 * status is PUBLISHED (checked on the revision, not the page, so a page
 * restored from ARCHIVED with a still-PUBLISHED current revision is still
 * handled correctly), in which case editing clones a new revision instead —
 * PUBLISHED immediately (a "live edit", content.update's job) if the page
 * itself is staying PUBLISHED, or DRAFT if the edit accompanies an explicit
 * unpublish (PATCH status:"DRAFT"). Either way the page is never forced
 * offline just to fix a typo. revertPage always clones a new revision from
 * history — it never mutates or deletes a past one — and republishes
 * immediately (PUBLISHED) if the page was live, for the same reason.
 *
 * Optimistic concurrency (§12): Page.updatedAt doubles as the page's
 * version. Every content edit touches the Page row (even one that only
 * changes the current revision's own fields) specifically so updatedAt
 * stays a reliable version for "this page and its current draft" as a
 * whole. When a PATCH supplies expectedUpdatedAt, the write is a
 * conditional `updateMany` keyed on (id, updatedAt) — the same race-safe
 * conditional-update-plus-row-count pattern used for lead conversion and
 * workspace provisioning — so a stale write affects zero rows and is
 * reported as a 409, never silently lost.
 */
import { pageRepository, type PageWithRevision } from "../repositories/pageRepository";
import { templateRepository } from "../repositories/templateRepository";
import { auditLogRepository } from "../repositories/auditLogRepository";
import { assertFeaturedMediaUsable } from "./mediaService";
import { sanitizeContentHtml } from "../utils/sanitizeHtml";
import { notificationService } from "./notificationService";
import { redirectService } from "./redirectService";
import { prisma } from "../db/prisma";
import { ConflictError, NotFoundError, ValidationError } from "../core/errors";
import type { SanitizedUser } from "../types/domain";
import type { CreatePageInput, UpdatePageInput } from "../schemas/pageSchemas";
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
 * on a published page was to unpublish it (PATCH status:"DRAFT"), taking it
 * offline until republished.
 */
const CONTENT_EDIT_BLOCKED_STATUSES = new Set(["ARCHIVED"]);

function isUniqueConstraintError(err: unknown): boolean {
  return !!err && typeof err === "object" && "code" in err && (err as { code?: string }).code === "P2002";
}

// The hand-added partial unique index (pages_one_homepage_per_org — see
// the Phase 1 migration SQL and Page's own schema.prisma doc comment)
// surfaces as the same P2002 code as an ordinary unique-constraint
// violation, distinguished only by its constraint name in `meta.target`.
function isHomepageUniqueViolation(err: unknown): boolean {
  if (!isUniqueConstraintError(err)) return false;
  const target = (err as { meta?: { target?: unknown } }).meta?.target;
  const targetStr = Array.isArray(target) ? target.join(",") : String(target ?? "");
  return targetStr.includes("pages_one_homepage_per_org");
}

// Phase 1 (Website module) — a page may only reference a PUBLISHED
// template in its own organization; an unpublished/archived/cross-org/
// nonexistent id is rejected up front rather than silently accepted and
// left to fail at render time.
async function assertTemplateUsable(templateId: string | null | undefined, organizationId: string): Promise<void> {
  if (!templateId) return;
  const template = await templateRepository.findPublishedByIdInOrg(templateId, organizationId);
  if (!template) throw new ValidationError("templateId must refer to a PUBLISHED template in this organization.");
}

function assertHasPublishableContent(revision: { title: string; body: string } | null): void {
  if (!revision || !revision.title.trim() || !revision.body.trim()) {
    throw new ValidationError("This page needs a title and body before it can be published or scheduled.");
  }
}

async function loadPageOrThrow(id: string, organizationId: string): Promise<PageWithRevision> {
  const page = await pageRepository.findByIdInOrg(id, organizationId);
  if (!page) throw new NotFoundError("Page not found.");
  return page;
}

export const pageService = {
  async listPages(
    organizationId: string,
    filters: { search?: string; status?: string },
    page: number,
    limit: number,
    sort: string,
    order: "asc" | "desc"
  ) {
    return pageRepository.list(organizationId, filters, page, limit, sort, order);
  },

  async getPage(organizationId: string, id: string): Promise<PageWithRevision> {
    return loadPageOrThrow(id, organizationId);
  },

  async listRevisions(organizationId: string, id: string) {
    await loadPageOrThrow(id, organizationId);
    return pageRepository.listRevisions(id);
  },

  async createPage(caller: SanitizedUser, input: CreatePageInput, meta: RequestMeta = {}): Promise<PageWithRevision> {
    const organizationId = caller.organizationId;
    const body = sanitizeContentHtml(input.body);

    if (input.slug) {
      const dup = await pageRepository.findBySlugInOrg(organizationId, input.slug);
      if (dup) throw new ConflictError(`A page with slug "${input.slug}" already exists.`, { existingPageId: dup.id });
    }
    if (input.featuredMediaId) await assertFeaturedMediaUsable(input.featuredMediaId, organizationId);
    await assertTemplateUsable(input.templateId, organizationId);
    const slug = input.slug ?? (await pageRepository.findUniqueSlugInOrg(organizationId, input.title));

    let createdId: string;
    try {
      createdId = await prisma.$transaction(async (tx) => {
        const page = await tx.page.create({
          data: {
            organizationId,
            slug,
            title: input.title,
            status: "DRAFT",
            createdById: caller.id,
            featuredMediaId: input.featuredMediaId,
            templateId: input.templateId,
            pageType: input.pageType,
            isHomepage: input.isHomepage ?? false,
          },
        });
        const revision = await tx.contentRevision.create({
          data: {
            pageId: page.id,
            version: 1,
            status: "DRAFT",
            title: input.title,
            body,
            metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
            createdById: caller.id,
          },
        });
        await tx.page.update({ where: { id: page.id }, data: { currentRevisionId: revision.id } });
        return page.id;
      });
    } catch (err) {
      if (isHomepageUniqueViolation(err)) throw new ConflictError("This organization already has a homepage assigned. Unset the existing one first.");
      throw isUniqueConstraintError(err) ? new ConflictError("A page with this slug already exists.") : err;
    }

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "PAGE_CREATED",
      resourceType: "page",
      resourceId: createdId,
      afterData: { title: input.title, slug },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return loadPageOrThrow(createdId, organizationId);
  },

  async updatePage(caller: SanitizedUser, id: string, input: UpdatePageInput, meta: RequestMeta = {}): Promise<PageWithRevision> {
    const organizationId = caller.organizationId;
    const existing = await loadPageOrThrow(id, organizationId);
    const sanitizedBody = input.body !== undefined ? sanitizeContentHtml(input.body) : undefined;

    // Schema restricts input.status to "DRAFT" — every other status is
    // dedicated-endpoint-only (submitForReview/schedulePage/publishPage/
    // archivePage). Moving to DRAFT is always a legal "reopen" from any
    // other status.
    const hasContentEdit = input.title !== undefined || input.body !== undefined || input.metadata !== undefined || input.slug !== undefined;
    // Blocked only when the page STAYS archived — target status is always
    // existing.status unless input.status ("DRAFT" only, restoring it) is
    // supplied, so this never blocks a combined restore+edit.
    if (hasContentEdit && input.status === undefined && CONTENT_EDIT_BLOCKED_STATUSES.has(existing.status)) {
      throw new ConflictError(`Page content cannot be edited while status is ${existing.status}. Restore it to draft first.`);
    }

    if (input.slug !== undefined && input.slug !== existing.slug) {
      const dup = await pageRepository.findBySlugInOrg(organizationId, input.slug);
      if (dup && dup.id !== id) throw new ConflictError(`A page with slug "${input.slug}" already exists.`, { existingPageId: dup.id });
    }

    if (input.templateId !== undefined) await assertTemplateUsable(input.templateId, organizationId);

    // The featured image lives on the Page row, not the revision — it can
    // be changed independently of content edits (e.g. while PUBLISHED),
    // except on ARCHIVED content, which stays fully read-only (§24).
    const hasFeaturedMediaEdit = input.featuredMediaId !== undefined;
    if (hasFeaturedMediaEdit) {
      if (existing.status === "ARCHIVED") throw new ConflictError("Page content cannot be edited while status is ARCHIVED.");
      if (input.featuredMediaId) await assertFeaturedMediaUsable(input.featuredMediaId, organizationId);
    }

    const unpublishing = existing.status === "PUBLISHED" && input.status === "DRAFT";
    // A live edit: the page stays PUBLISHED (no status field in the
    // request), so the new content should go live immediately as a new
    // PUBLISHED revision rather than forking into an unseen DRAFT — that
    // DRAFT-fork behavior is reserved for `unpublishing`, an explicit,
    // deliberate status change.
    const liveEditOfPublished = hasContentEdit && input.status === undefined && existing.status === "PUBLISHED";
    const currentRevision = existing.currentRevision;

    try {
      await prisma.$transaction(async (tx) => {
        const pagePatch: Record<string, unknown> = {};
        if (input.status !== undefined) pagePatch.status = input.status;
        if (input.slug !== undefined) pagePatch.slug = input.slug;
        if (input.title !== undefined) pagePatch.title = input.title;
        if (hasFeaturedMediaEdit) pagePatch.featuredMediaId = input.featuredMediaId;
        if (input.templateId !== undefined) pagePatch.templateId = input.templateId;
        if (input.pageType !== undefined) pagePatch.pageType = input.pageType;
        if (input.isHomepage !== undefined) pagePatch.isHomepage = input.isHomepage;
        if (unpublishing) pagePatch.publishedAt = null;

        if (currentRevision && (unpublishing || liveEditOfPublished || (hasContentEdit && currentRevision.status === "PUBLISHED"))) {
          // The current revision has actually gone live — never mutate it
          // (immutability invariant). Clone it into a fresh revision,
          // applying this request's content edits (if any) on top; PUBLISHED
          // immediately for a live edit, DRAFT for an explicit unpublish.
          const newRevision = await tx.contentRevision.create({
            data: {
              pageId: id,
              version: currentRevision.version + 1,
              status: liveEditOfPublished ? "PUBLISHED" : "DRAFT",
              title: input.title ?? currentRevision.title,
              body: sanitizedBody ?? currentRevision.body,
              metadata: (input.metadata ?? currentRevision.metadata) as Prisma.InputJsonValue,
              createdById: caller.id,
              publishedAt: liveEditOfPublished ? new Date() : null,
            },
          });
          pagePatch.currentRevisionId = newRevision.id;
        } else if (hasContentEdit && currentRevision) {
          const revisionPatch: Record<string, unknown> = {};
          if (input.title !== undefined) revisionPatch.title = input.title;
          if (sanitizedBody !== undefined) revisionPatch.body = sanitizedBody;
          if (input.metadata !== undefined) revisionPatch.metadata = input.metadata as Prisma.InputJsonValue;
          if (Object.keys(revisionPatch).length > 0) {
            await tx.contentRevision.update({ where: { id: currentRevision.id }, data: revisionPatch });
          }
        }

        if (hasContentEdit && Object.keys(pagePatch).length === 0) {
          // Every content edit must touch the Page row — even one that
          // only changed the current revision's own fields — so
          // Page.updatedAt stays a reliable optimistic-concurrency version
          // for "this page and its current draft" as a whole (§12).
          pagePatch.updatedAt = new Date();
        }

        if (Object.keys(pagePatch).length > 0) {
          const where: Prisma.PageWhereInput = { id, ...(input.expectedUpdatedAt !== undefined ? { updatedAt: input.expectedUpdatedAt } : {}) };
          const result = await tx.page.updateMany({ where, data: pagePatch });
          if (result.count === 0) {
            throw new ConflictError("This page was changed by someone else since you loaded it. Reload and try again.");
          }
        }
      });
    } catch (err) {
      if (isHomepageUniqueViolation(err)) throw new ConflictError("This organization already has a homepage assigned. Unset the existing one first.");
      throw isUniqueConstraintError(err) ? new ConflictError("A page with this slug already exists.") : err;
    }

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "PAGE_UPDATED",
      resourceType: "page",
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
        resourceType: "page",
        resourceId: id,
        beforeData: { featuredMediaId: existing.featuredMediaId },
        afterData: { featuredMediaId: input.featuredMediaId ?? null },
        ipAddress: meta.ip,
        userAgent: meta.userAgent,
      });
    }

    // A slug change on a page that's (still) PUBLISHED after this update
    // means its real, indexed public URL just moved — auto-create a
    // redirect so existing links/search results don't dead-end, mirroring
    // postService.updatePost's identical handling for /blog/:slug. Pages
    // render at the public site's root, /:slug (Phase 4 —
    // docs/CMS_ARCHITECTURE.md), not under a fixed prefix like posts —
    // gated on the resulting status, not the prior one, for the same
    // unpublish-in-the-same-PATCH reason.
    if (input.slug !== undefined && input.slug !== existing.slug) {
      const finalStatus = input.status ?? existing.status;
      if (finalStatus === "PUBLISHED") {
        await redirectService.autoRedirectOnSlugChange({
          organizationId,
          fromPath: `/${existing.slug}`,
          toPath: `/${input.slug}`,
          resourceType: "page",
          resourceId: id,
        });
      }
    }

    return loadPageOrThrow(id, organizationId);
  },

  async submitForReview(caller: SanitizedUser, id: string, meta: RequestMeta = {}): Promise<PageWithRevision> {
    const organizationId = caller.organizationId;
    const existing = await loadPageOrThrow(id, organizationId);

    if (existing.status !== "DRAFT") throw new ConflictError(`Only a DRAFT page can be submitted for review (current status: ${existing.status}).`);
    if (!existing.currentRevision || !existing.currentRevision.body.trim()) {
      throw new ValidationError("This page needs body content before it can be submitted for review.");
    }

    await prisma.page.update({ where: { id }, data: { status: "IN_REVIEW" } });

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "PAGE_SUBMITTED_FOR_REVIEW",
      resourceType: "page",
      resourceId: id,
      beforeData: { status: existing.status },
      afterData: { status: "IN_REVIEW" },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return loadPageOrThrow(id, organizationId);
  },

  async publishPage(caller: SanitizedUser, id: string, meta: RequestMeta = {}): Promise<PageWithRevision> {
    const organizationId = caller.organizationId;
    const existing = await loadPageOrThrow(id, organizationId);

    if (existing.status === "ARCHIVED") throw new ConflictError("An archived page must be restored before it can be published.");
    if (existing.status === "PUBLISHED") throw new ConflictError("This page is already published.");
    if (!existing.currentRevisionId) throw new ConflictError("This page has no content revision to publish.");
    assertHasPublishableContent(existing.currentRevision);

    const now = new Date();
    await prisma.$transaction([
      prisma.contentRevision.update({ where: { id: existing.currentRevisionId }, data: { status: "PUBLISHED", publishedAt: now } }),
      prisma.page.update({ where: { id }, data: { status: "PUBLISHED", publishedAt: now, scheduledAt: null } }),
    ]);

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "PAGE_PUBLISHED",
      resourceType: "page",
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
        title: "Your page was published",
        message: `"${existing.title}" is now live.`,
      });
    }

    return loadPageOrThrow(id, organizationId);
  },

  async schedulePage(caller: SanitizedUser, id: string, input: ScheduleContentInput, meta: RequestMeta = {}): Promise<PageWithRevision> {
    const organizationId = caller.organizationId;
    const existing = await loadPageOrThrow(id, organizationId);

    if (existing.status === "ARCHIVED") throw new ConflictError("An archived page must be restored before it can be scheduled.");
    if (existing.status === "PUBLISHED") throw new ConflictError("This page is already published.");
    assertHasPublishableContent(existing.currentRevision);

    await prisma.page.update({ where: { id }, data: { status: "SCHEDULED", scheduledAt: input.scheduledAt } });

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "PAGE_SCHEDULED",
      resourceType: "page",
      resourceId: id,
      beforeData: { status: existing.status },
      afterData: { status: "SCHEDULED", scheduledAt: input.scheduledAt },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return loadPageOrThrow(id, organizationId);
  },

  async archivePage(caller: SanitizedUser, id: string, meta: RequestMeta = {}): Promise<PageWithRevision> {
    const organizationId = caller.organizationId;
    const existing = await loadPageOrThrow(id, organizationId);

    if (existing.status === "ARCHIVED") throw new ConflictError("This page is already archived.");

    // Never a physical delete, and the current revision (published or not)
    // is left exactly as-is — archiving preserves history, it doesn't
    // rewrite it.
    await prisma.page.update({ where: { id }, data: { status: "ARCHIVED" } });

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "PAGE_ARCHIVED",
      resourceType: "page",
      resourceId: id,
      beforeData: { status: existing.status },
      afterData: { status: "ARCHIVED" },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return loadPageOrThrow(id, organizationId);
  },

  async revertPage(caller: SanitizedUser, id: string, input: RevertContentInput, meta: RequestMeta = {}): Promise<PageWithRevision> {
    const organizationId = caller.organizationId;
    const existing = await loadPageOrThrow(id, organizationId);

    if (existing.status === "ARCHIVED") throw new ConflictError("An archived page must be restored before its content can be reverted.");

    const target = await prisma.contentRevision.findFirst({ where: { id: input.revisionId, pageId: id } });
    if (!target) throw new NotFoundError("Revision not found on this page.");

    const current = existing.currentRevision;
    const nextVersion = (current?.version ?? 0) + 1;
    // Reverting a live page restores the old content as the new live
    // content immediately, the same as any other edit to published content
    // (see updatePage's `liveEditOfPublished`) — it must not take the page
    // offline just because the source of the new content was history.
    const wasPublished = existing.status === "PUBLISHED";

    await prisma.$transaction(async (tx) => {
      // Revert MUST create a new revision (§11) — it never mutates or
      // deletes the target or the outgoing current revision, so the full
      // history stays intact.
      const newRevision = await tx.contentRevision.create({
        data: {
          pageId: id,
          version: nextVersion,
          status: wasPublished ? "PUBLISHED" : "DRAFT",
          title: target.title,
          body: target.body,
          metadata: target.metadata as Prisma.InputJsonValue,
          createdById: caller.id,
          publishedAt: wasPublished ? new Date() : null,
        },
      });
      await tx.page.update({
        where: { id },
        data: { currentRevisionId: newRevision.id },
      });
    });

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "PAGE_REVERTED",
      resourceType: "page",
      resourceId: id,
      beforeData: { fromVersion: current?.version, revertedToRevisionId: target.id, revertedToVersion: target.version },
      afterData: { newVersion: nextVersion },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return loadPageOrThrow(id, organizationId);
  },

  async deletePage(caller: SanitizedUser, id: string, meta: RequestMeta = {}): Promise<void> {
    const organizationId = caller.organizationId;
    const existing = await loadPageOrThrow(id, organizationId);

    await pageRepository.softDelete(id);

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "PAGE_DELETED",
      resourceType: "page",
      resourceId: id,
      beforeData: { status: existing.status, title: existing.title },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });
  },
};
