/**
 * Product catalog management (Phase 7 — docs/PRODUCT_CATALOG_ARCHITECTURE.md;
 * extended Phase 10 — Products + Services + Solutions). Platform-global: no
 * organization scoping (see productRepository.ts and the Product model's
 * schema.prisma doc comment). Authorization is permission-gated only
 * (products.read/create/update/archive), never a per-row ownership check —
 * there is no owning tenant to check against.
 *
 * Phase 10 adds: featured media + category (both resolved/validated against
 * the single configured `PUBLIC_WEBSITE_ORGANIZATION_ID` — the only org a
 * global catalog row can safely borrow a tenant-scoped Media/Form row from);
 * a CTA form reference (same bounding); related products/industries; and
 * content revisions/rollback (benefits/features/business problem/CTA/SEO),
 * mirroring templateService's create-then-revision pattern but without a
 * separate per-revision publish status — see ProductRevision's own doc
 * comment in schema.prisma for why.
 */
import { productRepository, type ProductFilters, type ProductWithDetail } from "../repositories/productRepository";
import { productCategoryRepository } from "../repositories/productCategoryRepository";
import { industryRepository } from "../repositories/industryRepository";
import { mediaRepository } from "../repositories/mediaRepository";
import { formRepository } from "../repositories/formRepository";
import { auditLogRepository } from "../repositories/auditLogRepository";
import { prisma } from "../db/prisma";
import { config } from "../config/env";
import { ConflictError, NotFoundError, ValidationError } from "../core/errors";
import type { SanitizedUser } from "../types/domain";
import type { CreateProductInput, UpdateProductInput, ProductContentInput } from "../schemas/productSchemas";
import type { RequestMeta } from "./authService";
import type { Product, Prisma } from "@prisma/client";

const TERMINAL_STATUSES = new Set(["ARCHIVED"]);
const ALLOWED_TRANSITIONS: Record<string, readonly string[]> = {
  DRAFT: ["ACTIVE", "ARCHIVED"],
  ACTIVE: ["INACTIVE", "ARCHIVED"],
  INACTIVE: ["ACTIVE", "ARCHIVED"],
  ARCHIVED: [],
};

function assertValidTransition(current: string, next: string): void {
  if (current === next) return;
  if (!ALLOWED_TRANSITIONS[current]?.includes(next)) {
    throw new ConflictError(`Product cannot move from ${current} to ${next}.`);
  }
}

function isUniqueConstraintError(err: unknown): boolean {
  return !!err && typeof err === "object" && "code" in err && (err as { code?: string }).code === "P2002";
}

async function loadProductOrThrow(id: string): Promise<Product> {
  const product = await productRepository.findById(id);
  if (!product) throw new NotFoundError("Product not found.");
  return product;
}

async function loadProductDetailOrThrow(id: string): Promise<ProductWithDetail> {
  const product = await productRepository.findByIdWithDetail(id);
  if (!product) throw new NotFoundError("Product not found.");
  return product;
}

/** featuredMediaId/ctaFormId both borrow a tenant-scoped row — the only org a global catalog row may ever borrow from is the one configured to run the public website. */
async function assertFeaturedMediaUsable(mediaId: string | undefined | null): Promise<void> {
  if (!mediaId) return;
  const orgId = config.publicWebsiteOrganizationId;
  const media = orgId ? await mediaRepository.findByIdInOrg(mediaId, orgId) : null;
  if (!media) throw new ValidationError("featuredMediaId must refer to a real media asset in the public website's organization.");
}

async function assertCategoryUsable(categoryId: string | undefined | null): Promise<void> {
  if (!categoryId) return;
  const category = await productCategoryRepository.findById(categoryId);
  if (!category) throw new ValidationError("categoryId must refer to a real product category.");
}

async function assertCtaFormUsable(ctaFormId: string | undefined | null): Promise<void> {
  if (!ctaFormId) return;
  const orgId = config.publicWebsiteOrganizationId;
  const form = orgId ? await formRepository.findByIdInOrg(ctaFormId, orgId) : null;
  if (!form) throw new ValidationError("content.ctaFormId must refer to a real form in the public website's organization.");
}

async function assertRelatedProductsUsable(productId: string | null, relatedIds: string[] | undefined): Promise<void> {
  if (!relatedIds || relatedIds.length === 0) return;
  if (productId && relatedIds.includes(productId)) throw new ValidationError("A product cannot be related to itself.");
  const found = await productRepository.findManyByIds(relatedIds);
  if (found.length !== new Set(relatedIds).size) {
    throw new ValidationError("relatedProductIds must all refer to real products.");
  }
}

async function assertIndustriesUsable(industryIds: string[] | undefined): Promise<void> {
  if (!industryIds || industryIds.length === 0) return;
  const found = await industryRepository.findManyByIds(industryIds);
  if (found.length !== new Set(industryIds).size) {
    throw new ValidationError("industryIds must all refer to real industries.");
  }
}

export const productService = {
  async listProducts(filters: ProductFilters, page: number, limit: number, sort: string, order: "asc" | "desc") {
    return productRepository.list(filters, page, limit, sort, order);
  },

  async getProduct(id: string): Promise<ProductWithDetail> {
    return loadProductDetailOrThrow(id);
  },

  async listRevisions(id: string) {
    await loadProductOrThrow(id);
    return productRepository.listRevisions(id);
  },

  async createProduct(caller: SanitizedUser, input: CreateProductInput, meta: RequestMeta = {}): Promise<ProductWithDetail> {
    const existingCode = await productRepository.findByCode(input.code);
    if (existingCode) throw new ConflictError(`A product with code "${input.code}" already exists.`, { existingProductId: existingCode.id });

    let slug: string;
    if (input.slug) {
      const existingSlug = await productRepository.findBySlug(input.slug);
      if (existingSlug) throw new ConflictError(`A product with slug "${input.slug}" already exists.`, { existingProductId: existingSlug.id });
      slug = input.slug;
    } else {
      slug = await productRepository.findUniqueSlug(input.name);
    }

    await Promise.all([
      assertFeaturedMediaUsable(input.featuredMediaId),
      assertCategoryUsable(input.categoryId),
      assertCtaFormUsable(input.content?.ctaFormId),
      assertRelatedProductsUsable(null, input.relatedProductIds),
      assertIndustriesUsable(input.industryIds),
    ]);

    const content: ProductContentInput = input.content ?? {};

    let productId: string;
    try {
      productId = await prisma.$transaction(async (tx) => {
        const product = await tx.product.create({
          data: {
            code: input.code,
            name: input.name,
            slug,
            type: input.type,
            shortDescription: input.shortDescription,
            description: input.description,
            status: input.status ?? "DRAFT",
            isFeatured: input.isFeatured ?? false,
            displayOrder: input.displayOrder ?? 0,
            featuredMediaId: input.featuredMediaId,
            categoryId: input.categoryId,
            createdById: caller.id,
            updatedById: caller.id,
          },
        });
        const revision = await tx.productRevision.create({
          data: { productId: product.id, version: 1, name: input.name, content: content as Prisma.InputJsonValue, createdById: caller.id },
        });
        await tx.product.update({ where: { id: product.id }, data: { currentRevisionId: revision.id } });
        return product.id;
      });
    } catch (err) {
      throw isUniqueConstraintError(err) ? new ConflictError("A product with this code or slug already exists.") : err;
    }

    if (input.relatedProductIds) await productRepository.setRelatedProducts(productId, input.relatedProductIds, caller.id);
    if (input.industryIds) await productRepository.setIndustries(productId, input.industryIds);

    await auditLogRepository.record({
      actorUserId: caller.id,
      actorType: "USER",
      action: "PRODUCT_CREATED",
      resourceType: "product",
      resourceId: productId,
      afterData: { code: input.code, name: input.name, type: input.type, status: input.status ?? "DRAFT" },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return loadProductDetailOrThrow(productId);
  },

  async updateProduct(caller: SanitizedUser, id: string, input: UpdateProductInput, meta: RequestMeta = {}): Promise<ProductWithDetail> {
    const existing = await loadProductDetailOrThrow(id);
    if (TERMINAL_STATUSES.has(existing.status)) {
      throw new ConflictError("This product is archived and can no longer be edited.");
    }
    if (input.status !== undefined) {
      if (input.status === "ARCHIVED") {
        throw new ValidationError('Use POST /products/:id/archive to archive a product — status cannot be set to "ARCHIVED" directly.');
      }
      assertValidTransition(existing.status, input.status);
    }

    if (input.slug !== undefined && input.slug !== existing.slug) {
      const dup = await productRepository.findBySlug(input.slug);
      if (dup && dup.id !== id) throw new ConflictError(`A product with slug "${input.slug}" already exists.`, { existingProductId: dup.id });
    }

    await Promise.all([
      assertFeaturedMediaUsable(input.featuredMediaId),
      assertCategoryUsable(input.categoryId),
      assertCtaFormUsable(input.content?.ctaFormId),
      assertRelatedProductsUsable(id, input.relatedProductIds),
      assertIndustriesUsable(input.industryIds),
    ]);

    const patch: Record<string, unknown> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.slug !== undefined) patch.slug = input.slug;
    if (input.type !== undefined) patch.type = input.type;
    if (input.shortDescription !== undefined) patch.shortDescription = input.shortDescription;
    if (input.description !== undefined) patch.description = input.description;
    if (input.status !== undefined) patch.status = input.status;
    if (input.isFeatured !== undefined) patch.isFeatured = input.isFeatured;
    if (input.displayOrder !== undefined) patch.displayOrder = input.displayOrder;
    if (input.featuredMediaId !== undefined) patch.featuredMediaId = input.featuredMediaId;
    if (input.categoryId !== undefined) patch.categoryId = input.categoryId;
    patch.updatedById = caller.id;

    try {
      await prisma.$transaction(async (tx) => {
        if (Object.keys(patch).length > 0) {
          await tx.product.update({ where: { id }, data: patch as Prisma.ProductUpdateInput });
        }
        if (input.content !== undefined) {
          const currentContent = (existing.currentRevision?.content ?? {}) as ProductContentInput;
          const nextContent: ProductContentInput = { ...currentContent, ...input.content };
          const nextVersion = (existing.currentRevision?.version ?? 0) + 1;
          const revision = await tx.productRevision.create({
            data: { productId: id, version: nextVersion, name: input.name ?? existing.name, content: nextContent as Prisma.InputJsonValue, createdById: caller.id },
          });
          await tx.product.update({ where: { id }, data: { currentRevisionId: revision.id } });
        }
      });
    } catch (err) {
      throw isUniqueConstraintError(err) ? new ConflictError("A product with this slug already exists.") : err;
    }

    if (input.relatedProductIds !== undefined) await productRepository.setRelatedProducts(id, input.relatedProductIds, caller.id);
    if (input.industryIds !== undefined) await productRepository.setIndustries(id, input.industryIds);

    await auditLogRepository.record({
      actorUserId: caller.id,
      actorType: "USER",
      action: "PRODUCT_UPDATED",
      resourceType: "product",
      resourceId: id,
      beforeData: { status: existing.status, name: existing.name },
      afterData: patch,
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return loadProductDetailOrThrow(id);
  },

  async revertProduct(caller: SanitizedUser, id: string, revisionId: string, meta: RequestMeta = {}): Promise<ProductWithDetail> {
    const existing = await loadProductDetailOrThrow(id);
    if (TERMINAL_STATUSES.has(existing.status)) throw new ConflictError("This product is archived and can no longer be edited.");

    const target = await productRepository.findRevision(id, revisionId);
    if (!target) throw new NotFoundError("Revision not found on this product.");

    const nextVersion = (existing.currentRevision?.version ?? 0) + 1;
    const revision = await productRepository.createRevision({ productId: id, version: nextVersion, name: target.name, content: target.content as Prisma.InputJsonValue, createdById: caller.id });
    await productRepository.update(id, { currentRevisionId: revision.id, updatedById: caller.id });

    await auditLogRepository.record({
      actorUserId: caller.id,
      actorType: "USER",
      action: "PRODUCT_REVERTED",
      resourceType: "product",
      resourceId: id,
      beforeData: { fromVersion: existing.currentRevision?.version, revertedToVersion: target.version },
      afterData: { newVersion: nextVersion },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return loadProductDetailOrThrow(id);
  },

  async duplicateProduct(caller: SanitizedUser, id: string, name: string | undefined, meta: RequestMeta = {}): Promise<ProductWithDetail> {
    const existing = await loadProductDetailOrThrow(id);
    const baseName = name ?? `${existing.name} (Copy)`;
    const slug = await productRepository.findUniqueSlug(baseName);
    const code = await (async () => {
      const base = existing.code.replace(/-COPY(-\d+)?$/, "");
      let candidate = `${base}-COPY`;
      let attempt = 1;
      while (await productRepository.findByCode(candidate)) {
        attempt += 1;
        candidate = `${base}-COPY-${attempt}`;
        if (attempt > 50) break;
      }
      return candidate;
    })();
    const sourceContent = existing.currentRevision?.content ?? {};

    const productId = await prisma.$transaction(async (tx) => {
      const product = await tx.product.create({
        data: {
          code,
          name: baseName,
          slug,
          type: existing.type,
          shortDescription: existing.shortDescription,
          description: existing.description,
          status: "DRAFT",
          isFeatured: false,
          displayOrder: existing.displayOrder,
          featuredMediaId: existing.featuredMediaId,
          categoryId: existing.categoryId,
          createdById: caller.id,
          updatedById: caller.id,
        },
      });
      const revision = await tx.productRevision.create({
        data: { productId: product.id, version: 1, name: baseName, content: sourceContent as Prisma.InputJsonValue, createdById: caller.id },
      });
      await tx.product.update({ where: { id: product.id }, data: { currentRevisionId: revision.id } });
      return product.id;
    });

    const industryIds = existing.industries.map((i) => i.industryId);
    if (industryIds.length > 0) await productRepository.setIndustries(productId, industryIds);

    await auditLogRepository.record({
      actorUserId: caller.id,
      actorType: "USER",
      action: "PRODUCT_DUPLICATED",
      resourceType: "product",
      resourceId: productId,
      afterData: { duplicatedFromId: id, name: baseName },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return loadProductDetailOrThrow(productId);
  },

  async archiveProduct(caller: SanitizedUser, id: string, meta: RequestMeta = {}): Promise<Product> {
    const existing = await loadProductOrThrow(id);
    if (existing.status === "ARCHIVED") {
      throw new ConflictError("This product is already archived.");
    }

    // Never a physical delete (§15/§40) — historical/future commercial
    // references (Subscription.productId) always resolve.
    const archived = await productRepository.update(id, { status: "ARCHIVED", updatedBy: { connect: { id: caller.id } } });

    await auditLogRepository.record({
      actorUserId: caller.id,
      actorType: "USER",
      action: "PRODUCT_ARCHIVED",
      resourceType: "product",
      resourceId: id,
      beforeData: { status: existing.status },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return archived;
  },

  /** Phase 10 — bulk archive, the one bulk action that's unambiguous and safe for a catalog that's never hard-deleted. */
  async bulkArchiveProducts(caller: SanitizedUser, ids: string[], meta: RequestMeta = {}): Promise<{ archived: number; skipped: string[] }> {
    const skipped: string[] = [];
    let archived = 0;
    for (const id of ids) {
      try {
        await productService.archiveProduct(caller, id, meta);
        archived += 1;
      } catch {
        skipped.push(id);
      }
    }
    return { archived, skipped };
  },
};
