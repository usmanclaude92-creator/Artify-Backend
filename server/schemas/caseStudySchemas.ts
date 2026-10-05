/**
 * Case Study management (Phase 11 — docs/CASE_STUDY_ARCHITECTURE.md). Mirrors
 * postSchemas.ts/pageSchemas.ts exactly: title/slug/body/excerpt/metadata/
 * editorBlocks/status/expectedUpdatedAt all behave identically to Post/Page.
 * The fields unique to a Case Study (clientName, industryId, and the
 * structured challenge/solution/implementation/results/testimonial/
 * technologies/gallery/CTA content) are carried in `content`, stored
 * verbatim in ContentRevision.metadata the same way Page/Post already
 * store their SEO metadata there — `caseStudyContentSchema` below extends
 * `seoMetadataSchema` with `.strict()` preserved, so an unknown key is
 * still rejected outright rather than silently dropped.
 */
import { z } from "zod";
import { patchableContentStatusSchema, expectedUpdatedAtSchema, seoMetadataSchema } from "./contentSchemas";
import { editorDocumentSchema } from "./editorSchemas";

const slugSchema = z
  .string()
  .trim()
  .min(1)
  .max(150)
  .regex(/^[a-z0-9-]+$/, "slug must be lowercase, URL-safe (letters, numbers, hyphens)");

const uuidArray = (max: number) => z.array(z.string().trim().uuid()).max(max);

/**
 * Structured Case Study fields, stored on ContentRevision.metadata
 * alongside SEO — see seoMetadataSchema's own doc comment for why this
 * is `.strict()` rather than `z.record(z.unknown())`: a naming drift
 * between the Control Center and the public renderer must fail loudly
 * at save time, not quietly lose a field.
 */
export const caseStudyContentSchema = seoMetadataSchema.extend({
  challenge: z.string().trim().max(5000).optional(),
  solutionApproach: z.string().trim().max(5000).optional(),
  implementation: z.string().trim().max(5000).optional(),
  results: z.string().trim().max(5000).optional(),
  testimonialQuote: z.string().trim().max(2000).optional(),
  testimonialAuthorName: z.string().trim().max(150).optional(),
  testimonialAuthorTitle: z.string().trim().max(150).optional(),
  technologies: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
  galleryMediaIds: uuidArray(30).optional(),
  ctaFormId: z.string().trim().uuid().optional(),
});
export type CaseStudyContentInput = z.infer<typeof caseStudyContentSchema>;

export const createCaseStudySchema = z.object({
  title: z.string().trim().min(1).max(200),
  slug: slugSchema.optional(),
  body: z.string().trim().max(500000).default(""),
  excerpt: z.string().trim().max(500).optional(),
  content: caseStudyContentSchema.optional(),
  editorBlocks: editorDocumentSchema.optional(),
  clientName: z.string().trim().min(1).max(200).optional(),
  industryId: z.string().trim().uuid().optional(),
  featuredMediaId: z.string().trim().uuid().optional(),
  productIds: uuidArray(50).optional(),
  relatedPageIds: uuidArray(50).optional(),
  relatedPostIds: uuidArray(50).optional(),
});
export type CreateCaseStudyInput = z.infer<typeof createCaseStudySchema>;

export const updateCaseStudySchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    slug: slugSchema.optional(),
    body: z.string().trim().max(500000).optional(),
    excerpt: z.string().trim().max(500).nullable().optional(),
    content: caseStudyContentSchema.optional(),
    editorBlocks: editorDocumentSchema.nullable().optional(),
    status: patchableContentStatusSchema.optional(),
    clientName: z.string().trim().min(1).max(200).nullable().optional(),
    industryId: z.string().trim().uuid().nullable().optional(),
    featuredMediaId: z.string().trim().uuid().nullable().optional(),
    productIds: uuidArray(50).optional(),
    relatedPageIds: uuidArray(50).optional(),
    relatedPostIds: uuidArray(50).optional(),
    expectedUpdatedAt: expectedUpdatedAtSchema,
  })
  .refine((v) => Object.keys(v).filter((k) => k !== "expectedUpdatedAt").length > 0, { message: "At least one field must be provided." });
export type UpdateCaseStudyInput = z.infer<typeof updateCaseStudySchema>;

export const listCaseStudiesQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().trim().max(200).optional(),
  status: z.enum(["DRAFT", "IN_REVIEW", "SCHEDULED", "PUBLISHED", "ARCHIVED"]).optional(),
  industryId: z.string().trim().uuid().optional(),
  productId: z.string().trim().uuid().optional(),
  fromDate: z.coerce.date().optional(),
  toDate: z.coerce.date().optional(),
  sort: z.enum(["title", "slug", "status", "createdAt", "updatedAt", "publishedAt"]).default("updatedAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
});
export type ListCaseStudiesQuery = z.infer<typeof listCaseStudiesQuerySchema>;
