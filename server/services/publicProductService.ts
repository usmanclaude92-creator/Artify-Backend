/**
 * Public website product/service/solution catalog projection (Phase 11 —
 * docs/PUBLIC_API_ARCHITECTURE.md; extended Phase 10 — Products + Services
 * + Solutions). Read-only, unauthenticated. Product/ProductModule are
 * platform-global (no organization scoping — see productRepository.ts), so
 * unlike CMS content this needs no `PUBLIC_WEBSITE_ORGANIZATION_ID`
 * resolution for the Product row itself — only for the tenant-scoped rows
 * (MediaAsset/Form) a Product may optionally reference. Only `ACTIVE`
 * products and `ACTIVE` modules are ever visible — DRAFT/INACTIVE/ARCHIVED
 * are never returned, and no internal field (createdById/updatedById/
 * configuration) is included.
 */
import { productRepository } from "../repositories/productRepository";
import { productModuleRepository } from "../repositories/productModuleRepository";
import { productCategoryRepository } from "../repositories/productCategoryRepository";
import { industryRepository } from "../repositories/industryRepository";
import { mediaRepository } from "../repositories/mediaRepository";
import { publicFormService } from "./publicFormService";
import { projectPublicMedia } from "./publicSiteService";
import { config } from "../config/env";
import { NotFoundError } from "../core/errors";
import type { Product, ProductModule, ProductCategory, Industry } from "@prisma/client";

function projectCategory(category: ProductCategory | null) {
  if (!category) return null;
  return { slug: category.slug, name: category.name, description: category.description };
}

function projectIndustry(industry: Industry) {
  return { slug: industry.slug, name: industry.name, description: industry.description };
}

function projectRelatedProduct(p: Pick<Product, "slug" | "name" | "type" | "status">) {
  return { slug: p.slug, name: p.name, type: p.type };
}

async function projectFeaturedMedia(mediaId: string | null) {
  if (!mediaId) return null;
  const orgId = config.publicWebsiteOrganizationId;
  if (!orgId) return null;
  const media = await mediaRepository.findByIdInOrg(mediaId, orgId);
  return projectPublicMedia(media);
}

async function projectCtaForm(ctaFormId: string | undefined | null) {
  if (!ctaFormId) return null;
  try {
    return await publicFormService.getFormForRender({ id: ctaFormId });
  } catch (err) {
    // A CTA referencing a form that's since been archived/deleted degrades
    // to "no CTA" — never a 500, never fabricated form data.
    if (err instanceof NotFoundError) return null;
    throw err;
  }
}

async function projectProductBasic(product: Product) {
  return {
    slug: product.slug,
    code: product.code,
    name: product.name,
    type: product.type,
    shortDescription: product.shortDescription,
    description: product.description,
    isFeatured: product.isFeatured,
    displayOrder: product.displayOrder,
  };
}

async function projectProductDetail(product: Product & { category: ProductCategory | null; currentRevision: { content: unknown } | null; industries: { industry: Industry }[]; relatedFrom: { toProduct: Pick<Product, "slug" | "name" | "type" | "status"> }[]; relatedTo: { fromProduct: Pick<Product, "slug" | "name" | "type" | "status"> }[] }) {
  const content = (product.currentRevision?.content ?? {}) as {
    benefits?: string[];
    features?: string[];
    businessProblem?: string;
    ctaFormId?: string;
    seo?: Record<string, unknown>;
  };
  const relatedProducts = [
    ...product.relatedFrom.map((r) => r.toProduct),
    ...product.relatedTo.map((r) => r.fromProduct),
  ]
    .filter((p) => p.status === "ACTIVE")
    .map(projectRelatedProduct);

  const [featuredMedia, ctaForm] = await Promise.all([projectFeaturedMedia(product.featuredMediaId), projectCtaForm(content.ctaFormId)]);

  return {
    ...(await projectProductBasic(product)),
    category: projectCategory(product.category),
    featuredMedia,
    benefits: content.benefits ?? [],
    features: content.features ?? [],
    businessProblem: content.businessProblem ?? null,
    seo: content.seo ?? {},
    ctaForm,
    relatedProducts,
    industries: product.industries.map((i) => projectIndustry(i.industry)),
  };
}

function projectModule(module_: ProductModule) {
  return {
    slug: module_.slug,
    code: module_.code,
    name: module_.name,
    description: module_.description,
    isCore: module_.isCore,
    displayOrder: module_.displayOrder,
  };
}

export const publicProductService = {
  async listProducts(filters: { search?: string; type?: string; categorySlug?: string; industrySlug?: string }, page: number, limit: number) {
    const categoryId = filters.categorySlug ? (await productCategoryRepository.findBySlug(filters.categorySlug))?.id : undefined;
    const industryId = filters.industrySlug ? (await industryRepository.findBySlug(filters.industrySlug))?.id : undefined;
    const { rows, total } = await productRepository.list(
      { search: filters.search, type: filters.type, status: "ACTIVE", categoryId, industryId },
      page,
      limit,
      "displayOrder",
      "asc"
    );
    return { rows: await Promise.all(rows.map(projectProductBasic)), total };
  },

  async getProductBySlug(slug: string) {
    const product = await productRepository.findBySlug(slug);
    if (!product || product.status !== "ACTIVE") throw new NotFoundError("Product not found.");
    const detail = await productRepository.findByIdWithDetail(product.id);
    if (!detail) throw new NotFoundError("Product not found.");
    return projectProductDetail(detail);
  },

  async getProductModules(slug: string) {
    const product = await productRepository.findBySlug(slug);
    if (!product || product.status !== "ACTIVE") throw new NotFoundError("Product not found.");
    const { rows } = await productModuleRepository.listForProduct(product.id, "ACTIVE", 1, 100);
    return rows.map(projectModule);
  },

  async listProductCategories() {
    const categories = await productCategoryRepository.list();
    return categories.map((c) => ({ slug: c.slug, name: c.name, description: c.description }));
  },

  async listIndustries() {
    const industries = await industryRepository.list();
    return industries.map(projectIndustry);
  },
};
