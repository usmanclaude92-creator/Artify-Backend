/** Category management (Phase 8 — docs/CMS_ARCHITECTURE.md). Organization-scoped, mirrors leadService.ts's tenant-isolation shape. */
import { categoryRepository, type CategoryWithCounts } from "../repositories/categoryRepository";
import { auditLogRepository } from "../repositories/auditLogRepository";
import { ConflictError, NotFoundError, ValidationError } from "../core/errors";
import type { SanitizedUser } from "../types/domain";
import type { CreateCategoryInput, UpdateCategoryInput } from "../schemas/contentSchemas";
import type { RequestMeta } from "./authService";
import type { Category } from "@prisma/client";

function isUniqueConstraintError(err: unknown): boolean {
  return !!err && typeof err === "object" && "code" in err && (err as { code?: string }).code === "P2002";
}

async function loadCategoryOrThrow(id: string, organizationId: string): Promise<Category> {
  const category = await categoryRepository.findByIdInOrg(id, organizationId);
  if (!category) throw new NotFoundError("Category not found.");
  return category;
}

// Phase 7 — category hierarchy: a parent must be a real category in this
// same organization, cannot be the category itself, and cannot be one of
// its own descendants (which would create a cycle) — identical shape to
// pageService's assertParentUsable, checked by walking up from the
// candidate parent's own ancestor chain looking for `selfId`.
async function assertParentUsable(parentId: string | null | undefined, organizationId: string, selfId?: string): Promise<void> {
  if (!parentId) return;
  if (parentId === selfId) throw new ValidationError("A category cannot be its own parent.");
  const parent = await categoryRepository.findByIdInOrg(parentId, organizationId);
  if (!parent) throw new ValidationError("parentId must refer to another category in this organization.");

  if (selfId) {
    let cursor = parent.parentId;
    let guard = 0;
    while (cursor && guard < 100) {
      if (cursor === selfId) throw new ValidationError("Assigning this parent would create a circular category hierarchy.");
      cursor = await categoryRepository.findParentId(cursor, organizationId);
      guard += 1;
    }
  }
}

export const categoryService = {
  async listCategories(organizationId: string): Promise<CategoryWithCounts[]> {
    return categoryRepository.list(organizationId);
  },

  async getCategory(organizationId: string, id: string): Promise<Category> {
    return loadCategoryOrThrow(id, organizationId);
  },

  async createCategory(caller: SanitizedUser, input: CreateCategoryInput, meta: RequestMeta = {}): Promise<Category> {
    const organizationId = caller.organizationId;
    if (input.slug) {
      const dup = await categoryRepository.findBySlugInOrg(organizationId, input.slug);
      if (dup) throw new ConflictError(`A category with slug "${input.slug}" already exists.`, { existingCategoryId: dup.id });
    }
    await assertParentUsable(input.parentId, organizationId);
    const slug = input.slug ?? (await categoryRepository.findUniqueSlugInOrg(organizationId, input.name));

    let category: Category;
    try {
      category = await categoryRepository.create({ organizationId, name: input.name, slug, description: input.description, parentId: input.parentId });
    } catch (err) {
      throw isUniqueConstraintError(err) ? new ConflictError("A category with this slug already exists.") : err;
    }

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "CATEGORY_CREATED",
      resourceType: "category",
      resourceId: category.id,
      afterData: { name: category.name, slug: category.slug },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return category;
  },

  async updateCategory(caller: SanitizedUser, id: string, input: UpdateCategoryInput, meta: RequestMeta = {}): Promise<Category> {
    const organizationId = caller.organizationId;
    const existing = await loadCategoryOrThrow(id, organizationId);

    if (input.slug !== undefined && input.slug !== existing.slug) {
      const dup = await categoryRepository.findBySlugInOrg(organizationId, input.slug);
      if (dup && dup.id !== id) throw new ConflictError(`A category with slug "${input.slug}" already exists.`, { existingCategoryId: dup.id });
    }
    if (input.parentId !== undefined) await assertParentUsable(input.parentId, organizationId, id);

    const patch: Record<string, unknown> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.slug !== undefined) patch.slug = input.slug;
    if (input.description !== undefined) patch.description = input.description;
    if (input.parentId !== undefined) patch.parentId = input.parentId;

    let updated: Category;
    try {
      updated = await categoryRepository.update(id, patch);
    } catch (err) {
      throw isUniqueConstraintError(err) ? new ConflictError("A category with this slug already exists.") : err;
    }

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "CATEGORY_UPDATED",
      resourceType: "category",
      resourceId: id,
      beforeData: { name: existing.name, slug: existing.slug },
      afterData: patch,
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return updated;
  },

  async deleteCategory(caller: SanitizedUser, id: string, meta: RequestMeta = {}): Promise<void> {
    const organizationId = caller.organizationId;
    const existing = await loadCategoryOrThrow(id, organizationId);

    // Phase 7 — "Prevent accidental deletion of terms/content in use":
    // mirrors templatePartService.deletePart's hard block, so a category
    // still assigned to posts can't be silently removed out from under
    // them (Post.categoryId would otherwise just go null via SetNull).
    const postCount = await categoryRepository.countPostsUsing(id);
    if (postCount > 0) {
      throw new ValidationError(`This category is still assigned to ${postCount} post(s). Reassign or remove them before deleting it.`);
    }

    await categoryRepository.delete(id);

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "CATEGORY_DELETED",
      resourceType: "category",
      resourceId: id,
      beforeData: { name: existing.name, slug: existing.slug },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });
  },
};
