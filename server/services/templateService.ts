/**
 * Template management (Phase 1 — docs/control-center-replacement-roadmap.md).
 * Organization-scoped. Deliberately mirrors pageService.ts/postService.ts's
 * revision/workflow pattern (see prisma/schema.prisma's own comment on the
 * Template model) rather than inventing a new one: a content edit mutates
 * the current revision in place unless that revision is PUBLISHED, in
 * which case it forks a new DRAFT revision; publishing flips the current
 * revision's status to PUBLISHED; rollback clones an old revision's
 * content into a new one, never mutating or deleting history.
 *
 * Workflow is intentionally simpler than Post/Page's: only
 * DRAFT -> PUBLISHED -> ARCHIVED (and ARCHIVED/PUBLISHED -> DRAFT via
 * update's status field is NOT exposed — archive/publish are the only
 * status-changing actions, matching the brief's scope: no IN_REVIEW/
 * SCHEDULED workflow was asked for here).
 *
 * System-template protection (Part J of the Phase 1 brief): a small,
 * seeded set of `isSystem` templates (e.g. a default 404) may be read and
 * duplicated but never updated, published, archived, or deleted — the
 * duplicate becomes an ordinary, fully-editable, non-system template.
 */
import { templateRepository, type TemplateWithUsage } from "../repositories/templateRepository";
import { auditLogRepository } from "../repositories/auditLogRepository";
import { prisma } from "../db/prisma";
import { AuthorizationError, ConflictError, NotFoundError, ValidationError } from "../core/errors";
import type { SanitizedUser } from "../types/domain";
import type {
  CreateTemplateInput,
  UpdateTemplateInput,
  DuplicateTemplateInput,
  RevertTemplateInput,
  ListTemplatesQuery,
} from "../schemas/templateSchemas";
import type { RequestMeta } from "./authService";
import type { Prisma } from "@prisma/client";

function isUniqueConstraintError(err: unknown): boolean {
  return !!err && typeof err === "object" && "code" in err && (err as { code?: string }).code === "P2002";
}

async function loadTemplateOrThrow(id: string, organizationId: string): Promise<TemplateWithUsage> {
  const template = await templateRepository.findByIdInOrg(id, organizationId);
  if (!template) throw new NotFoundError("Template not found.");
  return template;
}

function assertNotSystem(template: { isSystem: boolean }, action: string): void {
  if (template.isSystem) {
    throw new AuthorizationError(`This is a protected system template and cannot be ${action}.`);
  }
}

export const templateService = {
  async listTemplates(organizationId: string, filters: Pick<ListTemplatesQuery, "search" | "status" | "type">, page: number, limit: number, sort: string, order: "asc" | "desc") {
    return templateRepository.list(organizationId, filters, page, limit, sort, order);
  },

  async getTemplate(organizationId: string, id: string): Promise<TemplateWithUsage> {
    return loadTemplateOrThrow(id, organizationId);
  },

  async listRevisions(organizationId: string, id: string) {
    await loadTemplateOrThrow(id, organizationId);
    return templateRepository.listRevisions(id);
  },

  async createTemplate(caller: SanitizedUser, input: CreateTemplateInput, meta: RequestMeta = {}): Promise<TemplateWithUsage> {
    const organizationId = caller.organizationId;

    if (input.slug) {
      const dup = await templateRepository.findBySlugInOrg(organizationId, input.slug);
      if (dup) throw new ConflictError(`A template with slug "${input.slug}" already exists.`, { existingTemplateId: dup.id });
    }
    const slug = input.slug ?? (await templateRepository.findUniqueSlugInOrg(organizationId, input.name));

    let createdId: string;
    try {
      createdId = await prisma.$transaction(async (tx) => {
        const template = await tx.template.create({
          data: {
            organizationId,
            type: input.type,
            name: input.name,
            slug,
            description: input.description,
            status: "DRAFT",
            createdById: caller.id,
          },
        });
        const revision = await tx.templateRevision.create({
          data: {
            templateId: template.id,
            version: 1,
            status: "DRAFT",
            name: input.name,
            structure: input.structure as Prisma.InputJsonValue,
            createdById: caller.id,
          },
        });
        await tx.template.update({ where: { id: template.id }, data: { currentRevisionId: revision.id } });
        return template.id;
      });
    } catch (err) {
      throw isUniqueConstraintError(err) ? new ConflictError("A template with this slug already exists.") : err;
    }

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "TEMPLATE_CREATED",
      resourceType: "template",
      resourceId: createdId,
      afterData: { name: input.name, slug, type: input.type },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return loadTemplateOrThrow(createdId, organizationId);
  },

  async updateTemplate(caller: SanitizedUser, id: string, input: UpdateTemplateInput, meta: RequestMeta = {}): Promise<TemplateWithUsage> {
    const organizationId = caller.organizationId;
    const existing = await loadTemplateOrThrow(id, organizationId);
    assertNotSystem(existing, "edited");

    const hasContentEdit = input.name !== undefined || input.slug !== undefined || input.structure !== undefined;

    if (input.slug !== undefined && input.slug !== existing.slug) {
      const dup = await templateRepository.findBySlugInOrg(organizationId, input.slug);
      if (dup && dup.id !== id) throw new ConflictError(`A template with slug "${input.slug}" already exists.`, { existingTemplateId: dup.id });
    }

    const currentRevision = existing.currentRevision;

    try {
      await prisma.$transaction(async (tx) => {
        const templatePatch: Record<string, unknown> = {};
        if (input.name !== undefined) templatePatch.name = input.name;
        if (input.slug !== undefined) templatePatch.slug = input.slug;
        if (input.description !== undefined) templatePatch.description = input.description;

        if (currentRevision && hasContentEdit && currentRevision.status === "PUBLISHED") {
          const newRevision = await tx.templateRevision.create({
            data: {
              templateId: id,
              version: currentRevision.version + 1,
              status: "DRAFT",
              name: input.name ?? currentRevision.name,
              structure: (input.structure ?? currentRevision.structure) as Prisma.InputJsonValue,
              createdById: caller.id,
            },
          });
          templatePatch.currentRevisionId = newRevision.id;
          // A live template edit does not retroactively unpublish the
          // template itself — the PUBLISHED revision stays the one pages
          // render until this new draft is explicitly published, exactly
          // like Post/Page's own "fork on published edit" behavior.
        } else if (hasContentEdit && currentRevision) {
          const revisionPatch: Record<string, unknown> = {};
          if (input.name !== undefined) revisionPatch.name = input.name;
          if (input.structure !== undefined) revisionPatch.structure = input.structure as Prisma.InputJsonValue;
          if (Object.keys(revisionPatch).length > 0) {
            await tx.templateRevision.update({ where: { id: currentRevision.id }, data: revisionPatch });
          }
        }

        if (hasContentEdit && Object.keys(templatePatch).length === 0) {
          templatePatch.updatedAt = new Date();
        }

        if (Object.keys(templatePatch).length > 0) {
          const where: Prisma.TemplateWhereInput = { id, ...(input.expectedUpdatedAt !== undefined ? { updatedAt: input.expectedUpdatedAt } : {}) };
          const result = await tx.template.updateMany({ where, data: templatePatch });
          if (result.count === 0) {
            throw new ConflictError("This template was changed by someone else since you loaded it. Reload and try again.");
          }
        }
      });
    } catch (err) {
      throw isUniqueConstraintError(err) ? new ConflictError("A template with this slug already exists.") : err;
    }

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "TEMPLATE_UPDATED",
      resourceType: "template",
      resourceId: id,
      beforeData: { name: existing.name, slug: existing.slug },
      afterData: { name: input.name, slug: input.slug },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return loadTemplateOrThrow(id, organizationId);
  },

  async publishTemplate(caller: SanitizedUser, id: string, meta: RequestMeta = {}): Promise<TemplateWithUsage> {
    const organizationId = caller.organizationId;
    const existing = await loadTemplateOrThrow(id, organizationId);
    assertNotSystem(existing, "published");

    if (existing.status === "ARCHIVED") throw new ConflictError("An archived template must be restored before it can be published.");
    if (!existing.currentRevisionId) throw new ConflictError("This template has no revision to publish.");

    const now = new Date();
    await prisma.$transaction([
      prisma.templateRevision.update({ where: { id: existing.currentRevisionId }, data: { status: "PUBLISHED", publishedAt: now } }),
      prisma.template.update({ where: { id }, data: { status: "PUBLISHED" } }),
    ]);

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "TEMPLATE_PUBLISHED",
      resourceType: "template",
      resourceId: id,
      beforeData: { status: existing.status },
      afterData: { status: "PUBLISHED" },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return loadTemplateOrThrow(id, organizationId);
  },

  async archiveTemplate(caller: SanitizedUser, id: string, meta: RequestMeta = {}): Promise<TemplateWithUsage> {
    const organizationId = caller.organizationId;
    const existing = await loadTemplateOrThrow(id, organizationId);
    assertNotSystem(existing, "archived");

    if (existing.status === "ARCHIVED") throw new ConflictError("This template is already archived.");
    // Archiving a template that's still assigned to pages doesn't strip
    // the assignment — pageService's rendering fallback (Part D of the
    // brief) means an archived-template page just stops resolving a
    // template and falls back to default rendering, never a 404/crash.
    // This mirrors the brief's "backward-compatible while introduced"
    // requirement rather than forcing a reassignment step here.
    await prisma.template.update({ where: { id }, data: { status: "ARCHIVED" } });

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "TEMPLATE_ARCHIVED",
      resourceType: "template",
      resourceId: id,
      beforeData: { status: existing.status },
      afterData: { status: "ARCHIVED" },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return loadTemplateOrThrow(id, organizationId);
  },

  async revertTemplate(caller: SanitizedUser, id: string, input: RevertTemplateInput, meta: RequestMeta = {}): Promise<TemplateWithUsage> {
    const organizationId = caller.organizationId;
    const existing = await loadTemplateOrThrow(id, organizationId);
    assertNotSystem(existing, "rolled back");

    const target = await prisma.templateRevision.findFirst({ where: { id: input.revisionId, templateId: id } });
    if (!target) throw new NotFoundError("Revision not found on this template.");

    const current = existing.currentRevision;
    const nextVersion = (current?.version ?? 0) + 1;
    const wasPublished = existing.status === "PUBLISHED";

    await prisma.$transaction(async (tx) => {
      const newRevision = await tx.templateRevision.create({
        data: {
          templateId: id,
          version: nextVersion,
          status: wasPublished ? "PUBLISHED" : "DRAFT",
          name: target.name,
          structure: target.structure as Prisma.InputJsonValue,
          createdById: caller.id,
          publishedAt: wasPublished ? new Date() : null,
        },
      });
      await tx.template.update({ where: { id }, data: { currentRevisionId: newRevision.id } });
    });

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "TEMPLATE_REVERTED",
      resourceType: "template",
      resourceId: id,
      beforeData: { fromVersion: current?.version, revertedToRevisionId: target.id, revertedToVersion: target.version },
      afterData: { newVersion: nextVersion },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return loadTemplateOrThrow(id, organizationId);
  },

  async duplicateTemplate(caller: SanitizedUser, id: string, input: DuplicateTemplateInput, meta: RequestMeta = {}): Promise<TemplateWithUsage> {
    const organizationId = caller.organizationId;
    const existing = await loadTemplateOrThrow(id, organizationId);
    // Duplicating a system template is explicitly allowed — the copy is
    // an ordinary, fully-editable template (isSystem: false by default),
    // which is how a system template gets safely customized.

    const baseName = input.name ?? `${existing.name} (Copy)`;
    const slug = await templateRepository.findUniqueSlugInOrg(organizationId, baseName);
    const sourceStructure = existing.currentRevision?.structure ?? {};

    const createdId = await prisma.$transaction(async (tx) => {
      const template = await tx.template.create({
        data: {
          organizationId,
          type: existing.type,
          name: baseName,
          slug,
          description: existing.description,
          status: "DRAFT",
          isSystem: false,
          createdById: caller.id,
        },
      });
      const revision = await tx.templateRevision.create({
        data: {
          templateId: template.id,
          version: 1,
          status: "DRAFT",
          name: baseName,
          structure: sourceStructure as Prisma.InputJsonValue,
          createdById: caller.id,
        },
      });
      await tx.template.update({ where: { id: template.id }, data: { currentRevisionId: revision.id } });
      return template.id;
    });

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "TEMPLATE_DUPLICATED",
      resourceType: "template",
      resourceId: createdId,
      afterData: { duplicatedFromId: id, name: baseName },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return loadTemplateOrThrow(createdId, organizationId);
  },

  async deleteTemplate(caller: SanitizedUser, id: string, meta: RequestMeta = {}): Promise<void> {
    const organizationId = caller.organizationId;
    const existing = await loadTemplateOrThrow(id, organizationId);
    assertNotSystem(existing, "deleted");

    if (existing._count.pages > 0) {
      throw new ValidationError("This template is still assigned to one or more pages. Reassign or unassign them before deleting it.");
    }

    await templateRepository.softDelete(id);

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "TEMPLATE_DELETED",
      resourceType: "template",
      resourceId: id,
      beforeData: { name: existing.name, status: existing.status },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });
  },
};
