import { z } from "zod";
import { patchableContentStatusSchema, expectedUpdatedAtSchema, seoMetadataSchema } from "./contentSchemas";
import { editorDocumentSchema } from "./editorSchemas";

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
  // Phase 2 (Site Editor) — additive, optional. A page created without it
  // behaves exactly as before: body/metadata alone drive rendering
  // (publicSiteService.ts falls back whenever editorBlocks is absent).
  editorBlocks: editorDocumentSchema.optional(),
  featuredMediaId: z.string().trim().uuid().optional(),
  templateId: z.string().trim().uuid().optional(),
  pageType: pageTypeSchema.optional(),
  isHomepage: z.boolean().optional(),
  // Phase 5 — additive, optional. A page created without it behaves
  // exactly as before: parentId null, no hierarchy.
  parentId: z.string().trim().uuid().optional(),
});
export type CreatePageInput = z.infer<typeof createPageSchema>;

export const updatePageSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    slug: slugSchema.optional(),
    body: z.string().trim().max(500000).optional(),
    metadata: seoMetadataSchema.optional(),
    // null clears the editor composition (falls back to body-only
    // rendering); omitted leaves it unchanged.
    editorBlocks: editorDocumentSchema.nullable().optional(),
    status: patchableContentStatusSchema.optional(),
    featuredMediaId: z.string().trim().uuid().nullable().optional(),
    // null explicitly unassigns the template (falls back to default
    // rendering — see publicSiteService.ts); omitted leaves it unchanged.
    templateId: z.string().trim().uuid().nullable().optional(),
    pageType: pageTypeSchema.optional(),
    isHomepage: z.boolean().optional(),
    // null explicitly clears the parent (promotes to top-level); omitted
    // leaves it unchanged.
    parentId: z.string().trim().uuid().nullable().optional(),
    expectedUpdatedAt: expectedUpdatedAtSchema,
  })
  .refine((v) => Object.keys(v).filter((k) => k !== "expectedUpdatedAt").length > 0, { message: "At least one field must be provided." });
export type UpdatePageInput = z.infer<typeof updatePageSchema>;
