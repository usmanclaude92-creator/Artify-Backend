import { z } from "zod";
import { patchableContentStatusSchema, expectedUpdatedAtSchema, seoMetadataSchema } from "./contentSchemas";

const slugSchema = z
  .string()
  .trim()
  .min(1)
  .max(150)
  .regex(/^[a-z0-9-]+$/, "slug must be lowercase, URL-safe (letters, numbers, hyphens)");

// Phase 1 (Website module) — additive, all-optional fields. A page created
// or edited with none of these behaves exactly as before (templateId
// null, pageType STANDARD, isHomepage false), per
// docs/control-center-data-preservation-plan.md.
const pageTypeSchema = z.enum(["STANDARD", "LANDING"]);

export const createPageSchema = z.object({
  title: z.string().trim().min(1).max(200),
  slug: slugSchema.optional(),
  body: z.string().trim().max(500000).default(""),
  metadata: seoMetadataSchema.optional(),
  featuredMediaId: z.string().trim().uuid().optional(),
  templateId: z.string().trim().uuid().optional(),
  pageType: pageTypeSchema.optional(),
  isHomepage: z.boolean().optional(),
});
export type CreatePageInput = z.infer<typeof createPageSchema>;

export const updatePageSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    slug: slugSchema.optional(),
    body: z.string().trim().max(500000).optional(),
    metadata: seoMetadataSchema.optional(),
    status: patchableContentStatusSchema.optional(),
    featuredMediaId: z.string().trim().uuid().nullable().optional(),
    // null explicitly unassigns the template (falls back to default
    // rendering — see publicSiteService.ts); omitted leaves it unchanged.
    templateId: z.string().trim().uuid().nullable().optional(),
    pageType: pageTypeSchema.optional(),
    isHomepage: z.boolean().optional(),
    expectedUpdatedAt: expectedUpdatedAtSchema,
  })
  .refine((v) => Object.keys(v).filter((k) => k !== "expectedUpdatedAt").length > 0, { message: "At least one field must be provided." });
export type UpdatePageInput = z.infer<typeof updatePageSchema>;
