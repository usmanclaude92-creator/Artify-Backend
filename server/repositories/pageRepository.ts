/** Page data access (Phase 8 — docs/CMS_ARCHITECTURE.md). Organization-scoped, same findByIdInOrg-only convention as leadRepository.ts. */
import type { Page, Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";

export interface PageFilters {
  search?: string;
  status?: string;
  fromDate?: Date;
  toDate?: Date;
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 150);
}

const withCurrentRevision = { include: { currentRevision: true } } as const;
export type PageWithRevision = Prisma.PageGetPayload<typeof withCurrentRevision>;

// Phase 1 (Website module) — the assigned template (if any), with its own
// current revision, so the public projection can surface template
// structure only when it's genuinely PUBLISHED (see publicSiteService.ts's
// projectPage). Purely additive to this query's shape.
const withPublicRelations = { include: { currentRevision: true, featuredMedia: true, template: { include: { currentRevision: true } } } } as const;
export type PageWithPublicRelations = Prisma.PageGetPayload<typeof withPublicRelations>;

function buildWhere(organizationId: string, filters: PageFilters): Prisma.PageWhereInput {
  const where: Prisma.PageWhereInput = { organizationId, deletedAt: null };
  if (filters.status) where.status = filters.status as Prisma.EnumContentStatusFilter["equals"];
  if (filters.fromDate || filters.toDate) {
    where.createdAt = { ...(filters.fromDate ? { gte: filters.fromDate } : {}), ...(filters.toDate ? { lte: filters.toDate } : {}) };
  }
  if (filters.search) {
    where.OR = [{ title: { contains: filters.search, mode: "insensitive" } }, { slug: { contains: filters.search, mode: "insensitive" } }];
  }
  return where;
}

export const pageRepository = {
  async list(organizationId: string, filters: PageFilters, page: number, limit: number, sort: string, order: "asc" | "desc") {
    const where = buildWhere(organizationId, filters);
    const [rows, total] = await Promise.all([
      prisma.page.findMany({ where, orderBy: { [sort]: order }, skip: (page - 1) * limit, take: limit }),
      prisma.page.count({ where }),
    ]);
    return { rows, total };
  },

  async findByIdInOrg(id: string, organizationId: string): Promise<PageWithRevision | null> {
    return prisma.page.findFirst({ where: { id, organizationId, deletedAt: null }, ...withCurrentRevision });
  },

  async findBySlugInOrg(organizationId: string, slug: string): Promise<Page | null> {
    return prisma.page.findFirst({ where: { organizationId, slug, deletedAt: null } });
  },

  /** Phase 11 — bulk existence check for Case Study "related pages" selection, org-scoped. */
  async findByIdsInOrg(ids: string[], organizationId: string): Promise<Page[]> {
    if (ids.length === 0) return [];
    return prisma.page.findMany({ where: { id: { in: ids }, organizationId, deletedAt: null } });
  },

  /** Phase 11 public projection — PUBLISHED only, with the revision content and featured media needed to render the page (docs/PUBLIC_API_ARCHITECTURE.md). Never returns DRAFT/IN_REVIEW/SCHEDULED/ARCHIVED. */
  async findPublishedBySlugWithMedia(organizationId: string, slug: string): Promise<PageWithPublicRelations | null> {
    return prisma.page.findFirst({ where: { organizationId, slug, status: "PUBLISHED", deletedAt: null }, ...withPublicRelations });
  },

  /** Phase 5 — the org's designated homepage, PUBLISHED only (same safety as findPublishedBySlugWithMedia). */
  async findPublishedHomepageWithMedia(organizationId: string): Promise<PageWithPublicRelations | null> {
    return prisma.page.findFirst({ where: { organizationId, isHomepage: true, status: "PUBLISHED", deletedAt: null }, ...withPublicRelations });
  },

  /** Phase 5 — resolves a navigation-menu "page" link target to its slug, PUBLISHED only (never leaks a draft page's existence/slug). */
  async findPublishedByIdInOrg(id: string, organizationId: string): Promise<Pick<Page, "slug"> | null> {
    return prisma.page.findFirst({ where: { id, organizationId, status: "PUBLISHED", deletedAt: null }, select: { slug: true } });
  },

  /**
   * Cross-organization by design (see postRepository.findDueScheduled) —
   * backs the system cron job that promotes SCHEDULED pages to PUBLISHED.
   */
  async findDueScheduled(now: Date, limit = 20): Promise<PageWithRevision[]> {
    return prisma.page.findMany({
      where: { status: "SCHEDULED", scheduledAt: { lte: now }, deletedAt: null },
      take: limit,
      orderBy: { scheduledAt: "asc" },
      ...withCurrentRevision,
    });
  },

  /** Phase 5 SEO audit — every live-or-about-to-be-live page (not ARCHIVED, not soft-deleted), with exactly the fields the rule-based checks need. */
  async listForSeoAudit(organizationId: string) {
    return prisma.page.findMany({
      where: { organizationId, deletedAt: null, status: { not: "ARCHIVED" } },
      select: {
        id: true,
        slug: true,
        title: true,
        status: true,
        currentRevision: { select: { title: true, metadata: true } },
        featuredMedia: { select: { altText: true } },
      },
    });
  },

  async findUniqueSlugInOrg(organizationId: string, base: string): Promise<string> {
    const baseSlug = slugify(base) || "page";
    let slug = baseSlug;
    let attempt = 1;
    while (await this.findBySlugInOrg(organizationId, slug)) {
      attempt += 1;
      slug = `${baseSlug}-${attempt}`;
      if (attempt > 50) break;
    }
    return slug;
  },

  async listRevisions(pageId: string) {
    return prisma.contentRevision.findMany({ where: { pageId }, orderBy: { version: "desc" } });
  },

  /** Phase 5 — page hierarchy: this page's own parentId (for cycle-checking a reparent), org-scoped. */
  async findParentId(id: string, organizationId: string): Promise<string | null> {
    const row = await prisma.page.findFirst({ where: { id, organizationId, deletedAt: null }, select: { parentId: true } });
    return row?.parentId ?? null;
  },

  /** Phase 5 — direct children of a page, for the Pages hierarchy UI. */
  async listChildren(parentId: string, organizationId: string) {
    return prisma.page.findMany({
      where: { parentId, organizationId, deletedAt: null },
      select: { id: true, title: true, slug: true, status: true },
      orderBy: { title: "asc" },
    });
  },

  async softDelete(id: string): Promise<void> {
    await prisma.page.update({ where: { id }, data: { deletedAt: new Date() } });
  },

  /** Phase 7 — Trash view: pages soft-deleted but not yet permanently gone, newest-deleted first. */
  async listTrash(organizationId: string, page: number, limit: number): Promise<{ rows: Page[]; total: number }> {
    const where: Prisma.PageWhereInput = { organizationId, deletedAt: { not: null } };
    const [rows, total] = await Promise.all([
      prisma.page.findMany({ where, orderBy: { deletedAt: "desc" }, skip: (page - 1) * limit, take: limit }),
      prisma.page.count({ where }),
    ]);
    return { rows, total };
  },

  /** Phase 7 — Trash view: a single soft-deleted page, org-scoped (never a live one). */
  async findTrashedByIdInOrg(id: string, organizationId: string): Promise<Page | null> {
    return prisma.page.findFirst({ where: { id, organizationId, deletedAt: { not: null } } });
  },

  async restore(id: string): Promise<void> {
    await prisma.page.update({ where: { id }, data: { deletedAt: null } });
  },
};
