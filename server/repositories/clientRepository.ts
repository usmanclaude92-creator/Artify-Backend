/** Client data access (Phase 5 — docs/CRM_ARCHITECTURE.md). Same organization-scoped-lookup-only convention as leadRepository.ts. */
import type { Client, Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";

export interface ClientFilters {
  search?: string;
  status?: string;
}

function buildWhere(organizationId: string, filters: ClientFilters): Prisma.ClientWhereInput {
  const where: Prisma.ClientWhereInput = { organizationId, deletedAt: null };
  if (filters.status) where.status = filters.status as Prisma.EnumClientStatusFilter["equals"];
  if (filters.search) {
    const term = filters.search;
    where.OR = [
      { name: { contains: term, mode: "insensitive" } },
      { legalName: { contains: term, mode: "insensitive" } },
      { clientCode: { contains: term, mode: "insensitive" } },
      { email: { contains: term, mode: "insensitive" } },
    ];
  }
  return where;
}

export const clientRepository = {
  async list(
    organizationId: string,
    filters: ClientFilters,
    page: number,
    limit: number,
    sort: string,
    order: "asc" | "desc"
  ): Promise<{ rows: Client[]; total: number }> {
    const where = buildWhere(organizationId, filters);
    const [rows, total] = await Promise.all([
      prisma.client.findMany({
        where,
        orderBy: { [sort]: order },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.client.count({ where }),
    ]);
    return { rows, total };
  },

  async findByIdInOrg(id: string, organizationId: string): Promise<Client | null> {
    return prisma.client.findFirst({ where: { id, organizationId, deletedAt: null } });
  },

  /** Case-insensitive duplicate-name check within a tenant (§19) — soft, service-level, not a DB unique constraint (see schema.prisma's Client doc comment for why). */
  async findByNameInOrg(organizationId: string, name: string): Promise<Client | null> {
    return prisma.client.findFirst({
      where: { organizationId, deletedAt: null, name: { equals: name, mode: "insensitive" } },
    });
  },

  async findByCodeInOrg(organizationId: string, clientCode: string): Promise<Client | null> {
    return prisma.client.findFirst({ where: { organizationId, clientCode, deletedAt: null } });
  },

  async create(data: {
    organizationId: string;
    clientCode: string;
    name: string;
    legalName?: string;
    status?: string;
    email?: string;
    phone?: string;
    website?: string;
    address?: string;
    accountManager?: string;
    notes?: string;
  }): Promise<Client> {
    return prisma.client.create({
      data: {
        organizationId: data.organizationId,
        clientCode: data.clientCode,
        name: data.name,
        legalName: data.legalName,
        status: (data.status as Client["status"]) ?? "PROSPECT",
        email: data.email,
        phone: data.phone,
        website: data.website,
        address: data.address,
        accountManager: data.accountManager,
        notes: data.notes,
      },
    });
  },

  async update(id: string, data: Prisma.ClientUpdateInput): Promise<Client> {
    return prisma.client.update({ where: { id }, data });
  },

  async softDelete(id: string): Promise<void> {
    await prisma.client.update({ where: { id }, data: { deletedAt: new Date() } });
  },

  async countByStatus(organizationId: string): Promise<Record<string, number>> {
    const rows = await prisma.client.groupBy({
      by: ["status"],
      where: { organizationId, deletedAt: null },
      _count: { _all: true },
    });
    const result: Record<string, number> = {};
    for (const row of rows) result[row.status] = row._count._all;
    return result;
  },

  async recentForOrg(organizationId: string, limit: number): Promise<Client[]> {
    return prisma.client.findMany({
      where: { organizationId, deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  },
};
