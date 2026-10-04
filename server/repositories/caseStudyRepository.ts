/** Case Study data access (Phase 11 — docs/CASE_STUDY_ARCHITECTURE.md). Organization-scoped, same findByIdInOrg-only convention as postRepository.ts/pageRepository.ts. */
import type { CaseStudy, Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";

export interface CaseStudyFilters {
  search?: string;
  status?: string;
  industryId?: string;
  productId?: string;
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

const withRelations = {
  include: {
    currentRevision: true,
    industry: true,
    featuredMedia: true,
    products: { include: { product: { select: { id: true, slug: true, name: true, type: true, status: true } } } },
    relatedPages: { include: { page: { select: { id: true, slug: true, title: true, status: true } } } },
    relatedPosts: { include: { post: { select: { id: true, slug: true, title: true, status: true } } } },
  },
} as const;
export type CaseStudyWithRelations = Prisma.CaseStudyGetPayload<typeof withRelations>;

const withPublicRelations = {
  include: {
    currentRevision: true,
    industry: true,
    featuredMedia: true,
    products: { include: { product: { select: { id: true, slug: true, name: true, type: true, status: true, shortDescription: true } } } },
    relatedPages: { include: { page: { select: { slug: true, title: true, status: true } } } },
    relatedPosts: { include: { post: { select: { slug: true, title: true, status: true } } } },
  },
} as const;
export type CaseStudyWithPublicRelations = Prisma.CaseStudyGetPayload<typeof withPublicRelations>;

function buildWhere(organizationId: string, filters: CaseStudyFilters): Prisma.CaseStudyWhereInput {
  const where: Prisma.CaseStudyWhereInput = { organizationId, deletedAt: null };
  if (filters.status) where.status = filters.status as Prisma.EnumContentStatusFilter["equals"];
  if (filters.industryId) where.industryId = filters.industryId;
  if (filters.productId) where.products = { some: { productId: filters.productId } };
  if (filters.fromDate || filters.toDate) {
    where.createdAt = { ...(filters.fromDate ? { gte: filters.fromDate } : {}), ...(filters.toDate ? { lte: filters.toDate } : {}) };
  }
  if (filters.search) {
    where.OR = [
      { title: { contains: filters.search, mode: "insensitive" } },
      { slug: { contains: filters.search, mode: "insensitive" } },
      { clientName: { contains: filters.search, mode: "insensitive" } },
    ];
  }
  return where;
}

export const caseStudyRepository = {
  async list(organizationId: string, filters: CaseStudyFilters, page: number, limit: number, sort: string, order: "asc" | "desc") {
    const where = buildWhere(organizationId, filters);
    const [rows, total] = await Promise.all([
      prisma.caseStudy.findMany({ where, orderBy: { [sort]: order }, skip: (page - 1) * limit, take: limit }),
      prisma.caseStudy.count({ where }),
    ]);
    return { rows, total };
  },

  async findByIdInOrg(id: string, organizationId: string): Promise<CaseStudyWithRelations | null> {
    return prisma.caseStudy.findFirst({ where: { id, organizationId, deletedAt: null }, ...withRelations });
  },

  async findBySlugInOrg(organizationId: string, slug: string): Promise<CaseStudy | null> {
    return prisma.caseStudy.findFirst({ where: { organizationId, slug, deletedAt: null } });
  },

  /** Phase 14 — bulk existence check for Campaign "related case studies" selection, org-scoped (same shape as pageRepository/postRepository.findByIdsInOrg). */
  async findByIdsInOrg(ids: string[], organizationId: string): Promise<CaseStudy[]> {
    if (ids.length === 0) return [];
    return prisma.caseStudy.findMany({ where: { id: { in: ids }, organizationId, deletedAt: null } });
  },

  /** Public projection — PUBLISHED only, with every relation the public renderer needs. Never returns DRAFT/IN_REVIEW/SCHEDULED/ARCHIVED. */
  async findPublishedBySlugWithMedia(organizationId: string, slug: string): Promise<CaseStudyWithPublicRelations | null> {
    return prisma.caseStudy.findFirst({ where: { organizationId, slug, status: "PUBLISHED", deletedAt: null }, ...withPublicRelations });
  },

  /** Public projection — PUBLISHED only, paginated. */
  async listPublished(
    organizationId: string,
    filters: Omit<CaseStudyFilters, "status">,
    page: number,
    limit: number,
    sort: string,
    order: "asc" | "desc"
  ): Promise<{ rows: CaseStudyWithPublicRelations[]; total: number }> {
    const where = buildWhere(organizationId, { ...filters, status: "PUBLISHED" });
    const [rows, total] = await Promise.all([
      prisma.caseStudy.findMany({ where, orderBy: { [sort]: order }, skip: (page - 1) * limit, take: limit, ...withPublicRelations }),
      prisma.caseStudy.count({ where }),
    ]);
    return { rows, total };
  },

  /** Cross-organization by design — backs the system cron job that promotes SCHEDULED case studies to PUBLISHED, same as postRepository.findDueScheduled. */
  async findDueScheduled(now: Date, limit = 20): Promise<CaseStudyWithRelations[]> {
    return prisma.caseStudy.findMany({
      where: { status: "SCHEDULED", scheduledAt: { lte: now }, deletedAt: null },
      take: limit,
      orderBy: { scheduledAt: "asc" },
      ...withRelations,
    });
  },

  /** SEO audit — every live-or-about-to-be-live case study (not ARCHIVED, not soft-deleted). */
  async listForSeoAudit(organizationId: string) {
    return prisma.caseStudy.findMany({
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
    const baseSlug = slugify(base) || "case-study";
    let slug = baseSlug;
    let attempt = 1;
    while (await this.findBySlugInOrg(organizationId, slug)) {
      attempt += 1;
      slug = `${baseSlug}-${attempt}`;
      if (attempt > 50) break;
    }
    return slug;
  },

  async listRevisions(caseStudyId: string) {
    return prisma.contentRevision.findMany({ where: { caseStudyId }, orderBy: { version: "desc" } });
  },

  async setProducts(caseStudyId: string, productIds: string[]): Promise<void> {
    await prisma.$transaction([
      prisma.caseStudyProduct.deleteMany({ where: { caseStudyId } }),
      ...(productIds.length > 0 ? [prisma.caseStudyProduct.createMany({ data: productIds.map((productId) => ({ caseStudyId, productId })) })] : []),
    ]);
  },

  async setRelatedPages(caseStudyId: string, pageIds: string[]): Promise<void> {
    await prisma.$transaction([
      prisma.caseStudyRelatedPage.deleteMany({ where: { caseStudyId } }),
      ...(pageIds.length > 0 ? [prisma.caseStudyRelatedPage.createMany({ data: pageIds.map((pageId) => ({ caseStudyId, pageId })) })] : []),
    ]);
  },

  async setRelatedPosts(caseStudyId: string, postIds: string[]): Promise<void> {
    await prisma.$transaction([
      prisma.caseStudyRelatedPost.deleteMany({ where: { caseStudyId } }),
      ...(postIds.length > 0 ? [prisma.caseStudyRelatedPost.createMany({ data: postIds.map((postId) => ({ caseStudyId, postId })) })] : []),
    ]);
  },

  /** Control Center "dependency/usage" view — every other Case Study referencing this one's related content, used to warn before deleting a Page/Post/Product that's still in use. */
  async countUsageOfProduct(productId: string): Promise<number> {
    return prisma.caseStudyProduct.count({ where: { productId } });
  },
  async countUsageOfPage(pageId: string): Promise<number> {
    return prisma.caseStudyRelatedPage.count({ where: { pageId } });
  },
  async countUsageOfPost(postId: string): Promise<number> {
    return prisma.caseStudyRelatedPost.count({ where: { postId } });
  },

  async softDelete(id: string): Promise<void> {
    await prisma.caseStudy.update({ where: { id }, data: { deletedAt: new Date() } });
  },

  /** Trash view: case studies soft-deleted but not yet permanently gone, newest-deleted first. */
  async listTrash(organizationId: string, page: number, limit: number): Promise<{ rows: CaseStudy[]; total: number }> {
    const where: Prisma.CaseStudyWhereInput = { organizationId, deletedAt: { not: null } };
    const [rows, total] = await Promise.all([
      prisma.caseStudy.findMany({ where, orderBy: { deletedAt: "desc" }, skip: (page - 1) * limit, take: limit }),
      prisma.caseStudy.count({ where }),
    ]);
    return { rows, total };
  },

  /** Trash view: a single soft-deleted case study, org-scoped (never a live one). */
  async findTrashedByIdInOrg(id: string, organizationId: string): Promise<CaseStudy | null> {
    return prisma.caseStudy.findFirst({ where: { id, organizationId, deletedAt: { not: null } } });
  },

  async restore(id: string): Promise<void> {
    await prisma.caseStudy.update({ where: { id }, data: { deletedAt: null } });
  },
};
