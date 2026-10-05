/**
 * Marketing dashboard (Phase 14 — docs/MARKETING_ARCHITECTURE.md §1). Pure
 * aggregation across existing domains (Campaign/Lead/Opportunity/Client/
 * Page/Form) — never a parallel analytics store, never fabricated. Every
 * section is `null` (not a zero) when the caller lacks the underlying
 * permission or the platform isn't configured for it, same
 * degrade-gracefully convention as crmRoutes.ts's /crm/summary.
 */
import { campaignRepository } from "../repositories/campaignRepository";
import { leadRepository } from "../repositories/leadRepository";
import { clientRepository } from "../repositories/clientRepository";
import { opportunityRepository } from "../repositories/opportunityRepository";
import { pageRepository } from "../repositories/pageRepository";
import { formRepository } from "../repositories/formRepository";
import { auditLogQueryRepository } from "../repositories/auditLogQueryRepository";

export const marketingService = {
  async getSummary(organizationId: string, permissions: readonly string[]) {
    const canCampaigns = permissions.includes("campaigns.read");
    const canLeads = permissions.includes("leads.read");
    const canOpportunities = permissions.includes("opportunities.read");
    const canClients = permissions.includes("clients.read");
    const canContent = permissions.includes("content.read");
    const canForms = permissions.includes("forms.read");

    const [campaignsByStatus, campaignRecentLeads, leadAttribution, leadSources, utmCampaigns, opportunityConversions, clientConversions, landingPages, forms, recentCampaignActivity] =
      await Promise.all([
        canCampaigns ? campaignRepository.countByStatus(organizationId) : Promise.resolve(null),
        canCampaigns ? campaignRepository.leadCounts(organizationId) : Promise.resolve(null),
        canLeads ? leadRepository.countAttribution(organizationId) : Promise.resolve(null),
        canLeads ? leadRepository.countBySource(organizationId) : Promise.resolve(null),
        canLeads ? campaignRepository.distinctUtmCampaigns(organizationId) : Promise.resolve(null),
        canOpportunities ? opportunityRepository.countAttributedConversions(organizationId) : Promise.resolve(null),
        canClients ? clientRepository.countAttributedConversions(organizationId) : Promise.resolve(null),
        canContent ? pageRepository.countLandingPages(organizationId) : Promise.resolve(null),
        canForms ? formRepository.countForDashboard(organizationId) : Promise.resolve(null),
        canCampaigns ? auditLogQueryRepository.list({ organizationId, resourceType: "campaign" }, 1, 20) : Promise.resolve(null),
      ]);

    return {
      campaigns: campaignsByStatus && {
        total: Object.values(campaignsByStatus).reduce((a, b) => a + b, 0),
        draft: campaignsByStatus.DRAFT ?? 0,
        active: campaignsByStatus.ACTIVE ?? 0,
        paused: campaignsByStatus.PAUSED ?? 0,
        archived: campaignsByStatus.ARCHIVED ?? 0,
        performance: campaignRecentLeads,
      },
      leads: leadAttribution && {
        total: leadAttribution.total,
        attributed: leadAttribution.attributed,
        unattributed: leadAttribution.total - leadAttribution.attributed,
      },
      conversions:
        canOpportunities || canClients
          ? {
              opportunitiesWon: opportunityConversions,
              clientsCreated: clientConversions,
            }
          : null,
      landingPages,
      forms,
      sources: leadSources,
      utmCampaigns,
      recentCampaignActivity: recentCampaignActivity?.rows ?? null,
    };
  },
};
