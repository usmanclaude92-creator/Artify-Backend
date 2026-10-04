/**
 * Shared UTM -> Campaign attribution resolver (Phase 14 —
 * docs/MARKETING_ARCHITECTURE.md §3). The single place every intake path
 * (publicFormService, publicLeadService, leadService.convertLead,
 * opportunityService) resolves a submitted utm_campaign value to a real
 * Campaign row — never a parallel/duplicate attribution system. Matching
 * is case-insensitive against this organization's own Campaign.utmCampaign
 * (campaignRepository.findActiveByUtmCampaignInOrg); an ARCHIVED campaign
 * or no match at all resolves to `undefined` (never fabricated, never
 * throws — a visitor's unrecognized or stale utm_campaign must never
 * block their submission).
 */
import { campaignRepository } from "../repositories/campaignRepository";

export const campaignAttributionService = {
  async resolveCampaignId(organizationId: string, utmCampaign: string | undefined | null): Promise<string | undefined> {
    if (!utmCampaign || !utmCampaign.trim()) return undefined;
    const campaign = await campaignRepository.findActiveByUtmCampaignInOrg(organizationId, utmCampaign.trim());
    return campaign?.id;
  },
};
