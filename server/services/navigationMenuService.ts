/**
 * Navigation Menu management (Phase 5). Mirrors templatePartService.ts's
 * draft/publish/revision/system-protection architecture exactly — see
 * that file's header comment for the shared rationale. Two differences
 * from TemplatePart: (1) `items` is a real structured tree validated by
 * navigationMenuSchemas.ts rather than free-form JSON, so publishing
 * additionally verifies every item's link target still resolves (mirrors
 * templateService's assertRegionsResolvable for Template regions); (2)
 * delete-protection scans TemplatePart/Page content for a `navigationMenu`
 * block the same way Phase 4 added for TemplatePart usage.
 */
import { navigationMenuRepository, type NavigationMenuWithRevision } from "../repositories/navigationMenuRepository";
import { pageRepository } from "../repositories/pageRepository";
import { postRepository } from "../repositories/postRepository";
import { categoryRepository } from "../repositories/categoryRepository";
import { tagRepository } from "../repositories/tagRepository";
import { productRepository } from "../repositories/productRepository";
import { auditLogRepository } from "../repositories/auditLogRepository";
import { prisma } from "../db/prisma";
import { AuthorizationError, ConflictError, NotFoundError, ValidationError } from "../core/errors";
import type { SanitizedUser } from "../types/domain";
import type {
  CreateNavigationMenuInput,
  UpdateNavigationMenuInput,
  DuplicateNavigationMenuInput,
  RevertNavigationMenuInput,
  ListNavigationMenusQuery,
  MenuItemInput,
} from "../schemas/navigationMenuSchemas";
import type { RequestMeta } from "./authService";
import type { Prisma } from "@prisma/client";

function isUniqueConstraintError(err: unknown): boolean {
  return !!err && typeof err === "object" && "code" in err && (err as { code?: string }).code === "P2002";
}

async function loadMenuOrThrow(id: string, organizationId: string): Promise<NavigationMenuWithRevision> {
  const menu = await navigationMenuRepository.findByIdInOrg(id, organizationId);
  if (!menu) throw new NotFoundError("Navigation menu not found.");
  return menu;
}

function assertNotSystem(menu: { isSystem: boolean }, action: string): void {
  if (menu.isSystem) {
    throw new AuthorizationError(`This is a protected system navigation menu and cannot be ${action}.`);
  }
}

function flattenItems(items: unknown): MenuItemInput[] {
  if (!Array.isArray(items)) return [];
  const out: MenuItemInput[] = [];
  const walk = (list: unknown[]) => {
    for (const raw of list) {
      if (!raw || typeof raw !== "object") continue;
      const item = raw as MenuItemInput;
      out.push(item);
      if (Array.isArray(item.children)) walk(item.children);
    }
  };
  walk(items as unknown[]);
  return out;
}

/** Publish-time validation: every item's link target must still resolve within this organization (custom URLs are exempt — already required by the schema). */
async function assertItemsResolvable(organizationId: string, items: unknown): Promise<void> {
  const flat = flattenItems(items);
  const brokenLabels: string[] = [];

  for (const item of flat) {
    if (item.linkType === "custom") continue;
    if (!item.targetId) {
      brokenLabels.push(item.label);
      continue;
    }
    let resolved: unknown = null;
    switch (item.linkType) {
      case "page":
        resolved = await pageRepository.findByIdInOrg(item.targetId, organizationId);
        break;
      case "post":
        resolved = await postRepository.findByIdInOrg(item.targetId, organizationId);
        break;
      case "category":
        resolved = await categoryRepository.findByIdInOrg(item.targetId, organizationId);
        break;
      case "tag":
        resolved = await tagRepository.findByIdInOrg(item.targetId, organizationId);
        break;
      case "product":
        resolved = await productRepository.findById(item.targetId);
        break;
    }
    if (!resolved) brokenLabels.push(item.label);
  }

  if (brokenLabels.length > 0) {
    throw new ValidationError(
      `This menu has ${brokenLabels.length} item(s) with a broken link target (${brokenLabels.slice(0, 5).join(", ")}${brokenLabels.length > 5 ? ", …" : ""}). Fix or remove them before publishing.`
    );
  }
}

export const navigationMenuService = {
  async listMenus(organizationId: string, filters: Pick<ListNavigationMenusQuery, "search" | "status" | "type">, page: number, limit: number, sort: string, order: "asc" | "desc") {
    return navigationMenuRepository.list(organizationId, filters, page, limit, sort, order);
  },

  async getMenu(organizationId: string, id: string): Promise<NavigationMenuWithRevision> {
    return loadMenuOrThrow(id, organizationId);
  },

  async listRevisions(organizationId: string, id: string) {
    await loadMenuOrThrow(id, organizationId);
    return navigationMenuRepository.listRevisions(id);
  },

  async getUsage(organizationId: string, id: string) {
    await loadMenuOrThrow(id, organizationId);
    return navigationMenuRepository.findUsage(id, organizationId);
  },

  async createMenu(caller: SanitizedUser, input: CreateNavigationMenuInput, meta: RequestMeta = {}): Promise<NavigationMenuWithRevision> {
    const organizationId = caller.organizationId;

    if (input.slug) {
      const dup = await navigationMenuRepository.findBySlugInOrg(organizationId, input.slug);
      if (dup) throw new ConflictError(`A navigation menu with slug "${input.slug}" already exists.`, { existingNavigationMenuId: dup.id });
    }
    const slug = input.slug ?? (await navigationMenuRepository.findUniqueSlugInOrg(organizationId, input.name));

    let createdId: string;
    try {
      createdId = await prisma.$transaction(async (tx) => {
        const menu = await tx.navigationMenu.create({
          data: { organizationId, type: input.type, name: input.name, slug, status: "DRAFT", createdById: caller.id },
        });
        const revision = await tx.navigationMenuRevision.create({
          data: {
            navigationMenuId: menu.id,
            version: 1,
            status: "DRAFT",
            name: input.name,
            items: input.items as unknown as Prisma.InputJsonValue,
            createdById: caller.id,
          },
        });
        await tx.navigationMenu.update({ where: { id: menu.id }, data: { currentRevisionId: revision.id } });
        return menu.id;
      });
    } catch (err) {
      throw isUniqueConstraintError(err) ? new ConflictError("A navigation menu with this slug already exists.") : err;
    }

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "NAVIGATION_MENU_CREATED",
      resourceType: "navigation_menu",
      resourceId: createdId,
      afterData: { name: input.name, slug, type: input.type },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return loadMenuOrThrow(createdId, organizationId);
  },

  async updateMenu(caller: SanitizedUser, id: string, input: UpdateNavigationMenuInput, meta: RequestMeta = {}): Promise<NavigationMenuWithRevision> {
    const organizationId = caller.organizationId;
    const existing = await loadMenuOrThrow(id, organizationId);
    assertNotSystem(existing, "edited");

    const hasContentEdit = input.name !== undefined || input.slug !== undefined || input.items !== undefined;

    if (input.slug !== undefined && input.slug !== existing.slug) {
      const dup = await navigationMenuRepository.findBySlugInOrg(organizationId, input.slug);
      if (dup && dup.id !== id) throw new ConflictError(`A navigation menu with slug "${input.slug}" already exists.`, { existingNavigationMenuId: dup.id });
    }

    const currentRevision = existing.currentRevision;

    try {
      await prisma.$transaction(async (tx) => {
        const menuPatch: Record<string, unknown> = {};
        if (input.name !== undefined) menuPatch.name = input.name;
        if (input.slug !== undefined) menuPatch.slug = input.slug;

        if (currentRevision && hasContentEdit && currentRevision.status === "PUBLISHED") {
          const newRevision = await tx.navigationMenuRevision.create({
            data: {
              navigationMenuId: id,
              version: currentRevision.version + 1,
              status: "DRAFT",
              name: input.name ?? currentRevision.name,
              items: (input.items ?? currentRevision.items) as unknown as Prisma.InputJsonValue,
              createdById: caller.id,
            },
          });
          menuPatch.currentRevisionId = newRevision.id;
        } else if (hasContentEdit && currentRevision) {
          const revisionPatch: Record<string, unknown> = {};
          if (input.name !== undefined) revisionPatch.name = input.name;
          if (input.items !== undefined) revisionPatch.items = input.items as unknown as Prisma.InputJsonValue;
          if (Object.keys(revisionPatch).length > 0) {
            await tx.navigationMenuRevision.update({ where: { id: currentRevision.id }, data: revisionPatch });
          }
        }

        if (hasContentEdit && Object.keys(menuPatch).length === 0) {
          menuPatch.updatedAt = new Date();
        }

        if (Object.keys(menuPatch).length > 0) {
          const where: Prisma.NavigationMenuWhereInput = { id, ...(input.expectedUpdatedAt !== undefined ? { updatedAt: input.expectedUpdatedAt } : {}) };
          const result = await tx.navigationMenu.updateMany({ where, data: menuPatch });
          if (result.count === 0) {
            throw new ConflictError("This navigation menu was changed by someone else since you loaded it. Reload and try again.");
          }
        }
      });
    } catch (err) {
      throw isUniqueConstraintError(err) ? new ConflictError("A navigation menu with this slug already exists.") : err;
    }

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "NAVIGATION_MENU_UPDATED",
      resourceType: "navigation_menu",
      resourceId: id,
      beforeData: { name: existing.name, slug: existing.slug },
      afterData: { name: input.name, slug: input.slug },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return loadMenuOrThrow(id, organizationId);
  },

  async publishMenu(caller: SanitizedUser, id: string, meta: RequestMeta = {}): Promise<NavigationMenuWithRevision> {
    const organizationId = caller.organizationId;
    const existing = await loadMenuOrThrow(id, organizationId);
    assertNotSystem(existing, "published");

    if (existing.status === "ARCHIVED") throw new ConflictError("An archived navigation menu must be restored before it can be published.");
    if (!existing.currentRevisionId) throw new ConflictError("This navigation menu has no revision to publish.");

    await assertItemsResolvable(organizationId, existing.currentRevision?.items);

    const now = new Date();
    await prisma.$transaction([
      prisma.navigationMenuRevision.update({ where: { id: existing.currentRevisionId }, data: { status: "PUBLISHED", publishedAt: now } }),
      prisma.navigationMenu.update({ where: { id }, data: { status: "PUBLISHED" } }),
    ]);

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "NAVIGATION_MENU_PUBLISHED",
      resourceType: "navigation_menu",
      resourceId: id,
      beforeData: { status: existing.status },
      afterData: { status: "PUBLISHED" },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return loadMenuOrThrow(id, organizationId);
  },

  async archiveMenu(caller: SanitizedUser, id: string, meta: RequestMeta = {}): Promise<NavigationMenuWithRevision> {
    const organizationId = caller.organizationId;
    const existing = await loadMenuOrThrow(id, organizationId);
    assertNotSystem(existing, "archived");

    if (existing.status === "ARCHIVED") throw new ConflictError("This navigation menu is already archived.");

    await prisma.navigationMenu.update({ where: { id }, data: { status: "ARCHIVED" } });

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "NAVIGATION_MENU_ARCHIVED",
      resourceType: "navigation_menu",
      resourceId: id,
      beforeData: { status: existing.status },
      afterData: { status: "ARCHIVED" },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return loadMenuOrThrow(id, organizationId);
  },

  async revertMenu(caller: SanitizedUser, id: string, input: RevertNavigationMenuInput, meta: RequestMeta = {}): Promise<NavigationMenuWithRevision> {
    const organizationId = caller.organizationId;
    const existing = await loadMenuOrThrow(id, organizationId);
    assertNotSystem(existing, "rolled back");

    const target = await prisma.navigationMenuRevision.findFirst({ where: { id: input.revisionId, navigationMenuId: id } });
    if (!target) throw new NotFoundError("Revision not found on this navigation menu.");

    const current = existing.currentRevision;
    const nextVersion = (current?.version ?? 0) + 1;
    const wasPublished = existing.status === "PUBLISHED";

    await prisma.$transaction(async (tx) => {
      const newRevision = await tx.navigationMenuRevision.create({
        data: {
          navigationMenuId: id,
          version: nextVersion,
          status: wasPublished ? "PUBLISHED" : "DRAFT",
          name: target.name,
          items: target.items as Prisma.InputJsonValue,
          createdById: caller.id,
          publishedAt: wasPublished ? new Date() : null,
        },
      });
      await tx.navigationMenu.update({ where: { id }, data: { currentRevisionId: newRevision.id } });
    });

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "NAVIGATION_MENU_REVERTED",
      resourceType: "navigation_menu",
      resourceId: id,
      beforeData: { fromVersion: current?.version, revertedToRevisionId: target.id, revertedToVersion: target.version },
      afterData: { newVersion: nextVersion },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return loadMenuOrThrow(id, organizationId);
  },

  async duplicateMenu(caller: SanitizedUser, id: string, input: DuplicateNavigationMenuInput, meta: RequestMeta = {}): Promise<NavigationMenuWithRevision> {
    const organizationId = caller.organizationId;
    const existing = await loadMenuOrThrow(id, organizationId);

    const baseName = input.name ?? `${existing.name} (Copy)`;
    const slug = await navigationMenuRepository.findUniqueSlugInOrg(organizationId, baseName);
    const sourceItems = existing.currentRevision?.items ?? [];

    const createdId = await prisma.$transaction(async (tx) => {
      const menu = await tx.navigationMenu.create({
        data: { organizationId, type: existing.type, name: baseName, slug, status: "DRAFT", isSystem: false, createdById: caller.id },
      });
      const revision = await tx.navigationMenuRevision.create({
        data: { navigationMenuId: menu.id, version: 1, status: "DRAFT", name: baseName, items: sourceItems as Prisma.InputJsonValue, createdById: caller.id },
      });
      await tx.navigationMenu.update({ where: { id: menu.id }, data: { currentRevisionId: revision.id } });
      return menu.id;
    });

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "NAVIGATION_MENU_DUPLICATED",
      resourceType: "navigation_menu",
      resourceId: createdId,
      afterData: { duplicatedFromId: id, name: baseName },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return loadMenuOrThrow(createdId, organizationId);
  },

  async deleteMenu(caller: SanitizedUser, id: string, meta: RequestMeta = {}): Promise<void> {
    const organizationId = caller.organizationId;
    const existing = await loadMenuOrThrow(id, organizationId);
    assertNotSystem(existing, "deleted");

    const usage = await navigationMenuRepository.findUsage(id, organizationId);
    if (usage.templateParts.length > 0 || usage.pages.length > 0) {
      const names = [...usage.templateParts.map((p) => p.name), ...usage.pages.map((p) => p.title)];
      throw new ValidationError(
        `This navigation menu is still used by ${names.length} item(s) (${names.slice(0, 5).join(", ")}${names.length > 5 ? ", …" : ""}). Remove those references before deleting it.`
      );
    }

    await navigationMenuRepository.softDelete(id);

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "NAVIGATION_MENU_DELETED",
      resourceType: "navigation_menu",
      resourceId: id,
      beforeData: { name: existing.name, status: existing.status },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });
  },
};
