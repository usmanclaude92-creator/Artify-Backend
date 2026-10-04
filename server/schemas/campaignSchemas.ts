/**
 * Campaign management (Phase 14 — docs/MARKETING_ARCHITECTURE.md). Mirrors
 * caseStudySchemas.ts's productIds/relatedPageIds/relatedPostIds
 * replace-wholesale convention, extended with relatedCaseStudyIds/mediaIds.
 */
import { z } from "zod";

const uuidArray = (max: number) => z.array(z.string().trim().uuid()).max(max);

export const CAMPAIGN_STATUS_VALUES = ["DRAFT", "ACTIVE", "PAUSED", "ARCHIVED"] as const;
export const CAMPAIGN_CHANNEL_VALUES = ["EMAIL", "SOCIAL", "PAID_SEARCH", "PAID_SOCIAL", "CONTENT", "EVENT", "REFERRAL", "DIRECT", "OTHER"] as const;

const utmFieldSchema = z.string().trim().min(1).max(150);

export const createCampaignSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).optional(),
  channel: z.enum(CAMPAIGN_CHANNEL_VALUES).default("OTHER"),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  ownerId: z.string().trim().uuid().optional(),
  budget: z.coerce.number().nonnegative().optional(),
  currency: z.string().trim().length(3).toUpperCase().optional(),
  landingPageId: z.string().trim().uuid().optional(),
  formId: z.string().trim().uuid().optional(),
  utmSource: utmFieldSchema.optional(),
  utmMedium: utmFieldSchema.optional(),
  utmCampaign: utmFieldSchema.optional(),
  utmTerm: utmFieldSchema.optional(),
  utmContent: utmFieldSchema.optional(),
  targetAudience: z.string().trim().max(2000).optional(),
  notes: z.string().trim().max(5000).optional(),
  productIds: uuidArray(50).optional(),
  relatedPageIds: uuidArray(50).optional(),
  relatedPostIds: uuidArray(50).optional(),
  relatedCaseStudyIds: uuidArray(50).optional(),
  mediaIds: uuidArray(50).optional(),
}).refine((v) => !v.startDate || !v.endDate || v.startDate <= v.endDate, { message: "startDate must be before or equal to endDate.", path: ["endDate"] });
export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;

export const updateCampaignSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(5000).nullable().optional(),
    channel: z.enum(CAMPAIGN_CHANNEL_VALUES).optional(),
    startDate: z.coerce.date().nullable().optional(),
    endDate: z.coerce.date().nullable().optional(),
    ownerId: z.string().trim().uuid().nullable().optional(),
    budget: z.coerce.number().nonnegative().nullable().optional(),
    currency: z.string().trim().length(3).toUpperCase().nullable().optional(),
    landingPageId: z.string().trim().uuid().nullable().optional(),
    formId: z.string().trim().uuid().nullable().optional(),
    utmSource: utmFieldSchema.nullable().optional(),
    utmMedium: utmFieldSchema.nullable().optional(),
    utmCampaign: utmFieldSchema.nullable().optional(),
    utmTerm: utmFieldSchema.nullable().optional(),
    utmContent: utmFieldSchema.nullable().optional(),
    targetAudience: z.string().trim().max(2000).nullable().optional(),
    notes: z.string().trim().max(5000).nullable().optional(),
    productIds: uuidArray(50).optional(),
    relatedPageIds: uuidArray(50).optional(),
    relatedPostIds: uuidArray(50).optional(),
    relatedCaseStudyIds: uuidArray(50).optional(),
    mediaIds: uuidArray(50).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "At least one field must be provided." });
export type UpdateCampaignInput = z.infer<typeof updateCampaignSchema>;

export const listCampaignsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().trim().max(200).optional(),
  status: z.enum(CAMPAIGN_STATUS_VALUES).optional(),
  channel: z.enum(CAMPAIGN_CHANNEL_VALUES).optional(),
  ownerId: z.string().trim().uuid().optional(),
  sort: z.enum(["name", "status", "channel", "startDate", "endDate", "createdAt", "updatedAt"]).default("updatedAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
});
export type ListCampaignsQuery = z.infer<typeof listCampaignsQuerySchema>;

export const duplicateCampaignSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
});
export type DuplicateCampaignInput = z.infer<typeof duplicateCampaignSchema>;
