/** Template Part data access (Phase 1 — docs/control-center-replacement-roadmap.md). Organization-scoped, same findByIdInOrg-only convention as templateRepository.ts. */
import type { TemplatePart, Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";

export interface TemplatePartFilters {
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
export type TemplatePartWithRevision = Prisma.TemplatePartGetPayload<typeof withCurrentRevision>;

function buildWhere(organizationId: string, filters: TemplatePartFilters): Prisma.TemplatePartWhereInput {
  const where: Prisma.TemplatePartWhereInput = { organizationId, deletedAt: null };
  if (filters.status) where.status = filters.status as Prisma.EnumContentStatusFilter["equals"];
  if (filters.type) where.type = filters.type as Prisma.EnumTemplatePartTypeFilter["equals"];
  if (filters.search) {
    where.OR = [{ name: { contains: filters.search, mode: "insensitive" } }, { slug: { contains: filters.search, mode: "insensitive" } }];
  }
  return where;
}

export const templatePartRepository = {
  async list(organizationId: string, filters: TemplatePartFilters, page: number, limit: number, sort: string, order: "asc" | "desc") {
    const where = buildWhere(organizationId, filters);
    const [rows, total] = await Promise.all([
      prisma.templatePart.findMany({ where, orderBy: { [sort]: order }, skip: (page - 1) * limit, take: limit, ...withCurrentRevision }),
      prisma.templatePart.count({ where }),
    ]);
    return { rows, total };
  },

  async findByIdInOrg(id: string, organizationId: string): Promise<TemplatePartWithRevision | null> {
    return prisma.templatePart.findFirst({ where: { id, organizationId, deletedAt: null }, ...withCurrentRevision });
  },

  async findBySlugInOrg(organizationId: string, slug: string): Promise<TemplatePart | null> {
    return prisma.templatePart.findFirst({ where: { organizationId, slug, deletedAt: null } });
  },

  async findPublishedByIdInOrg(id: string, organizationId: string): Promise<TemplatePart | null> {
    return prisma.templatePart.findFirst({ where: { id, organizationId, status: "PUBLISHED", deletedAt: null } });
  },

  async findUniqueSlugInOrg(organizationId: string, base: string): Promise<string> {
    const baseSlug = slugify(base) || "part";
    let slug = baseSlug;
    let attempt = 1;
    while (await this.findBySlugInOrg(organizationId, slug)) {
      attempt += 1;
      slug = `${baseSlug}-${attempt}`;
      if (attempt > 50) break;
    }
    return slug;
  },

  async listRevisions(templatePartId: string) {
    return prisma.templatePartRevision.findMany({ where: { templatePartId }, orderBy: { version: "desc" } });
  },

  async softDelete(id: string): Promise<void> {
    await prisma.templatePart.update({ where: { id }, data: { deletedAt: new Date() } });
  },
};
