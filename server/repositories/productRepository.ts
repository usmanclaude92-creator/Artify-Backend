/** Product catalog data access (Phase 7 — docs/PRODUCT_CATALOG_ARCHITECTURE.md). Platform-global — no organization scoping (see Product's schema.prisma doc comment). */
import type { Product, ProductRevision, Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";

export interface ProductFilters {
  search?: string;
  type?: string;
  status?: string;
  isFeatured?: boolean;
  categoryId?: string;
  industryId?: string;
}

// Phase 10 — the richer shape used by the Control Center's detail view and
// public rendering; list() and the plain findById() stay flat (no
// includes) so every existing caller's `Product` type is unaffected.
const withDetail = {
  include: {
    category: true,
    currentRevision: true,
    industries: { include: { industry: true } },
    relatedFrom: { include: { toProduct: { select: { id: true, slug: true, name: true, type: true, status: true } } } },
    relatedTo: { include: { fromProduct: { select: { id: true, slug: true, name: true, type: true, status: true } } } },
  },
} as const;
export type ProductWithDetail = Prisma.ProductGetPayload<typeof withDetail>;

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 100);
}

function buildWhere(filters: ProductFilters): Prisma.ProductWhereInput {
  const where: Prisma.ProductWhereInput = {};
  if (filters.type) where.type = filters.type as Prisma.EnumProductTypeFilter["equals"];
  if (filters.status) where.status = filters.status as Prisma.EnumProductStatusFilter["equals"];
  if (filters.isFeatured !== undefined) where.isFeatured = filters.isFeatured;
  if (filters.categoryId) where.categoryId = filters.categoryId;
  if (filters.industryId) where.industries = { some: { industryId: filters.industryId } };
  if (filters.search) {
    const term = filters.search;
    where.OR = [
      { name: { contains: term, mode: "insensitive" } },
      { code: { contains: term, mode: "insensitive" } },
      { slug: { contains: term, mode: "insensitive" } },
    ];
  }
  return where;
}

export const productRepository = {
  async list(filters: ProductFilters, page: number, limit: number, sort: string, order: "asc" | "desc") {
    const where = buildWhere(filters);
    const [rows, total] = await Promise.all([
      prisma.product.findMany({
        where,
        orderBy: { [sort]: order },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.product.count({ where }),
    ]);
    return { rows, total };
  },

  async findById(id: string): Promise<Product | null> {
    return prisma.product.findUnique({ where: { id } });
  },

  async findByIdWithDetail(id: string): Promise<ProductWithDetail | null> {
    return prisma.product.findUnique({ where: { id }, ...withDetail });
  },

  /** Existence check for relatedProductIds/duplicate validation — never trusts a caller-supplied id list without checking which ones are real. */
  async findManyByIds(ids: string[]): Promise<Product[]> {
    if (ids.length === 0) return [];
    return prisma.product.findMany({ where: { id: { in: ids } } });
  },

  async findByCode(code: string): Promise<Product | null> {
    return prisma.product.findUnique({ where: { code } });
  },

  async findBySlug(slug: string): Promise<Product | null> {
    return prisma.product.findUnique({ where: { slug } });
  },

  /** Server-generated, collision-safe (§7) — never trusts a frontend-supplied slug for uniqueness beyond a caller-requested starting point. */
  async findUniqueSlug(base: string): Promise<string> {
    const baseSlug = slugify(base) || "product";
    let slug = baseSlug;
    let attempt = 1;
    while (await this.findBySlug(slug)) {
      attempt += 1;
      slug = `${baseSlug}-${attempt}`;
      if (attempt > 50) break;
    }
    return slug;
  },

  async create(data: {
    code: string;
    name: string;
    slug: string;
    type: string;
    shortDescription?: string;
    description?: string;
    status?: string;
    isFeatured?: boolean;
    displayOrder?: number;
    featuredMediaId?: string;
    categoryId?: string;
    createdById: string;
  }): Promise<Product> {
    return prisma.product.create({
      data: {
        code: data.code,
        name: data.name,
        slug: data.slug,
        type: data.type as Product["type"],
        shortDescription: data.shortDescription,
        description: data.description,
        status: (data.status as Product["status"]) ?? "DRAFT",
        isFeatured: data.isFeatured ?? false,
        displayOrder: data.displayOrder ?? 0,
        featuredMediaId: data.featuredMediaId,
        categoryId: data.categoryId,
        createdById: data.createdById,
        updatedById: data.createdById,
      },
    });
  },

  async update(id: string, data: Prisma.ProductUpdateInput): Promise<Product> {
    return prisma.product.update({ where: { id }, data });
  },

  // --- Revisions (Phase 10) — mirrors templateRepository's own revision helpers. ---

  async listRevisions(productId: string): Promise<ProductRevision[]> {
    return prisma.productRevision.findMany({ where: { productId }, orderBy: { version: "desc" } });
  },

  async findRevision(productId: string, revisionId: string): Promise<ProductRevision | null> {
    return prisma.productRevision.findFirst({ where: { id: revisionId, productId } });
  },

  async createRevision(data: { productId: string; version: number; name: string; content: Prisma.InputJsonValue; createdById: string }): Promise<ProductRevision> {
    return prisma.productRevision.create({ data });
  },

  // --- Relations (Phase 10) — one row per pair; queried from both directions. ---

  async getRelatedProducts(productId: string) {
    const [from, to] = await Promise.all([
      prisma.productRelation.findMany({ where: { fromProductId: productId }, include: { toProduct: { select: { id: true, slug: true, name: true, type: true, status: true } } } }),
      prisma.productRelation.findMany({ where: { toProductId: productId }, include: { fromProduct: { select: { id: true, slug: true, name: true, type: true, status: true } } } }),
    ]);
    return [...from.map((r) => r.toProduct), ...to.map((r) => r.fromProduct)];
  },

  /** Replaces the full related-product set for `productId` with exactly `relatedIds`, storing each pair once regardless of direction. */
  async setRelatedProducts(productId: string, relatedIds: string[], createdById: string): Promise<void> {
    await prisma.$transaction([
      prisma.productRelation.deleteMany({ where: { OR: [{ fromProductId: productId }, { toProductId: productId }] } }),
      ...relatedIds.map((toProductId) => prisma.productRelation.create({ data: { fromProductId: productId, toProductId, createdById } })),
    ]);
  },

  // --- Industries (Phase 10) ---

  async getIndustries(productId: string) {
    const rows = await prisma.productIndustry.findMany({ where: { productId }, include: { industry: true } });
    return rows.map((r) => r.industry);
  },

  async setIndustries(productId: string, industryIds: string[]): Promise<void> {
    await prisma.$transaction([
      prisma.productIndustry.deleteMany({ where: { productId } }),
      ...industryIds.map((industryId) => prisma.productIndustry.create({ data: { productId, industryId } })),
    ]);
  },
};
