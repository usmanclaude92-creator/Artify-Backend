/** Phase 10 (Products + Services + Solutions) — platform-global catalog category taxonomy management. */
import { productCategoryRepository } from "../repositories/productCategoryRepository";
import { auditLogRepository } from "../repositories/auditLogRepository";
import { ConflictError, NotFoundError } from "../core/errors";
import type { SanitizedUser } from "../types/domain";
import type { CreateProductCategoryInput, UpdateProductCategoryInput } from "../schemas/productCategorySchemas";
import type { RequestMeta } from "./authService";
import type { ProductCategory } from "@prisma/client";

function isUniqueConstraintError(err: unknown): boolean {
  return !!err && typeof err === "object" && "code" in err && (err as { code?: string }).code === "P2002";
}

async function loadOrThrow(id: string): Promise<ProductCategory> {
  const category = await productCategoryRepository.findById(id);
  if (!category) throw new NotFoundError("Product category not found.");
  return category;
}

export const productCategoryService = {
  async list(search?: string): Promise<ProductCategory[]> {
    return productCategoryRepository.list(search);
  },

  async create(caller: SanitizedUser, input: CreateProductCategoryInput, meta: RequestMeta = {}): Promise<ProductCategory> {
    let slug: string;
    if (input.slug) {
      const existing = await productCategoryRepository.findBySlug(input.slug);
      if (existing) throw new ConflictError(`A category with slug "${input.slug}" already exists.`);
      slug = input.slug;
    } else {
      slug = await productCategoryRepository.findUniqueSlug(input.name);
    }

    let category: ProductCategory;
    try {
      category = await productCategoryRepository.create({ slug, name: input.name, description: input.description, displayOrder: input.displayOrder });
    } catch (err) {
      throw isUniqueConstraintError(err) ? new ConflictError("A category with this slug already exists.") : err;
    }

    await auditLogRepository.record({
      actorUserId: caller.id,
      actorType: "USER",
      action: "PRODUCT_CATEGORY_CREATED",
      resourceType: "product_category",
      resourceId: category.id,
      afterData: { name: category.name, slug: category.slug },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return category;
  },

  async update(caller: SanitizedUser, id: string, input: UpdateProductCategoryInput, meta: RequestMeta = {}): Promise<ProductCategory> {
    const existing = await loadOrThrow(id);
    if (input.slug !== undefined && input.slug !== existing.slug) {
      const dup = await productCategoryRepository.findBySlug(input.slug);
      if (dup && dup.id !== id) throw new ConflictError(`A category with slug "${input.slug}" already exists.`);
    }

    let updated: ProductCategory;
    try {
      updated = await productCategoryRepository.update(id, input);
    } catch (err) {
      throw isUniqueConstraintError(err) ? new ConflictError("A category with this slug already exists.") : err;
    }

    await auditLogRepository.record({
      actorUserId: caller.id,
      actorType: "USER",
      action: "PRODUCT_CATEGORY_UPDATED",
      resourceType: "product_category",
      resourceId: id,
      beforeData: { name: existing.name, slug: existing.slug },
      afterData: input,
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return updated;
  },

  async delete(caller: SanitizedUser, id: string, meta: RequestMeta = {}): Promise<void> {
    const existing = await loadOrThrow(id);
    const productCount = await productCategoryRepository.countProducts(id);
    if (productCount > 0) {
      throw new ConflictError(`This category is assigned to ${productCount} product${productCount === 1 ? "" : "s"} — reassign them before deleting it.`);
    }
    await productCategoryRepository.delete(id);

    await auditLogRepository.record({
      actorUserId: caller.id,
      actorType: "USER",
      action: "PRODUCT_CATEGORY_DELETED",
      resourceType: "product_category",
      resourceId: id,
      beforeData: { name: existing.name, slug: existing.slug },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });
  },
};
