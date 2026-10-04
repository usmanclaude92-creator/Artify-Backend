/** Phase 10 (Products + Services + Solutions) — platform-global catalog category taxonomy. No organization scoping, same convention as productRepository.ts. */
import type { ProductCategory, Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 100);
}

export const productCategoryRepository = {
  async list(search?: string): Promise<ProductCategory[]> {
    return prisma.productCategory.findMany({
      where: search ? { name: { contains: search, mode: "insensitive" } } : undefined,
      orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
    });
  },

  async findById(id: string): Promise<ProductCategory | null> {
    return prisma.productCategory.findUnique({ where: { id } });
  },

  async findBySlug(slug: string): Promise<ProductCategory | null> {
    return prisma.productCategory.findUnique({ where: { slug } });
  },

  async findManyByIds(ids: string[]): Promise<ProductCategory[]> {
    if (ids.length === 0) return [];
    return prisma.productCategory.findMany({ where: { id: { in: ids } } });
  },

  async findUniqueSlug(base: string): Promise<string> {
    const baseSlug = slugify(base) || "category";
    let slug = baseSlug;
    let attempt = 1;
    while (await this.findBySlug(slug)) {
      attempt += 1;
      slug = `${baseSlug}-${attempt}`;
      if (attempt > 50) break;
    }
    return slug;
  },

  async create(data: { slug: string; name: string; description?: string; displayOrder?: number }): Promise<ProductCategory> {
    return prisma.productCategory.create({ data });
  },

  async update(id: string, data: Prisma.ProductCategoryUpdateInput): Promise<ProductCategory> {
    return prisma.productCategory.update({ where: { id }, data });
  },

  async countProducts(id: string): Promise<number> {
    return prisma.product.count({ where: { categoryId: id } });
  },

  async delete(id: string): Promise<void> {
    await prisma.productCategory.delete({ where: { id } });
  },
};
