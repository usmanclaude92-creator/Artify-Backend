/** Template/TemplatePart schema fragments (Phase 1 — docs/control-center-replacement-roadmap.md). Mirrors contentSchemas.ts/pageSchemas.ts exactly. */
import { z } from "zod";
import { expectedUpdatedAtSchema } from "./contentSchemas";

export const templateTypeSchema = z.enum([
  "HOMEPAGE",
  "STANDARD_PAGE",
  "BLOG_INDEX",
  "SINGLE_POST",
  "CATEGORY",
  "TAG",
  "SEARCH",
  "ARCHIVE",
  "AUTHOR",
  "NOT_FOUND",
  "PRODUCT",
  "SERVICE",
  "SOLUTION",
  "CASE_STUDY",
  "LANDING_PAGE",
]);

export const templatePartTypeSchema = z.enum([
  "HEADER",
  "FOOTER",
  "PRIMARY_NAVIGATION",
  "MOBILE_HEADER",
  "SIDEBAR",
  "ANNOUNCEMENT_BAR",
  "CTA_SECTION",
  "NEWSLETTER_SECTION",
  "CONTACT_SECTION",
  "SOCIAL_SECTION",
]);

// Only DRAFT/PUBLISHED/ARCHIVED are reachable for Template/TemplatePart —
// no IN_REVIEW/SCHEDULED workflow was scoped for this phase (unlike
// Post/Page's full editorial workflow).
const templateWorkflowStatusSchema = z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]);

const slugSchema = z
  .string()
  .trim()
  .min(1)
  .max(150)
  .regex(/^[a-z0-9-]+$/, "slug must be lowercase, URL-safe (letters, numbers, hyphens)");

const SORT_FIELDS = ["name", "slug", "type", "status", "createdAt", "updatedAt"] as const;

export const listTemplatesQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().trim().max(200).optional(),
  status: templateWorkflowStatusSchema.optional(),
  type: templateTypeSchema.optional(),
  sort: z.enum(SORT_FIELDS).default("updatedAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
});
export type ListTemplatesQuery = z.infer<typeof listTemplatesQuerySchema>;

// `structure`'s shape is deliberately unconstrained JSON in this phase —
// see the Template model's own doc comment in schema.prisma: the
// slot/region shape should be proven against a real page before being
// generalized, not committed to prematurely here.
export const createTemplateSchema = z.object({
  type: templateTypeSchema,
  name: z.string().trim().min(1).max(150),
  slug: slugSchema.optional(),
  description: z.string().trim().max(2000).optional(),
  structure: z.record(z.unknown()).default({}),
});
export type CreateTemplateInput = z.infer<typeof createTemplateSchema>;

export const updateTemplateSchema = z
  .object({
    name: z.string().trim().min(1).max(150).optional(),
    slug: slugSchema.optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    structure: z.record(z.unknown()).optional(),
    expectedUpdatedAt: expectedUpdatedAtSchema,
  })
  .refine((v) => Object.keys(v).filter((k) => k !== "expectedUpdatedAt").length > 0, { message: "At least one field must be provided." });
export type UpdateTemplateInput = z.infer<typeof updateTemplateSchema>;

export const duplicateTemplateSchema = z.object({
  name: z.string().trim().min(1).max(150).optional(),
});
export type DuplicateTemplateInput = z.infer<typeof duplicateTemplateSchema>;

export const revertTemplateSchema = z.object({
  revisionId: z.string().trim().uuid(),
});
export type RevertTemplateInput = z.infer<typeof revertTemplateSchema>;

export const listTemplatePartsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().trim().max(200).optional(),
  status: templateWorkflowStatusSchema.optional(),
  type: templatePartTypeSchema.optional(),
  sort: z.enum(SORT_FIELDS).default("updatedAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
});
export type ListTemplatePartsQuery = z.infer<typeof listTemplatePartsQuerySchema>;

export const createTemplatePartSchema = z.object({
  type: templatePartTypeSchema,
  name: z.string().trim().min(1).max(150),
  slug: slugSchema.optional(),
  content: z.record(z.unknown()).default({}),
});
export type CreateTemplatePartInput = z.infer<typeof createTemplatePartSchema>;

export const updateTemplatePartSchema = z
  .object({
    name: z.string().trim().min(1).max(150).optional(),
    slug: slugSchema.optional(),
    content: z.record(z.unknown()).optional(),
    expectedUpdatedAt: expectedUpdatedAtSchema,
  })
  .refine((v) => Object.keys(v).filter((k) => k !== "expectedUpdatedAt").length > 0, { message: "At least one field must be provided." });
export type UpdateTemplatePartInput = z.infer<typeof updateTemplatePartSchema>;

export const duplicateTemplatePartSchema = z.object({
  name: z.string().trim().min(1).max(150).optional(),
});
export type DuplicateTemplatePartInput = z.infer<typeof duplicateTemplatePartSchema>;

export const revertTemplatePartSchema = z.object({
  revisionId: z.string().trim().uuid(),
});
export type RevertTemplatePartInput = z.infer<typeof revertTemplatePartSchema>;
