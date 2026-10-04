/**
 * Opportunity data access (Phase 7 — docs/CRM_ARCHITECTURE.md).
 * Organization-scoped, same findByIdInOrg-only convention as
 * leadRepository.ts/clientRepository.ts.
 */
import type { Opportunity, Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";

export interface OpportunityFilters {
  search?: string;
  stage?: string;
  clientId?: string;
  leadId?: string;
  productId?: string;
  assignedTo?: string;
}

const withRelations = {
  include: {
    client: { select: { id: true, name: true, clientCode: true } },
    lead: { select: { id: true, companyName: true } },
    product: { select: { id: true, name: true, slug: true, type: true } },
  },
} as const;
export type OpportunityWithRelations = Prisma.OpportunityGetPayload<typeof withRelations>;

function buildWhere(organizationId: string, filters: OpportunityFilters): Prisma.OpportunityWhereInput {
  const where: Prisma.OpportunityWhereInput = { organizationId, deletedAt: null };
  if (filters.stage) where.stage = filters.stage as Prisma.EnumOpportunityStageFilter["equals"];
  if (filters.clientId) where.clientId = filters.clientId;
  if (filters.leadId) where.leadId = filters.leadId;
  if (filters.productId) where.productId = filters.productId;
  if (filters.assignedTo) where.assignedTo = filters.assignedTo;
  if (filters.search) where.name = { contains: filters.search, mode: "insensitive" };
  return where;
}

export const opportunityRepository = {
  async list(
    organizationId: string,
    filters: OpportunityFilters,
    page: number,
    limit: number,
    sort: string,
    order: "asc" | "desc"
  ): Promise<{ rows: OpportunityWithRelations[]; total: number }> {
    const where = buildWhere(organizationId, filters);
    const [rows, total] = await Promise.all([
      prisma.opportunity.findMany({ where, orderBy: { [sort]: order }, skip: (page - 1) * limit, take: limit, ...withRelations }),
      prisma.opportunity.count({ where }),
    ]);
    return { rows, total };
  },

  async findByIdInOrg(id: string, organizationId: string): Promise<OpportunityWithRelations | null> {
    return prisma.opportunity.findFirst({ where: { id, organizationId, deletedAt: null }, ...withRelations });
  },

  async create(data: {
    organizationId: string;
    clientId?: string;
    leadId?: string;
    productId?: string;
    campaignId?: string;
    source?: string;
    probability?: number;
    name: string;
    stage?: Opportunity["stage"];
    value: Prisma.Decimal;
    currency: string;
    expectedCloseDate?: Date;
    notes?: string;
    assignedTo?: string;
    createdById?: string;
  }): Promise<OpportunityWithRelations> {
    const created = await prisma.opportunity.create({ data });
    return (await this.findByIdInOrg(created.id, data.organizationId))!;
  },

  async update(id: string, organizationId: string, data: Prisma.OpportunityUncheckedUpdateInput): Promise<OpportunityWithRelations> {
    await prisma.opportunity.update({ where: { id }, data });
    return (await this.findByIdInOrg(id, organizationId))!;
  },

  async softDelete(id: string): Promise<void> {
    await prisma.opportunity.update({ where: { id }, data: { deletedAt: new Date() } });
  },

  async countByStage(organizationId: string): Promise<Record<string, { count: number; value: string }>> {
    const rows = await prisma.opportunity.groupBy({
      by: ["stage"],
      where: { organizationId, deletedAt: null },
      _count: { _all: true },
      _sum: { value: true },
    });
    const result: Record<string, { count: number; value: string }> = {};
    for (const row of rows) result[row.stage] = { count: row._count._all, value: (row._sum.value ?? 0).toString() };
    return result;
  },

  async recentForOrg(organizationId: string, limit: number): Promise<OpportunityWithRelations[]> {
    return prisma.opportunity.findMany({ where: { organizationId, deletedAt: null }, orderBy: { createdAt: "desc" }, take: limit, ...withRelations });
  },

  /** Phase 14 — marketing dashboard "conversions": real closed-won deals attributed to a campaign (never fabricated). */
  async countAttributedConversions(organizationId: string): Promise<number> {
    return prisma.opportunity.count({ where: { organizationId, deletedAt: null, campaignId: { not: null }, stage: "CLOSED_WON" } });
  },
};
