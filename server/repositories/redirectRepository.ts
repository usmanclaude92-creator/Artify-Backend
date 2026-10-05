/**
 * Redirect data access (Phase 5 — docs/SEO_ARCHITECTURE.md). Every query is
 * organization-scoped; `findByFromPathInOrg` is also the exact lookup the
 * public site's slug-miss path uses, so it stays a single indexed
 * equality match on `(organization_id, from_path)` — no `contains`/search
 * logic on that one.
 */
import type { Redirect, Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";

export interface RedirectFilters {
  search?: string;
  isActive?: boolean;
}

function buildWhere(organizationId: string, filters: RedirectFilters): Prisma.RedirectWhereInput {
  const where: Prisma.RedirectWhereInput = { organizationId };
  if (filters.search) {
    const term = filters.search;
    where.OR = [{ fromPath: { contains: term, mode: "insensitive" } }, { toPath: { contains: term, mode: "insensitive" } }];
  }
  if (filters.isActive !== undefined) where.isActive = filters.isActive;
  return where;
}

export const redirectRepository = {
  async list(
    organizationId: string,
    filters: RedirectFilters,
    page: number,
    limit: number,
    sort: string,
    order: "asc" | "desc"
  ): Promise<{ rows: Redirect[]; total: number }> {
    const where = buildWhere(organizationId, filters);
    const [rows, total] = await Promise.all([
      prisma.redirect.findMany({ where, orderBy: { [sort]: order }, skip: (page - 1) * limit, take: limit }),
      prisma.redirect.count({ where }),
    ]);
    return { rows, total };
  },

  async findByIdInOrg(id: string, organizationId: string): Promise<Redirect | null> {
    return prisma.redirect.findFirst({ where: { id, organizationId } });
  },

  /** Phase 15 — SEO reporting: real redirect counts, never fabricated. */
  async count(organizationId: string): Promise<{ total: number; active: number }> {
    const [total, active] = await Promise.all([
      prisma.redirect.count({ where: { organizationId } }),
      prisma.redirect.count({ where: { organizationId, isActive: true } }),
    ]);
    return { total, active };
  },

  async findByFromPathInOrg(organizationId: string, fromPath: string): Promise<Redirect | null> {
    return prisma.redirect.findUnique({ where: { organizationId_fromPath: { organizationId, fromPath } } });
  },

  /** Just the toPath for a fromPath, for cycle-walking without loading whole rows. */
  async findToPathByFromPathInOrg(organizationId: string, fromPath: string): Promise<string | null> {
    const row = await prisma.redirect.findUnique({
      where: { organizationId_fromPath: { organizationId, fromPath } },
      select: { toPath: true },
    });
    return row?.toPath ?? null;
  },

  async create(data: {
    organizationId: string;
    fromPath: string;
    toPath: string;
    statusCode?: number;
    resourceType?: string;
    resourceId?: string;
    isActive?: boolean;
    notes?: string;
    createdById?: string;
  }): Promise<Redirect> {
    return prisma.redirect.create({ data });
  },

  /** Used by the auto-create-on-slug-change path: replaces an existing auto-created redirect for the same resource rather than piling up chains (old -> mid -> new). */
  async upsertForResource(data: {
    organizationId: string;
    fromPath: string;
    toPath: string;
    resourceType: string;
    resourceId: string;
  }): Promise<Redirect> {
    return prisma.redirect.upsert({
      where: { organizationId_fromPath: { organizationId: data.organizationId, fromPath: data.fromPath } },
      create: { ...data, statusCode: 301 },
      update: { toPath: data.toPath, resourceType: data.resourceType, resourceId: data.resourceId },
    });
  },

  /** Repoints any redirect that pointed at `oldToPath` so a chain (A->B, then B->C) collapses to A->C instead of breaking at B. */
  async repointChainedRedirects(organizationId: string, oldToPath: string, newToPath: string): Promise<void> {
    await prisma.redirect.updateMany({ where: { organizationId, toPath: oldToPath }, data: { toPath: newToPath } });
  },

  async update(id: string, data: Prisma.RedirectUpdateInput): Promise<Redirect> {
    return prisma.redirect.update({ where: { id }, data });
  },

  async delete(id: string): Promise<void> {
    await prisma.redirect.delete({ where: { id } });
  },
};
