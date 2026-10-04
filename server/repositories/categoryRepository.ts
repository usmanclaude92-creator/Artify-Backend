/** Category data access (Phase 8 — docs/CMS_ARCHITECTURE.md). Organization-scoped, findByIdInOrg-only convention. */
import type { Category, Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 150);
}

// Phase 7 — category hierarchy + usage counts for the Content Organization
// UI. `postCount` powers both "Prevent accidental deletion of terms in
// use" (categoryService checks it before deleting) and the plain display
// count every CMS category list shows.
export type CategoryWithCounts = Category & { postCount: number; parent: Pick<Category, "id" | "name" | "slug"> | null };

export const categoryRepository = {
  async list(organizationId: string): Promise<CategoryWithCounts[]> {
    const rows = await prisma.category.findMany({
      where: { organizationId },
      orderBy: { name: "asc" },
      include: { _count: { select: { posts: true } }, parent: { select: { id: true, name: true, slug: true } } },
    });
    return rows.map(({ _count, ...c }) => ({ ...c, postCount: _count.posts }));
  },

  async findByIdInOrg(id: string, organizationId: string): Promise<Category | null> {
    return prisma.category.findFirst({ where: { id, organizationId } });
  },

  async findBySlugInOrg(organizationId: string, slug: string): Promise<Category | null> {
    return prisma.category.findFirst({ where: { organizationId, slug } });
  },

  async findUniqueSlugInOrg(organizationId: string, base: string): Promise<string> {
    const baseSlug = slugify(base) || "category";
    let slug = baseSlug;
    let attempt = 1;
    while (await this.findBySlugInOrg(organizationId, slug)) {
      attempt += 1;
      slug = `${baseSlug}-${attempt}`;
      if (attempt > 50) break;
    }
    return slug;
  },

  /** Phase 7 — this category's own parentId, org-scoped (for cycle-checking a reparent), mirrors pageRepository.findParentId. */
  async findParentId(id: string, organizationId: string): Promise<string | null> {
    const row = await prisma.category.findFirst({ where: { id, organizationId }, select: { parentId: true } });
    return row?.parentId ?? null;
  },

  /** Phase 7 — how many posts currently reference this category, for the delete-in-use guard. */
  async countPostsUsing(id: string): Promise<number> {
    return prisma.post.count({ where: { categoryId: id, deletedAt: null } });
  },

  async create(data: { organizationId: string; name: string; slug: string; description?: string; parentId?: string }): Promise<Category> {
    return prisma.category.create({ data });
  },

  async update(id: string, data: Prisma.CategoryUpdateInput): Promise<Category> {
    return prisma.category.update({ where: { id }, data });
  },

  async delete(id: string): Promise<void> {
    await prisma.category.delete({ where: { id } });
  },
};
