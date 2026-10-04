/**
 * Analytics API schemas (Phase 15 — docs/ANALYTICS_ARCHITECTURE.md). The
 * public ingestion schema deliberately accepts only the same class of
 * passive, low-stakes field an anonymous visitor's browser can observe
 * about itself — never an organizationId, entityId, or anything else that
 * would let the client fabricate attribution to a business record.
 */
import { z } from "zod";
import { PUBLIC_EVENT_TYPES } from "../services/analyticsEventService";

export const publicAnalyticsEventSchema = z.object({
  eventType: z.enum(PUBLIC_EVENT_TYPES),
  path: z.string().trim().max(500).optional(),
  referrer: z.string().trim().max(2000).optional(),
  sessionId: z.string().trim().max(100).optional(),
  utmSource: z.string().trim().max(200).optional(),
  utmMedium: z.string().trim().max(200).optional(),
  utmCampaign: z.string().trim().max(200).optional(),
  utmTerm: z.string().trim().max(200).optional(),
  utmContent: z.string().trim().max(200).optional(),
});
export type PublicAnalyticsEventInput = z.infer<typeof publicAnalyticsEventSchema>;

const dateRangeShape = {
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  compare: z.coerce.boolean().optional().default(false),
};

export const analyticsOverviewQuerySchema = z.object(dateRangeShape);
export type AnalyticsOverviewQuery = z.infer<typeof analyticsOverviewQuerySchema>;

export const analyticsTopPagesQuerySchema = z.object({
  ...dateRangeShape,
  limit: z.coerce.number().int().positive().max(50).default(10),
});
export type AnalyticsTopPagesQuery = z.infer<typeof analyticsTopPagesQuerySchema>;

export const REPORT_TYPES = [
  "executive_summary",
  "website_performance",
  "content_performance",
  "seo_report",
  "lead_generation",
  "crm_pipeline",
  "campaign_performance",
  "conversion_report",
  "client_acquisition",
] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

export const reportQuerySchema = z.object({
  ...dateRangeShape,
  format: z.enum(["json", "csv"]).default("json"),
});
export type ReportQuery = z.infer<typeof reportQuerySchema>;
