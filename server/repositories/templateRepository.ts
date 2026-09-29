/** Template data access (Phase 1 — docs/control-center-replacement-roadmap.md). Organization-scoped, same findByIdInOrg-only convention as pageRepository.ts. */
import type { Template, Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";

export interface TemplateFilters {
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

const withUsage = {
  include: {
    currentRevision: true,
    _count: { select: { pages: true } },
  },
} as const;
export type TemplateWithUsage = Prisma.TemplateGetPayload<typeof withUsage>;

function buildWhere(organizationId: string, filters: TemplateFilters): Prisma.TemplateWhereInput {
  const where: Prisma.TemplateWhereInput = { organizationId, deletedAt: null };
  if (filters.status) where.status = filters.status as Prisma.EnumContentStatusFilter["equals"];
  if (filters.type) where.type = filters.type as Prisma.EnumTemplateTypeFilter["equals"];
  if (filters.search) {
    where.OR = [{ name: { contains: filters.search, mode: "insensitive" } }, { slug: { contains: filters.search, mode: "insensitive" } }];
  }
  return where;
}

export const templateRepository = {
  async list(organizationId: string, filters: TemplateFilters, page: number, limit: number, sort: string, order: "asc" | "desc") {
    const where = buildWhere(organizationId, filters);
    const [rows, total] = await Promise.all([
      prisma.template.findMany({ where, orderBy: { [sort]: order }, skip: (page - 1) * limit, take: limit, ...withUsage }),
      prisma.template.count({ where }),
    ]);
    return { rows, total };
  },

  async findByIdInOrg(id: string, organizationId: string): Promise<TemplateWithUsage | null> {
    return prisma.template.findFirst({ where: { id, organizationId, deletedAt: null }, ...withUsage });
  },

  async findBySlugInOrg(organizationId: string, slug: string): Promise<Template | null> {
    return prisma.template.findFirst({ where: { organizationId, slug, deletedAt: null } });
  },

  /** Only PUBLISHED, non-deleted templates may be assigned to a page (pageService's job to enforce). */
  async findPublishedByIdInOrg(id: string, organizationId: string): Promise<Template | null> {
    return prisma.template.findFirst({ where: { id, organizationId, status: "PUBLISHED", deletedAt: null } });
  },

  async findUniqueSlugInOrg(organizationId: string, base: string): Promise<string> {
    const baseSlug = slugify(base) || "template";
    let slug = baseSlug;
    let attempt = 1;
    while (await this.findBySlugInOrg(organizationId, slug)) {
      attempt += 1;
      slug = `${baseSlug}-${attempt}`;
      if (attempt > 50) break;
    }
    return slug;
  },

  async listRevisions(templateId: string) {
    return prisma.templateRevision.findMany({ where: { templateId }, orderBy: { version: "desc" } });
  },

  async softDelete(id: string): Promise<void> {
    await prisma.template.update({ where: { id }, data: { deletedAt: new Date() } });
  },
};
