/**
 * Template Part management (Phase 1 — docs/control-center-replacement-roadmap.md).
 * Organization-scoped. Mirrors templateService.ts exactly — see that
 * file's header comment for the shared revision/workflow/system-part
 * protection rationale. Template Parts are referenced by id from a
 * Template revision's `structure` JSON (not a DB foreign key — that JSON
 * shape is deliberately unfixed this phase, see templateSchemas.ts), so
 * unlike Template's delete guard (blocked while Pages reference it via a
 * real FK), a Template Part's delete has no such DB-level reference to
 * check; reassigning/removing part references inside a template's
 * structure remains a Site Editor concern for a later phase.
 */
import { templatePartRepository, type TemplatePartWithRevision } from "../repositories/templatePartRepository";
import { auditLogRepository } from "../repositories/auditLogRepository";
import { sanitizeContentIfEditorDocument } from "../schemas/editorSchemas";
import { prisma } from "../db/prisma";
import { AuthorizationError, ConflictError, NotFoundError } from "../core/errors";
import type { SanitizedUser } from "../types/domain";
import type {
  CreateTemplatePartInput,
  UpdateTemplatePartInput,
  DuplicateTemplatePartInput,
  RevertTemplatePartInput,
  ListTemplatePartsQuery,
} from "../schemas/templateSchemas";
import type { RequestMeta } from "./authService";
import type { Prisma } from "@prisma/client";

function isUniqueConstraintError(err: unknown): boolean {
  return !!err && typeof err === "object" && "code" in err && (err as { code?: string }).code === "P2002";
}

async function loadTemplatePartOrThrow(id: string, organizationId: string): Promise<TemplatePartWithRevision> {
  const part = await templatePartRepository.findByIdInOrg(id, organizationId);
  if (!part) throw new NotFoundError("Template part not found.");
  return part;
}

function assertNotSystem(part: { isSystem: boolean }, action: string): void {
  if (part.isSystem) {
    throw new AuthorizationError(`This is a protected system template part and cannot be ${action}.`);
  }
}

export const templatePartService = {
  async listParts(organizationId: string, filters: Pick<ListTemplatePartsQuery, "search" | "status" | "type">, page: number, limit: number, sort: string, order: "asc" | "desc") {
    return templatePartRepository.list(organizationId, filters, page, limit, sort, order);
  },

  async getPart(organizationId: string, id: string): Promise<TemplatePartWithRevision> {
    return loadTemplatePartOrThrow(id, organizationId);
  },

  async listRevisions(organizationId: string, id: string) {
    await loadTemplatePartOrThrow(id, organizationId);
    return templatePartRepository.listRevisions(id);
  },

  async createPart(caller: SanitizedUser, input: CreateTemplatePartInput, meta: RequestMeta = {}): Promise<TemplatePartWithRevision> {
    const organizationId = caller.organizationId;

    if (input.slug) {
      const dup = await templatePartRepository.findBySlugInOrg(organizationId, input.slug);
      if (dup) throw new ConflictError(`A template part with slug "${input.slug}" already exists.`, { existingTemplatePartId: dup.id });
    }
    const slug = input.slug ?? (await templatePartRepository.findUniqueSlugInOrg(organizationId, input.name));
    const content = sanitizeContentIfEditorDocument(input.content);

    let createdId: string;
    try {
      createdId = await prisma.$transaction(async (tx) => {
        const part = await tx.templatePart.create({
          data: {
            organizationId,
            type: input.type,
            name: input.name,
            slug,
            status: "DRAFT",
            createdById: caller.id,
          },
        });
        const revision = await tx.templatePartRevision.create({
          data: {
            templatePartId: part.id,
            version: 1,
            status: "DRAFT",
            name: input.name,
            content: content as Prisma.InputJsonValue,
            createdById: caller.id,
          },
        });
        await tx.templatePart.update({ where: { id: part.id }, data: { currentRevisionId: revision.id } });
        return part.id;
      });
    } catch (err) {
      throw isUniqueConstraintError(err) ? new ConflictError("A template part with this slug already exists.") : err;
    }

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "TEMPLATE_PART_CREATED",
      resourceType: "template_part",
      resourceId: createdId,
      afterData: { name: input.name, slug, type: input.type },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return loadTemplatePartOrThrow(createdId, organizationId);
  },

  async updatePart(caller: SanitizedUser, id: string, input: UpdateTemplatePartInput, meta: RequestMeta = {}): Promise<TemplatePartWithRevision> {
    const organizationId = caller.organizationId;
    const existing = await loadTemplatePartOrThrow(id, organizationId);
    assertNotSystem(existing, "edited");

    const hasContentEdit = input.name !== undefined || input.slug !== undefined || input.content !== undefined;
    const sanitizedContent = input.content !== undefined ? sanitizeContentIfEditorDocument(input.content) : undefined;

    if (input.slug !== undefined && input.slug !== existing.slug) {
      const dup = await templatePartRepository.findBySlugInOrg(organizationId, input.slug);
      if (dup && dup.id !== id) throw new ConflictError(`A template part with slug "${input.slug}" already exists.`, { existingTemplatePartId: dup.id });
    }

    const currentRevision = existing.currentRevision;

    try {
      await prisma.$transaction(async (tx) => {
        const partPatch: Record<string, unknown> = {};
        if (input.name !== undefined) partPatch.name = input.name;
        if (input.slug !== undefined) partPatch.slug = input.slug;

        if (currentRevision && hasContentEdit && currentRevision.status === "PUBLISHED") {
          const newRevision = await tx.templatePartRevision.create({
            data: {
              templatePartId: id,
              version: currentRevision.version + 1,
              status: "DRAFT",
              name: input.name ?? currentRevision.name,
              content: (sanitizedContent ?? currentRevision.content) as Prisma.InputJsonValue,
              createdById: caller.id,
            },
          });
          partPatch.currentRevisionId = newRevision.id;
        } else if (hasContentEdit && currentRevision) {
          const revisionPatch: Record<string, unknown> = {};
          if (input.name !== undefined) revisionPatch.name = input.name;
          if (sanitizedContent !== undefined) revisionPatch.content = sanitizedContent as Prisma.InputJsonValue;
          if (Object.keys(revisionPatch).length > 0) {
            await tx.templatePartRevision.update({ where: { id: currentRevision.id }, data: revisionPatch });
          }
        }

        if (hasContentEdit && Object.keys(partPatch).length === 0) {
          partPatch.updatedAt = new Date();
        }

        if (Object.keys(partPatch).length > 0) {
          const where: Prisma.TemplatePartWhereInput = { id, ...(input.expectedUpdatedAt !== undefined ? { updatedAt: input.expectedUpdatedAt } : {}) };
          const result = await tx.templatePart.updateMany({ where, data: partPatch });
          if (result.count === 0) {
            throw new ConflictError("This template part was changed by someone else since you loaded it. Reload and try again.");
          }
        }
      });
    } catch (err) {
      throw isUniqueConstraintError(err) ? new ConflictError("A template part with this slug already exists.") : err;
    }

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "TEMPLATE_PART_UPDATED",
      resourceType: "template_part",
      resourceId: id,
      beforeData: { name: existing.name, slug: existing.slug },
      afterData: { name: input.name, slug: input.slug },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return loadTemplatePartOrThrow(id, organizationId);
  },

  async publishPart(caller: SanitizedUser, id: string, meta: RequestMeta = {}): Promise<TemplatePartWithRevision> {
    const organizationId = caller.organizationId;
    const existing = await loadTemplatePartOrThrow(id, organizationId);
    assertNotSystem(existing, "published");

    if (existing.status === "ARCHIVED") throw new ConflictError("An archived template part must be restored before it can be published.");
    if (!existing.currentRevisionId) throw new ConflictError("This template part has no revision to publish.");

    const now = new Date();
    await prisma.$transaction([
      prisma.templatePartRevision.update({ where: { id: existing.currentRevisionId }, data: { status: "PUBLISHED", publishedAt: now } }),
      prisma.templatePart.update({ where: { id }, data: { status: "PUBLISHED" } }),
    ]);

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "TEMPLATE_PART_PUBLISHED",
      resourceType: "template_part",
      resourceId: id,
      beforeData: { status: existing.status },
      afterData: { status: "PUBLISHED" },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return loadTemplatePartOrThrow(id, organizationId);
  },

  async archivePart(caller: SanitizedUser, id: string, meta: RequestMeta = {}): Promise<TemplatePartWithRevision> {
    const organizationId = caller.organizationId;
    const existing = await loadTemplatePartOrThrow(id, organizationId);
    assertNotSystem(existing, "archived");

    if (existing.status === "ARCHIVED") throw new ConflictError("This template part is already archived.");

    await prisma.templatePart.update({ where: { id }, data: { status: "ARCHIVED" } });

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "TEMPLATE_PART_ARCHIVED",
      resourceType: "template_part",
      resourceId: id,
      beforeData: { status: existing.status },
      afterData: { status: "ARCHIVED" },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return loadTemplatePartOrThrow(id, organizationId);
  },

  async revertPart(caller: SanitizedUser, id: string, input: RevertTemplatePartInput, meta: RequestMeta = {}): Promise<TemplatePartWithRevision> {
    const organizationId = caller.organizationId;
    const existing = await loadTemplatePartOrThrow(id, organizationId);
    assertNotSystem(existing, "rolled back");

    const target = await prisma.templatePartRevision.findFirst({ where: { id: input.revisionId, templatePartId: id } });
    if (!target) throw new NotFoundError("Revision not found on this template part.");

    const current = existing.currentRevision;
    const nextVersion = (current?.version ?? 0) + 1;
    const wasPublished = existing.status === "PUBLISHED";

    await prisma.$transaction(async (tx) => {
      const newRevision = await tx.templatePartRevision.create({
        data: {
          templatePartId: id,
          version: nextVersion,
          status: wasPublished ? "PUBLISHED" : "DRAFT",
          name: target.name,
          content: target.content as Prisma.InputJsonValue,
          createdById: caller.id,
          publishedAt: wasPublished ? new Date() : null,
        },
      });
      await tx.templatePart.update({ where: { id }, data: { currentRevisionId: newRevision.id } });
    });

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "TEMPLATE_PART_REVERTED",
      resourceType: "template_part",
      resourceId: id,
      beforeData: { fromVersion: current?.version, revertedToRevisionId: target.id, revertedToVersion: target.version },
      afterData: { newVersion: nextVersion },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return loadTemplatePartOrThrow(id, organizationId);
  },

  async duplicatePart(caller: SanitizedUser, id: string, input: DuplicateTemplatePartInput, meta: RequestMeta = {}): Promise<TemplatePartWithRevision> {
    const organizationId = caller.organizationId;
    const existing = await loadTemplatePartOrThrow(id, organizationId);

    const baseName = input.name ?? `${existing.name} (Copy)`;
    const slug = await templatePartRepository.findUniqueSlugInOrg(organizationId, baseName);
    const sourceContent = existing.currentRevision?.content ?? {};

    const createdId = await prisma.$transaction(async (tx) => {
      const part = await tx.templatePart.create({
        data: {
          organizationId,
          type: existing.type,
          name: baseName,
          slug,
          status: "DRAFT",
          isSystem: false,
          createdById: caller.id,
        },
      });
      const revision = await tx.templatePartRevision.create({
        data: {
          templatePartId: part.id,
          version: 1,
          status: "DRAFT",
          name: baseName,
          content: sourceContent as Prisma.InputJsonValue,
          createdById: caller.id,
        },
      });
      await tx.templatePart.update({ where: { id: part.id }, data: { currentRevisionId: revision.id } });
      return part.id;
    });

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "TEMPLATE_PART_DUPLICATED",
      resourceType: "template_part",
      resourceId: createdId,
      afterData: { duplicatedFromId: id, name: baseName },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return loadTemplatePartOrThrow(createdId, organizationId);
  },

  async deletePart(caller: SanitizedUser, id: string, meta: RequestMeta = {}): Promise<void> {
    const organizationId = caller.organizationId;
    const existing = await loadTemplatePartOrThrow(id, organizationId);
    assertNotSystem(existing, "deleted");

    await templatePartRepository.softDelete(id);

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "TEMPLATE_PART_DELETED",
      resourceType: "template_part",
      resourceId: id,
      beforeData: { name: existing.name, status: existing.status },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });
  },
};
