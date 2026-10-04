/**
 * Campaign data access (Phase 14 — docs/MARKETING_ARCHITECTURE.md).
 * Organization-scoped, same findByIdInOrg-only convention as every other
 * CRM repository since Phase 5.
 */
import type { Campaign, Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";

export interface CampaignFilters {
  search?: string;
  status?: string;
  channel?: string;
  ownerId?: string;
}

const withRelations = {
  include: {
    owner: { select: { id: true, firstName: true, lastName: true, email: true } },
    createdBy: { select: { id: true, firstName: true, lastName: true, email: true } },
    landingPage: { select: { id: true, slug: true, title: true, status: true } },
    form: { select: { id: true, name: true, slug: true, status: true } },
    products: { include: { product: { select: { id: true, slug: true, name: true, type: true, status: true } } } },
    relatedPages: { include: { page: { select: { id: true, slug: true, title: true, status: true } } } },
    relatedPosts: { include: { post: { select: { id: true, slug: true, title: true, status: true } } } },
    relatedCaseStudies: { include: { caseStudy: { select: { id: true, slug: true, title: true, status: true } } } },
    media: { include: { media: { select: { id: true, displayName: true, originalFilename: true, storageKey: true, mimeType: true } } } },
    _count: { select: { leads: true, formSubmissions: true, opportunities: true, clients: true } },
  },
} as const;
export type CampaignWithRelations = Prisma.CampaignGetPayload<typeof withRelations>;

function buildWhere(organizationId: string, filters: CampaignFilters): Prisma.CampaignWhereInput {
  const where: Prisma.CampaignWhereInput = { organizationId, deletedAt: null };
  if (filters.status) where.status = filters.status as Prisma.EnumCampaignStatusFilter["equals"];
  if (filters.channel) where.channel = filters.channel as Prisma.EnumCampaignChannelFilter["equals"];
  if (filters.ownerId) where.ownerId = filters.ownerId;
  if (filters.search) {
    where.OR = [
      { name: { contains: filters.search, mode: "insensitive" } },
      { utmCampaign: { contains: filters.search, mode: "insensitive" } },
      { description: { contains: filters.search, mode: "insensitive" } },
    ];
  }
  return where;
}

export const campaignRepository = {
  async list(organizationId: string, filters: CampaignFilters, page: number, limit: number, sort: string, order: "asc" | "desc") {
    const where = buildWhere(organizationId, filters);
    const [rows, total] = await Promise.all([
      prisma.campaign.findMany({
        where,
        orderBy: { [sort]: order },
        skip: (page - 1) * limit,
        take: limit,
        include: { owner: { select: { id: true, firstName: true, lastName: true, email: true } }, _count: { select: { leads: true, opportunities: true, clients: true } } },
      }),
      prisma.campaign.count({ where }),
    ]);
    return { rows, total };
  },

  async findByIdInOrg(id: string, organizationId: string): Promise<CampaignWithRelations | null> {
    return prisma.campaign.findFirst({ where: { id, organizationId, deletedAt: null }, ...withRelations });
  },

  /** Case-insensitive match against this org's own Campaign.utmCampaign — the attribution-resolution lookup (campaignAttributionService). Never ARCHIVED/soft-deleted: an archived campaign no longer attributes new activity. */
  async findActiveByUtmCampaignInOrg(organizationId: string, utmCampaign: string): Promise<Campaign | null> {
    return prisma.campaign.findFirst({
      where: { organizationId, deletedAt: null, status: { not: "ARCHIVED" }, utmCampaign: { equals: utmCampaign, mode: "insensitive" } },
      orderBy: { createdAt: "desc" },
    });
  },

  async create(data: Prisma.CampaignUncheckedCreateInput): Promise<Campaign> {
    return prisma.campaign.create({ data });
  },

  async update(id: string, data: Prisma.CampaignUncheckedUpdateInput): Promise<Campaign> {
    return prisma.campaign.update({ where: { id }, data });
  },

  async softDelete(id: string): Promise<void> {
    await prisma.campaign.update({ where: { id }, data: { deletedAt: new Date() } });
  },

  async setProducts(campaignId: string, productIds: string[]): Promise<void> {
    await prisma.$transaction([
      prisma.campaignProduct.deleteMany({ where: { campaignId } }),
      ...(productIds.length > 0 ? [prisma.campaignProduct.createMany({ data: productIds.map((productId) => ({ campaignId, productId })) })] : []),
    ]);
  },

  async setRelatedPages(campaignId: string, pageIds: string[]): Promise<void> {
    await prisma.$transaction([
      prisma.campaignRelatedPage.deleteMany({ where: { campaignId } }),
      ...(pageIds.length > 0 ? [prisma.campaignRelatedPage.createMany({ data: pageIds.map((pageId) => ({ campaignId, pageId })) })] : []),
    ]);
  },

  async setRelatedPosts(campaignId: string, postIds: string[]): Promise<void> {
    await prisma.$transaction([
      prisma.campaignRelatedPost.deleteMany({ where: { campaignId } }),
      ...(postIds.length > 0 ? [prisma.campaignRelatedPost.createMany({ data: postIds.map((postId) => ({ campaignId, postId })) })] : []),
    ]);
  },

  async setRelatedCaseStudies(campaignId: string, caseStudyIds: string[]): Promise<void> {
    await prisma.$transaction([
      prisma.campaignRelatedCaseStudy.deleteMany({ where: { campaignId } }),
      ...(caseStudyIds.length > 0 ? [prisma.campaignRelatedCaseStudy.createMany({ data: caseStudyIds.map((caseStudyId) => ({ campaignId, caseStudyId })) })] : []),
    ]);
  },

  async setMedia(campaignId: string, mediaIds: string[]): Promise<void> {
    await prisma.$transaction([
      prisma.campaignMedia.deleteMany({ where: { campaignId } }),
      ...(mediaIds.length > 0 ? [prisma.campaignMedia.createMany({ data: mediaIds.map((mediaId) => ({ campaignId, mediaId })) })] : []),
    ]);
  },

  /** Marketing dashboard — real counts only, never fabricated (marketingService.ts). */
  async countByStatus(organizationId: string): Promise<Record<string, number>> {
    const rows = await prisma.campaign.groupBy({ by: ["status"], where: { organizationId, deletedAt: null }, _count: { _all: true } });
    const result: Record<string, number> = {};
    for (const row of rows) result[row.status] = row._count._all;
    return result;
  },

  /** Attributed-leads count per campaign, newest campaigns first — used by the dashboard's "recent campaign activity"/performance view. */
  async leadCounts(organizationId: string): Promise<Array<{ campaignId: string; leads: number; conversions: number }>> {
    const rows = await prisma.campaign.findMany({
      where: { organizationId, deletedAt: null },
      select: {
        id: true,
        _count: { select: { leads: true, clients: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    return rows.map((r) => ({ campaignId: r.id, leads: r._count.leads, conversions: r._count.clients }));
  },

  async distinctUtmCampaigns(organizationId: string): Promise<Array<{ utmCampaign: string; count: number }>> {
    const rows = await prisma.lead.groupBy({
      by: ["utmCampaign"],
      where: { organizationId, deletedAt: null, utmCampaign: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { utmCampaign: "desc" } },
      take: 20,
    });
    return rows.filter((r) => r.utmCampaign).map((r) => ({ utmCampaign: r.utmCampaign as string, count: r._count._all }));
  },
};
