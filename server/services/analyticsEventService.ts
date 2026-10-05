/**
 * Analytics event ingestion (Phase 15 — docs/ANALYTICS_ARCHITECTURE.md §3).
 * A small, deliberate set of event types — "avoid excessive tracking" — on
 * two separate emission paths:
 *
 *  - Public, client-observable events (`PUBLIC_EVENT_TYPES`) — ingested
 *    directly from an anonymous visitor's browser via the rate-limited
 *    `POST /public/analytics/events` endpoint, always under
 *    `config.publicWebsiteOrganizationId`, never a caller-supplied org.
 *    This is real first-party data the moment it is deployed — not
 *    fabricated — but the client is only ever trusted for passive,
 *    low-stakes signals (what page, what referrer/UTM), never for a
 *    business outcome.
 *  - Business events — emitted server-side, best-effort, by the real
 *    service that already performs that action (publicLeadService,
 *    publicFormService, leadService, opportunityService) — never trusted
 *    from client input, exactly like this codebase's existing
 *    eventEngine.emit() call sites.
 */
import { analyticsEventRepository, type AnalyticsEventInput } from "../repositories/analyticsEventRepository";
import { campaignAttributionService } from "./campaignAttributionService";
import { config } from "../config/env";
import { logger } from "../core/logger";

export const PUBLIC_EVENT_TYPES = ["page_view", "cta_click", "content_interaction"] as const;
export type PublicEventType = (typeof PUBLIC_EVENT_TYPES)[number];

export interface PublicEventInput {
  eventType: PublicEventType;
  path?: string;
  referrer?: string;
  sessionId?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmTerm?: string;
  utmContent?: string;
}

export const analyticsEventService = {
  /**
   * Public, anonymous ingestion. Silently no-ops (never throws, never
   * blocks the visitor's page) when the platform has no configured public
   * website organization — the "analytics source not configured" state,
   * never a fabricated event.
   */
  async recordPublicEvent(input: PublicEventInput): Promise<void> {
    const organizationId = config.publicWebsiteOrganizationId;
    if (!organizationId) return;

    try {
      const campaignId = await campaignAttributionService.resolveCampaignId(organizationId, input.utmCampaign);
      await analyticsEventRepository.create({
        organizationId,
        eventType: input.eventType,
        path: input.path,
        referrer: input.referrer,
        sessionId: input.sessionId,
        utmSource: input.utmSource,
        utmMedium: input.utmMedium,
        utmCampaign: input.utmCampaign,
        utmTerm: input.utmTerm,
        utmContent: input.utmContent,
        campaignId,
      });
    } catch (err) {
      logger.error({ err }, "[analyticsEventService] public event ingestion failed");
    }
  },

  /** Server-side business-event emission — best-effort, never throws (same call-site convention as eventEngine.emit). */
  async recordBusinessEvent(input: AnalyticsEventInput): Promise<void> {
    try {
      await analyticsEventRepository.create(input);
    } catch (err) {
      logger.error({ err }, "[analyticsEventService] business event record failed");
    }
  },
};
