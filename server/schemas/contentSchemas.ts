/** Shared CMS schema fragments (Phase 8 — docs/CMS_ARCHITECTURE.md). Page/Post each compose these, matching the existing per-resource schema file convention. */
import { z } from "zod";

export const contentStatusSchema = z.enum(["DRAFT", "IN_REVIEW", "SCHEDULED", "PUBLISHED", "ARCHIVED"]);

/**
 * The only status reachable through the generic PATCH status field. Every
 * other forward transition (submit-review, schedule, publish, archive) has
 * its own dedicated endpoint with its own permission tier and content
 * validation — matching the leads.CONVERTED / products.ARCHIVED precedent,
 * extended here to every workflow step, not just the terminal one. PATCH
 * still covers the "back" moves this schema's target allows: IN_REVIEW,
 * SCHEDULED, PUBLISHED, or ARCHIVED -> DRAFT.
 */
export const patchableContentStatusSchema = z.enum(["DRAFT"]);

/** Optimistic-concurrency guard (§12) — when supplied, the update is rejected with 409 unless the resource's updatedAt still matches, preventing a silent lost update. */
export const expectedUpdatedAtSchema = z.coerce.date().optional();

/**
 * Post/Page `metadata` (stored on `ContentRevision.metadata`, exposed
 * publicly as `seo` — see publicSiteService.ts). Field names and value
 * shapes intentionally mirror artifysolscom's `ArticleSeoMetadata` type
 * (src/types.ts) and what `generateBlogPostSeo()`/`updatePageSeo()` there
 * actually read — the two repos must agree on this shape since one writes
 * it and the other renders it. Previously validated as `z.record(z.unknown())`
 * (any shape, any size, silently) — replaced with named+bounded fields so
 * a save can't smuggle in an oversized blob or a key the public site would
 * echo into an attribute/JSON-LD without either side expecting it.
 * `.strict()` rejects unknown keys outright rather than silently dropping
 * them, so a naming drift between the two repos fails loudly at save time
 * instead of quietly losing data.
 */
export const seoMetadataSchema = z
  .object({
    metaTitle: z.string().trim().min(1).max(70).optional(),
    metaDescription: z.string().trim().min(1).max(320).optional(),
    focusKeywords: z.array(z.string().trim().min(1).max(60)).max(10).optional(),
    canonicalUrl: z.string().trim().url().max(500).optional(),
    ogTitle: z.string().trim().min(1).max(95).optional(),
    ogDescription: z.string().trim().min(1).max(320).optional(),
    ogImage: z.string().trim().url().max(1000).optional(),
    twitterImage: z.string().trim().url().max(1000).optional(),
    ogType: z.enum(["article", "website", "news"]).optional(),
    twitterCard: z.enum(["summary_large_image", "summary"]).optional(),
    robotsDirective: z.enum(["index, follow", "noindex, nofollow", "noindex, follow"]).optional(),
    schemaType: z.enum(["TechArticle", "NewsArticle", "BlogPosting", "Report"]).optional(),
  })
  .strict();
export type SeoMetadataInput = z.infer<typeof seoMetadataSchema>;

export const revertContentSchema = z.object({
  revisionId: z.string().trim().uuid(),
});
export type RevertContentInput = z.infer<typeof revertContentSchema>;

const SORT_FIELDS = ["title", "slug", "status", "createdAt", "updatedAt", "publishedAt"] as const;

export const listContentQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().trim().max(200).optional(),
  status: contentStatusSchema.optional(),
  // Phase 7 — Content Dashboard date filtering, inclusive range over createdAt.
  fromDate: z.coerce.date().optional(),
  toDate: z.coerce.date().optional(),
  sort: z.enum(SORT_FIELDS).default("updatedAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
});
export type ListContentQuery = z.infer<typeof listContentQuerySchema>;

export const scheduleContentSchema = z.object({
  scheduledAt: z.coerce.date().refine((d) => d.getTime() > Date.now(), { message: "scheduledAt must be in the future" }),
});
export type ScheduleContentInput = z.infer<typeof scheduleContentSchema>;

const slugSchema = z
  .string()
  .trim()
  .min(1)
  .max(150)
  .regex(/^[a-z0-9-]+$/, "slug must be lowercase, URL-safe (letters, numbers, hyphens)");

export const createCategorySchema = z.object({
  name: z.string().trim().min(1).max(150),
  slug: slugSchema.optional(),
  description: z.string().trim().max(2000).optional(),
  // Phase 7 — optional parent for a simple hierarchy (Category.parentId).
  parentId: z.string().trim().uuid().optional(),
});
export type CreateCategoryInput = z.infer<typeof createCategorySchema>;

export const updateCategorySchema = z
  .object({
    name: z.string().trim().min(1).max(150).optional(),
    slug: slugSchema.optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    parentId: z.string().trim().uuid().nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "At least one field must be provided." });
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;

export const createTagSchema = z.object({
  name: z.string().trim().min(1).max(100),
  slug: slugSchema.optional(),
  // Phase 7 — optional description, matching Category's own field.
  description: z.string().trim().max(2000).optional(),
});
export type CreateTagInput = z.infer<typeof createTagSchema>;

export const updateTagSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  slug: slugSchema.optional(),
  description: z.string().trim().max(2000).nullable().optional(),
}).refine((v) => Object.keys(v).length > 0, { message: "At least one field must be provided." });
export type UpdateTagInput = z.infer<typeof updateTagSchema>;

// Phase 7 — bulk workflow actions for Posts/Pages list views (Content
// Dashboard). Each action reuses the exact single-item service method
// under the hood; this schema is shared by the bulk routes for both
// resources.
export const bulkContentIdsSchema = z.object({
  ids: z.array(z.string().trim().uuid()).min(1).max(100),
});
export type BulkContentIdsInput = z.infer<typeof bulkContentIdsSchema>;
