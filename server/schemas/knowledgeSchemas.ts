import { z } from "zod";

const knowledgeAccessPolicySchema = z.enum(["PUBLIC", "RESTRICTED", "ROLE_BASED", "OWNER_ONLY"]);
const knowledgeSourceTypeSchema = z.enum([
  "UPLOADED_DOCUMENT",
  "MEDIA_ASSET",
  "CMS_CONTENT",
  "CRM_CLIENT",
  "CRM_LEAD",
  "PROJECT",
  "PRODUCT_CATALOG",
  "BILLING_RECORD",
  "MANUAL_ENTRY",
  "EXTERNAL_CONNECTOR",
]);

export const createCollectionSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  accessPolicy: knowledgeAccessPolicySchema.optional(),
  allowedRoles: z.array(z.string().trim().min(1)).max(50).optional(),
  metadata: z.record(z.unknown()).optional(),
});
export type CreateCollectionInput = z.infer<typeof createCollectionSchema>;

export const registerSourceSchema = z.object({
  collectionId: z.string().trim().uuid().optional(),
  name: z.string().trim().min(1).max(200),
  sourceType: knowledgeSourceTypeSchema,
  entityType: z.string().trim().max(100).optional(),
  entityId: z.string().trim().max(200).optional(),
  config: z.record(z.unknown()).optional(),
});
export type RegisterSourceInput = z.infer<typeof registerSourceSchema>;

export const listDocumentsQuerySchema = z.object({
  collectionId: z.string().trim().uuid().optional(),
  sourceId: z.string().trim().uuid().optional(),
  status: z.enum(["UPLOADED", "PROCESSING", "EXTRACTED", "CHUNKED", "INDEXING", "INDEXED", "FAILED", "ARCHIVED"]).optional(),
});
export type ListDocumentsQuery = z.infer<typeof listDocumentsQuerySchema>;

// Text uploads are capped well under the base64-upload's own 25mb request
// limit; a raw-text ingestion this large is almost certainly a mistake, not
// a legitimate document.
export const uploadDocumentSchema = z
  .object({
    text: z.string().max(2_000_000).optional(),
    contentBase64: z.string().max(40_000_000).optional(),
    mimeType: z.string().trim().max(100).optional(),
    filename: z.string().trim().max(300).optional(),
    title: z.string().trim().max(300).optional(),
    description: z.string().trim().max(2000).optional(),
    collectionId: z.string().trim().uuid().optional(),
    sourceId: z.string().trim().uuid().optional(),
    securityScope: z.string().trim().max(100).optional(),
    requiredRole: z.string().trim().max(100).optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .refine((v) => v.contentBase64 !== undefined || v.text !== undefined, {
    message: "Either text or contentBase64 is required.",
  });
export type UploadDocumentInput = z.infer<typeof uploadDocumentSchema>;

export const searchKnowledgeSchema = z.object({
  query: z.string().trim().min(1).max(2000),
  mode: z.enum(["KEYWORD", "SEMANTIC", "HYBRID"]).optional(),
  limit: z.coerce.number().int().positive().max(50).optional(),
  minScore: z.coerce.number().min(0).max(1).optional(),
  filter: z.record(z.unknown()).optional(),
});
export type SearchKnowledgeInput = z.infer<typeof searchKnowledgeSchema>;
