/** Template Part data access (Phase 1 — docs/control-center-replacement-roadmap.md). Organization-scoped, same findByIdInOrg-only convention as templateRepository.ts. */
import type { TemplatePart, Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import { normalizeRegions } from "../utils/templateStructure";
import { collectTemplatePartIds } from "../utils/editorBlockRefs";

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

  /** Which of `ids` are real, non-deleted template parts in this organization (Phase 4 — publish-time broken-reference validation). */
  async findManyByIdsInOrg(ids: string[], organizationId: string): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const rows = await prisma.templatePart.findMany({ where: { id: { in: ids }, organizationId, deletedAt: null }, select: { id: true } });
    return new Set(rows.map((r) => r.id));
  },

  /**
   * Phase 4 — dependency awareness: every Template whose current revision's
   * `structure.regions` assigns this part to a region, and every Page whose
   * current revision's editorBlocks contains a `templatePart` block
   * referencing it. Organization-scoped sets are small in practice (a
   * handful of templates/parts per org), so this scans in application code
   * rather than attempting a JSONB containment query — same tradeoff
   * templateRepository/pageRepository already make elsewhere in this phase.
   */
  async findUsage(partId: string, organizationId: string): Promise<{ templates: { id: string; name: string; slug: string; status: string }[]; pages: { id: string; title: string; slug: string; status: string }[] }> {
    const [templates, pages] = await Promise.all([
      prisma.template.findMany({ where: { organizationId, deletedAt: null }, include: { currentRevision: true } }),
      prisma.page.findMany({ where: { organizationId, deletedAt: null }, include: { currentRevision: true } }),
    ]);

    const usingTemplates = templates.filter((t) => normalizeRegions(t.currentRevision?.structure).some((r) => r.templatePartId === partId));
    const usingPages = pages.filter((p) => collectTemplatePartIds(p.currentRevision?.editorBlocks).includes(partId));

    return {
      templates: usingTemplates.map((t) => ({ id: t.id, name: t.name, slug: t.slug, status: t.status })),
      pages: usingPages.map((p) => ({ id: p.id, title: p.title, slug: p.slug, status: p.status })),
    };
  },

  async softDelete(id: string): Promise<void> {
    await prisma.templatePart.update({ where: { id }, data: { deletedAt: new Date() } });
  },
};
