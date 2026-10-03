/** Navigation Menu data access (Phase 5). Mirrors templatePartRepository.ts's organization-scoped conventions exactly. */
import type { NavigationMenu, Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import { collectNavigationMenuIds } from "../utils/editorBlockRefs";

export interface NavigationMenuFilters {
  search?: string;
  status?: string;
  type?: string;
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 150);
}

const withCurrentRevision = { include: { currentRevision: true } } as const;
export type NavigationMenuWithRevision = Prisma.NavigationMenuGetPayload<typeof withCurrentRevision>;

function buildWhere(organizationId: string, filters: NavigationMenuFilters): Prisma.NavigationMenuWhereInput {
  const where: Prisma.NavigationMenuWhereInput = { organizationId, deletedAt: null };
  if (filters.status) where.status = filters.status as Prisma.EnumContentStatusFilter["equals"];
  if (filters.type) where.type = filters.type as Prisma.EnumNavigationMenuTypeFilter["equals"];
  if (filters.search) {
    where.OR = [{ name: { contains: filters.search, mode: "insensitive" } }, { slug: { contains: filters.search, mode: "insensitive" } }];
  }
  return where;
}

export const navigationMenuRepository = {
  async list(organizationId: string, filters: NavigationMenuFilters, page: number, limit: number, sort: string, order: "asc" | "desc") {
    const where = buildWhere(organizationId, filters);
    const [rows, total] = await Promise.all([
      prisma.navigationMenu.findMany({ where, orderBy: { [sort]: order }, skip: (page - 1) * limit, take: limit, ...withCurrentRevision }),
      prisma.navigationMenu.count({ where }),
    ]);
    return { rows, total };
  },

  async findByIdInOrg(id: string, organizationId: string): Promise<NavigationMenuWithRevision | null> {
    return prisma.navigationMenu.findFirst({ where: { id, organizationId, deletedAt: null }, ...withCurrentRevision });
  },

  async findBySlugInOrg(organizationId: string, slug: string): Promise<NavigationMenu | null> {
    return prisma.navigationMenu.findFirst({ where: { organizationId, slug, deletedAt: null } });
  },

  async findUniqueSlugInOrg(organizationId: string, base: string): Promise<string> {
    const baseSlug = slugify(base) || "menu";
    let slug = baseSlug;
    let attempt = 1;
    while (await this.findBySlugInOrg(organizationId, slug)) {
      attempt += 1;
      slug = `${baseSlug}-${attempt}`;
      if (attempt > 50) break;
    }
    return slug;
  },

  /** The most recently published menu of this type for an org — the "active" one a public consumer should render when several exist. */
  async findPublishedByTypeInOrg(organizationId: string, type: string): Promise<NavigationMenuWithRevision | null> {
    return prisma.navigationMenu.findFirst({
      where: { organizationId, type: type as Prisma.EnumNavigationMenuTypeFilter["equals"], status: "PUBLISHED", deletedAt: null },
      orderBy: { updatedAt: "desc" },
      ...withCurrentRevision,
    });
  },

  async listRevisions(navigationMenuId: string) {
    return prisma.navigationMenuRevision.findMany({ where: { navigationMenuId }, orderBy: { version: "desc" } });
  },

  /**
   * Phase 5 — dependency awareness, mirroring templatePartRepository's own
   * findUsage exactly: every TemplatePart and Page whose content contains a
   * `navigationMenu` block referencing this menu (same application-code
   * scan tradeoff — small per-org row counts).
   */
  async findUsage(menuId: string, organizationId: string): Promise<{ templateParts: { id: string; name: string; slug: string; status: string }[]; pages: { id: string; title: string; slug: string; status: string }[] }> {
    const [templateParts, pages] = await Promise.all([
      prisma.templatePart.findMany({ where: { organizationId, deletedAt: null }, include: { currentRevision: true } }),
      prisma.page.findMany({ where: { organizationId, deletedAt: null }, include: { currentRevision: true } }),
    ]);

    const usingParts = templateParts.filter((p) => collectNavigationMenuIds(p.currentRevision?.content).includes(menuId));
    const usingPages = pages.filter((p) => collectNavigationMenuIds(p.currentRevision?.editorBlocks).includes(menuId));

    return {
      templateParts: usingParts.map((p) => ({ id: p.id, name: p.name, slug: p.slug, status: p.status })),
      pages: usingPages.map((p) => ({ id: p.id, title: p.title, slug: p.slug, status: p.status })),
    };
  },

  async softDelete(id: string): Promise<void> {
    await prisma.navigationMenu.update({ where: { id }, data: { deletedAt: new Date() } });
  },
};
