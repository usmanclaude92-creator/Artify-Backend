/** Phase 10 (Products + Services + Solutions) — platform-global industry taxonomy, used for Solution <-> Industry tagging. No organization scoping, same convention as productCategoryRepository.ts. */
import type { Industry, Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 100);
}

export const industryRepository = {
  async list(search?: string): Promise<Industry[]> {
    return prisma.industry.findMany({
      where: search ? { name: { contains: search, mode: "insensitive" } } : undefined,
      orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
    });
  },

  async findById(id: string): Promise<Industry | null> {
    return prisma.industry.findUnique({ where: { id } });
  },

  async findBySlug(slug: string): Promise<Industry | null> {
    return prisma.industry.findUnique({ where: { slug } });
  },

  async findManyByIds(ids: string[]): Promise<Industry[]> {
    if (ids.length === 0) return [];
    return prisma.industry.findMany({ where: { id: { in: ids } } });
  },

  async findUniqueSlug(base: string): Promise<string> {
    const baseSlug = slugify(base) || "industry";
    let slug = baseSlug;
    let attempt = 1;
    while (await this.findBySlug(slug)) {
      attempt += 1;
      slug = `${baseSlug}-${attempt}`;
      if (attempt > 50) break;
    }
    return slug;
  },

  async create(data: { slug: string; name: string; description?: string; displayOrder?: number }): Promise<Industry> {
    return prisma.industry.create({ data });
  },

  async update(id: string, data: Prisma.IndustryUpdateInput): Promise<Industry> {
    return prisma.industry.update({ where: { id }, data });
  },

  async countProducts(id: string): Promise<number> {
    return prisma.productIndustry.count({ where: { industryId: id } });
  },

  async delete(id: string): Promise<void> {
    await prisma.industry.delete({ where: { id } });
  },
};
