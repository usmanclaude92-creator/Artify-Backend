/**
 * Cross-domain analytics aggregation (Phase 15 — docs/ANALYTICS_ARCHITECTURE.md).
 * Pure aggregation over existing domains (AnalyticsEvent, Lead, Opportunity,
 * Client, Campaign, Form, Page/Post, Redirect, SEO audit, AuditLog) — never
 * a parallel analytics store beyond AnalyticsEvent itself, never fabricated.
 * Every section is `null` (not a zero) when the caller lacks the
 * underlying permission, same degrade-gracefully convention as
 * marketingService.getSummary/crmRoutes.ts's /crm/summary.
 */
import { analyticsEventRepository } from "../repositories/analyticsEventRepository";
import { leadRepository } from "../repositories/leadRepository";
import { opportunityRepository } from "../repositories/opportunityRepository";
import { clientRepository } from "../repositories/clientRepository";
import { campaignRepository } from "../repositories/campaignRepository";
import { formRepository } from "../repositories/formRepository";
import { pageRepository } from "../repositories/pageRepository";
import { postRepository } from "../repositories/postRepository";
import { redirectRepository } from "../repositories/redirectRepository";
import { auditLogQueryRepository } from "../repositories/auditLogQueryRepository";
import { seoAuditService } from "./seoAuditService";
import { config } from "../config/env";
import { ValidationError } from "../core/errors";
import type { ReportType } from "../schemas/analyticsSchemas";

export interface DateRangeInput {
  from?: Date;
  to?: Date;
  compare?: boolean;
}

export interface ResolvedRange {
  from: Date;
  to: Date;
  previous?: { from: Date; to: Date };
}

const DEFAULT_RANGE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

function resolveRange(input: DateRangeInput): ResolvedRange {
  const to = input.to ?? new Date();
  const from = input.from ?? new Date(to.getTime() - DEFAULT_RANGE_DAYS * DAY_MS);
  if (from > to) throw new ValidationError("`from` must not be after `to`.");
  let previous: { from: Date; to: Date } | undefined;
  if (input.compare) {
    const spanMs = to.getTime() - from.getTime();
    previous = { from: new Date(from.getTime() - spanMs), to: new Date(from.getTime() - 1) };
  }
  return { from, to, previous };
}

/** `null` (not a fabricated 0% or 100%) when there is no real prior-period baseline to compare against. */
function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / previous) * 10000) / 100;
}

export const analyticsReportingService = {
  resolveRange,

  async getOverview(organizationId: string, permissions: readonly string[], rangeInput: DateRangeInput) {
    const range = resolveRange(rangeInput);
    const canAnalytics = permissions.includes("analytics.read");
    const canLeads = permissions.includes("leads.read");
    const canOpportunities = permissions.includes("opportunities.read");
    const canClients = permissions.includes("clients.read");
    const canCampaigns = permissions.includes("campaigns.read");
    const canForms = permissions.includes("forms.read");

    const [
      hasAnyTraffic,
      pageViews,
      pageViewsPrev,
      sessions,
      sessionsPrev,
      topPages,
      utmSources,
      leadsTotal,
      leadsTotalPrev,
      leadsBySource,
      pipeline,
      pipelinePrev,
      clientsCreated,
      clientsCreatedPrev,
      clientsAttributed,
      campaignPerformance,
      formSubmissions,
      seoIssues,
      recentActivity,
    ] = await Promise.all([
      canAnalytics ? analyticsEventRepository.hasAnyEvent(organizationId) : Promise.resolve(false),
      canAnalytics ? analyticsEventRepository.countByEventType(organizationId, "page_view", range) : Promise.resolve(null),
      canAnalytics && range.previous ? analyticsEventRepository.countByEventType(organizationId, "page_view", range.previous) : Promise.resolve(null),
      canAnalytics ? analyticsEventRepository.distinctSessionCount(organizationId, range, "page_view") : Promise.resolve(null),
      canAnalytics && range.previous ? analyticsEventRepository.distinctSessionCount(organizationId, range.previous, "page_view") : Promise.resolve(null),
      canAnalytics ? analyticsEventRepository.topPaths(organizationId, range, "page_view", 10) : Promise.resolve(null),
      canAnalytics ? analyticsEventRepository.utmSourceBreakdown(organizationId, range, "page_view") : Promise.resolve(null),
      canLeads ? leadRepository.countInRange(organizationId, range) : Promise.resolve(null),
      canLeads && range.previous ? leadRepository.countInRange(organizationId, range.previous) : Promise.resolve(null),
      canLeads ? leadRepository.countBySourceInRange(organizationId, range) : Promise.resolve(null),
      canOpportunities ? opportunityRepository.pipelineInRange(organizationId, range) : Promise.resolve(null),
      canOpportunities && range.previous ? opportunityRepository.pipelineInRange(organizationId, range.previous) : Promise.resolve(null),
      canClients ? clientRepository.countCreatedInRange(organizationId, range) : Promise.resolve(null),
      canClients && range.previous ? clientRepository.countCreatedInRange(organizationId, range.previous) : Promise.resolve(null),
      canClients ? clientRepository.countAttributedConversionsInRange(organizationId, range) : Promise.resolve(null),
      canCampaigns ? campaignRepository.performanceInRange(organizationId, range) : Promise.resolve(null),
      canForms ? formRepository.countSubmissionsInRange(organizationId, range) : Promise.resolve(null),
      canAnalytics ? seoAuditService.runAudit(organizationId) : Promise.resolve(null),
      canAnalytics || canCampaigns ? auditLogQueryRepository.list({ organizationId }, 1, 15) : Promise.resolve(null),
    ]);

    const conversionRate = leadsTotal && leadsTotal > 0 && pipeline ? Math.round((pipeline.wonCount / leadsTotal) * 10000) / 100 : null;

    return {
      range: { from: range.from.toISOString(), to: range.to.toISOString(), comparing: Boolean(range.previous) },
      website: canAnalytics
        ? {
            configured: Boolean(config.publicWebsiteOrganizationId),
            hasAnyTraffic,
            pageViews,
            pageViewsChangePct: range.previous ? percentChange(pageViews ?? 0, pageViewsPrev ?? 0) : null,
            sessions,
            sessionsChangePct: range.previous ? percentChange(sessions ?? 0, sessionsPrev ?? 0) : null,
            topPages,
            utmSources,
          }
        : null,
      leads: canLeads
        ? {
            total: leadsTotal,
            changePct: range.previous ? percentChange(leadsTotal ?? 0, leadsTotalPrev ?? 0) : null,
            bySource: leadsBySource,
          }
        : null,
      pipeline: canOpportunities && pipeline
        ? {
            ...pipeline,
            wonChangePct: range.previous && pipelinePrev ? percentChange(pipeline.wonCount, pipelinePrev.wonCount) : null,
          }
        : null,
      clients: canClients
        ? {
            created: clientsCreated,
            changePct: range.previous ? percentChange(clientsCreated ?? 0, clientsCreatedPrev ?? 0) : null,
            attributedConversions: clientsAttributed,
          }
        : null,
      campaigns: canCampaigns ? campaignPerformance : null,
      forms: canForms ? { submissions: formSubmissions } : null,
      conversionRate,
      seo: canAnalytics && seoIssues ? { issueCount: seoIssues.length, topIssues: seoIssues.slice(0, 10) } : null,
      recentActivity: recentActivity?.rows ?? null,
    };
  },

  async getTopPages(organizationId: string, rangeInput: DateRangeInput, limit: number) {
    const range = resolveRange(rangeInput);
    return analyticsEventRepository.topPaths(organizationId, range, "page_view", limit);
  },

  async getReport(organizationId: string, permissions: readonly string[], type: ReportType, rangeInput: DateRangeInput) {
    const range = resolveRange(rangeInput);
    const canAnalytics = permissions.includes("analytics.read");
    const canLeads = permissions.includes("leads.read");
    const canOpportunities = permissions.includes("opportunities.read");
    const canClients = permissions.includes("clients.read");
    const canCampaigns = permissions.includes("campaigns.read");
    const canContent = permissions.includes("content.read");

    switch (type) {
      case "executive_summary":
        return this.getOverview(organizationId, permissions, rangeInput);

      case "website_performance":
        if (!canAnalytics) return null;
        return {
          pageViews: await analyticsEventRepository.countByEventType(organizationId, "page_view", range),
          sessions: await analyticsEventRepository.distinctSessionCount(organizationId, range, "page_view"),
          dailyPageViews: await analyticsEventRepository.countByDay(organizationId, "page_view", range),
          topPages: await analyticsEventRepository.topPaths(organizationId, range, "page_view", 25),
          utmSources: await analyticsEventRepository.utmSourceBreakdown(organizationId, range, "page_view"),
          utmCampaigns: await analyticsEventRepository.utmCampaignBreakdown(organizationId, range, "page_view"),
        };

      case "content_performance": {
        if (!canContent && !canAnalytics) return null;
        const [pages, posts, topPages] = await Promise.all([
          pageRepository.countForContentInventory(organizationId),
          postRepository.countForContentInventory(organizationId),
          canAnalytics ? analyticsEventRepository.topPaths(organizationId, range, "page_view", 25) : Promise.resolve(null),
        ]);
        return { pages, posts, topPages };
      }

      case "seo_report": {
        const [issues, redirects] = await Promise.all([seoAuditService.runAudit(organizationId), redirectRepository.count(organizationId)]);
        return { issueCount: issues.length, issues, redirects };
      }

      case "lead_generation":
        if (!canLeads) return null;
        return {
          total: await leadRepository.countInRange(organizationId, range),
          bySource: await leadRepository.countBySourceInRange(organizationId, range),
          byCampaign: await leadRepository.countByCampaignInRange(organizationId, range),
        };

      case "crm_pipeline":
        if (!canOpportunities) return null;
        return opportunityRepository.pipelineInRange(organizationId, range);

      case "campaign_performance":
        if (!canCampaigns) return null;
        return campaignRepository.performanceInRange(organizationId, range);

      case "conversion_report": {
        if (!canLeads || !canOpportunities || !canClients) return null;
        const [leads, pipeline, clients] = await Promise.all([
          leadRepository.countInRange(organizationId, range),
          opportunityRepository.pipelineInRange(organizationId, range),
          clientRepository.countCreatedInRange(organizationId, range),
        ]);
        return {
          leads,
          opportunitiesWon: pipeline.wonCount,
          opportunitiesLost: pipeline.lostCount,
          clientsCreated: clients,
          leadToOpportunityRate: leads > 0 ? Math.round((Object.values(pipeline.byStage).reduce((a, s) => a + s.count, 0) / leads) * 10000) / 100 : null,
          opportunityWinRate: pipeline.wonCount + pipeline.lostCount > 0 ? Math.round((pipeline.wonCount / (pipeline.wonCount + pipeline.lostCount)) * 10000) / 100 : null,
        };
      }

      case "client_acquisition":
        if (!canClients) return null;
        return {
          created: await clientRepository.countCreatedInRange(organizationId, range),
          attributedConversions: await clientRepository.countAttributedConversionsInRange(organizationId, range),
        };

      default:
        throw new ValidationError(`Unknown report type: ${type}`);
    }
  },
};
