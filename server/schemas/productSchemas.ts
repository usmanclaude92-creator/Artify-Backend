import { z } from "zod";
import { seoMetadataSchema } from "./contentSchemas";

// Phase 10 — SOLUTION added. A Service/Solution is the same Product row as
// a Product, differentiated only by this value (see schema.prisma's own
// doc comment) — never a second table.
export const productTypeSchema = z.enum(["PRODUCT", "SERVICE", "SOLUTION"]);
export const productStatusSchema = z.enum(["DRAFT", "ACTIVE", "INACTIVE", "ARCHIVED"]);

const SORT_FIELDS = ["name", "code", "type", "status", "displayOrder", "createdAt", "updatedAt"] as const;

export const listProductsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().trim().max(200).optional(),
  type: productTypeSchema.optional(),
  status: productStatusSchema.optional(),
  isFeatured: z.coerce.boolean().optional(),
  categoryId: z.string().trim().uuid().optional(),
  industryId: z.string().trim().uuid().optional(),
  sort: z.enum(SORT_FIELDS).default("displayOrder"),
  order: z.enum(["asc", "desc"]).default("asc"),
});
export type ListProductsQuery = z.infer<typeof listProductsQuerySchema>;

// Phase 10 — the editorial content the brief asks to be revisioned
// (benefits/features/business problem/CTA/SEO). Not type-restricted at the
// schema level (a PRODUCT can have benefits too) — `type` only changes
// which fields the Control Center UI surfaces, never what the server
// accepts, so switching a row's type later never silently drops data.
export const productContentSchema = z.object({
  benefits: z.array(z.string().trim().min(1).max(200)).max(20).optional(),
  features: z.array(z.string().trim().min(1).max(200)).max(20).optional(),
  businessProblem: z.string().trim().max(2000).optional(),
  // Validated for real existence against the public org's Forms at save
  // time in productService — never trusted as a bare uuid alone.
  ctaFormId: z.string().trim().uuid().optional(),
  seo: seoMetadataSchema.optional(),
});
export type ProductContentInput = z.infer<typeof productContentSchema>;

const codeSchema = z
  .string()
  .trim()
  .min(1)
  .max(50)
  .regex(/^[A-Za-z0-9._-]+$/, "code may only contain letters, numbers, dots, underscores, and hyphens")
  .transform((v) => v.toUpperCase());

export const createProductSchema = z.object({
  code: codeSchema,
  name: z.string().trim().min(1).max(200),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9-]+$/, "slug must be lowercase, URL-safe (letters, numbers, hyphens)")
    .optional(),
  type: productTypeSchema,
  shortDescription: z.string().trim().max(300).optional(),
  description: z.string().trim().max(10000).optional(),
  status: productStatusSchema.optional(),
  isFeatured: z.boolean().optional(),
  displayOrder: z.number().int().min(0).optional(),
  featuredMediaId: z.string().trim().uuid().optional(),
  categoryId: z.string().trim().uuid().optional(),
  content: productContentSchema.optional(),
  relatedProductIds: z.array(z.string().trim().uuid()).max(30).optional(),
  industryIds: z.array(z.string().trim().uuid()).max(30).optional(),
});
export type CreateProductInput = z.infer<typeof createProductSchema>;

export const updateProductSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    slug: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .regex(/^[a-z0-9-]+$/, "slug must be lowercase, URL-safe (letters, numbers, hyphens)")
      .optional(),
    type: productTypeSchema.optional(),
    shortDescription: z.string().trim().max(300).nullable().optional(),
    description: z.string().trim().max(10000).nullable().optional(),
    status: productStatusSchema.optional(),
    isFeatured: z.boolean().optional(),
    displayOrder: z.number().int().min(0).optional(),
    featuredMediaId: z.string().trim().uuid().nullable().optional(),
    categoryId: z.string().trim().uuid().nullable().optional(),
    content: productContentSchema.optional(),
    relatedProductIds: z.array(z.string().trim().uuid()).max(30).optional(),
    industryIds: z.array(z.string().trim().uuid()).max(30).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "At least one field must be provided." });
export type UpdateProductInput = z.infer<typeof updateProductSchema>;

export const revertProductSchema = z.object({
  revisionId: z.string().trim().uuid(),
});
export type RevertProductInput = z.infer<typeof revertProductSchema>;

export const duplicateProductSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
});
export type DuplicateProductInput = z.infer<typeof duplicateProductSchema>;

export const bulkArchiveProductsSchema = z.object({
  ids: z.array(z.string().trim().uuid()).min(1).max(100),
});
export type BulkArchiveProductsInput = z.infer<typeof bulkArchiveProductsSchema>;
