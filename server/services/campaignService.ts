/**
 * Campaign management (Phase 14 — docs/MARKETING_ARCHITECTURE.md).
 * Organization-scoped, same findByIdInOrg-only convention as every other
 * CRM service since Phase 5. Status lifecycle: DRAFT -> ACTIVE <-> PAUSED
 * -> ARCHIVED (terminal) — mirrors Subscription's own activate/pause/
 * cancel shape rather than Content's draft/publish/schedule shape, since
 * a Campaign has no revision history to manage.
 */
import { campaignRepository, type CampaignWithRelations } from "../repositories/campaignRepository";
import { productRepository } from "../repositories/productRepository";
import { pageRepository } from "../repositories/pageRepository";
import { postRepository } from "../repositories/postRepository";
import { caseStudyRepository } from "../repositories/caseStudyRepository";
import { formRepository } from "../repositories/formRepository";
import { mediaRepository } from "../repositories/mediaRepository";
import { auditLogRepository } from "../repositories/auditLogRepository";
import { auditLogQueryRepository } from "../repositories/auditLogQueryRepository";
import { eventEngine } from "./automation/EventEngine";
import { toMoney, DEFAULT_CURRENCY } from "../utils/money";
import { ConflictError, NotFoundError, ValidationError } from "../core/errors";
import type { SanitizedUser } from "../types/domain";
import type { CreateCampaignInput, UpdateCampaignInput, DuplicateCampaignInput, ListCampaignsQuery } from "../schemas/campaignSchemas";
import type { RequestMeta } from "./authService";
import { config } from "../config/env";

const TERMINAL_STATUSES = new Set(["ARCHIVED"]);

function assertValidTransition(current: string, next: string): void {
  if (current === next) return;
  if (TERMINAL_STATUSES.has(current)) {
    throw new ConflictError("This campaign has been archived and can no longer change status.");
  }
}

async function loadCampaignOrThrow(id: string, organizationId: string): Promise<CampaignWithRelations> {
  const campaign = await campaignRepository.findByIdInOrg(id, organizationId);
  if (!campaign) throw new NotFoundError("Campaign not found.");
  return campaign;
}

/** Products/Services/Solutions are a global catalog (Phase 10) — existence alone is checked, never an org match (same as caseStudyService's assertProductsUsable). */
async function assertProductsUsable(productIds: string[] | undefined): Promise<void> {
  if (!productIds || productIds.length === 0) return;
  const found = await productRepository.findManyByIds(productIds);
  if (found.length !== new Set(productIds).size) {
    throw new ValidationError("One or more productIds do not refer to a real product/service/solution.");
  }
}

async function assertRelatedPagesUsable(pageIds: string[] | undefined, organizationId: string): Promise<void> {
  if (!pageIds || pageIds.length === 0) return;
  const found = await pageRepository.findByIdsInOrg(pageIds, organizationId);
  if (found.length !== new Set(pageIds).size) {
    throw new ValidationError("One or more relatedPageIds do not refer to a page in this organization.");
  }
}

async function assertRelatedPostsUsable(postIds: string[] | undefined, organizationId: string): Promise<void> {
  if (!postIds || postIds.length === 0) return;
  const found = await postRepository.findByIdsInOrg(postIds, organizationId);
  if (found.length !== new Set(postIds).size) {
    throw new ValidationError("One or more relatedPostIds do not refer to a post in this organization.");
  }
}

async function assertRelatedCaseStudiesUsable(caseStudyIds: string[] | undefined, organizationId: string): Promise<void> {
  if (!caseStudyIds || caseStudyIds.length === 0) return;
  const found = await caseStudyRepository.findByIdsInOrg(caseStudyIds, organizationId);
  if (found.length !== new Set(caseStudyIds).size) {
    throw new ValidationError("One or more relatedCaseStudyIds do not refer to a case study in this organization.");
  }
}

async function assertMediaUsable(mediaIds: string[] | undefined, organizationId: string): Promise<void> {
  if (!mediaIds || mediaIds.length === 0) return;
  for (const mediaId of new Set(mediaIds)) {
    const media = await mediaRepository.findByIdInOrg(mediaId, organizationId);
    if (!media) throw new ValidationError(`mediaIds contains "${mediaId}", which does not refer to a media asset in this organization.`);
  }
}

async function assertLandingPageUsable(landingPageId: string | null | undefined, organizationId: string): Promise<void> {
  if (!landingPageId) return;
  const page = await pageRepository.findByIdInOrg(landingPageId, organizationId);
  if (!page) throw new ValidationError("landingPageId does not refer to a page in this organization.");
}

async function assertFormUsable(formId: string | null | undefined, organizationId: string): Promise<void> {
  if (!formId) return;
  const form = await formRepository.findByIdInOrg(formId, organizationId);
  if (!form) throw new ValidationError("formId does not refer to a form in this organization.");
}

async function assertRelationshipsUsable(
  input: { productIds?: string[]; relatedPageIds?: string[]; relatedPostIds?: string[]; relatedCaseStudyIds?: string[]; mediaIds?: string[]; landingPageId?: string | null; formId?: string | null },
  organizationId: string
): Promise<void> {
  await Promise.all([
    assertProductsUsable(input.productIds),
    assertRelatedPagesUsable(input.relatedPageIds, organizationId),
    assertRelatedPostsUsable(input.relatedPostIds, organizationId),
    assertRelatedCaseStudiesUsable(input.relatedCaseStudyIds, organizationId),
    assertMediaUsable(input.mediaIds, organizationId),
    assertLandingPageUsable(input.landingPageId, organizationId),
    assertFormUsable(input.formId, organizationId),
  ]);
}

async function setRelations(
  campaignId: string,
  input: { productIds?: string[]; relatedPageIds?: string[]; relatedPostIds?: string[]; relatedCaseStudyIds?: string[]; mediaIds?: string[] }
): Promise<void> {
  await Promise.all([
    input.productIds !== undefined ? campaignRepository.setProducts(campaignId, input.productIds) : Promise.resolve(),
    input.relatedPageIds !== undefined ? campaignRepository.setRelatedPages(campaignId, input.relatedPageIds) : Promise.resolve(),
    input.relatedPostIds !== undefined ? campaignRepository.setRelatedPosts(campaignId, input.relatedPostIds) : Promise.resolve(),
    input.relatedCaseStudyIds !== undefined ? campaignRepository.setRelatedCaseStudies(campaignId, input.relatedCaseStudyIds) : Promise.resolve(),
    input.mediaIds !== undefined ? campaignRepository.setMedia(campaignId, input.mediaIds) : Promise.resolve(),
  ]);
}

/** Emits a real automation event — never throws, since a notification/automation failure must never break the CRM action that triggered it (same reasoning notificationService.notify already applies). */
async function emitCampaignEvent(eventType: string, campaign: { id: string; organizationId: string }, actorId: string | undefined): Promise<void> {
  try {
    await eventEngine.emit({
      eventType,
      entityType: "campaign",
      entityId: campaign.id,
      organizationId: campaign.organizationId,
      actorId,
      actorType: actorId ? "USER" : "SYSTEM",
      sourceModule: "MARKETING",
      payload: { campaignId: campaign.id },
    });
  } catch {
    // best-effort — automation dispatch failures never break the campaign action itself.
  }
}

export const campaignService = {
  async listCampaigns(organizationId: string, filters: Pick<ListCampaignsQuery, "search" | "status" | "channel" | "ownerId">, page: number, limit: number, sort: string, order: "asc" | "desc") {
    return campaignRepository.list(organizationId, filters, page, limit, sort, order);
  },

  async getCampaign(organizationId: string, id: string): Promise<CampaignWithRelations> {
    return loadCampaignOrThrow(id, organizationId);
  },

  async createCampaign(caller: SanitizedUser, input: CreateCampaignInput, meta: RequestMeta = {}): Promise<CampaignWithRelations> {
    const organizationId = caller.organizationId;
    await assertRelationshipsUsable(input, organizationId);

    const campaign = await campaignRepository.create({
      organizationId,
      name: input.name,
      description: input.description,
      status: "DRAFT",
      channel: input.channel,
      startDate: input.startDate,
      endDate: input.endDate,
      ownerId: input.ownerId,
      budget: input.budget !== undefined ? toMoney(input.budget) : undefined,
      currency: input.budget !== undefined ? input.currency ?? DEFAULT_CURRENCY : input.currency,
      landingPageId: input.landingPageId,
      formId: input.formId,
      utmSource: input.utmSource,
      utmMedium: input.utmMedium,
      utmCampaign: input.utmCampaign,
      utmTerm: input.utmTerm,
      utmContent: input.utmContent,
      targetAudience: input.targetAudience,
      notes: input.notes,
      createdById: caller.id,
    });

    await setRelations(campaign.id, input);

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "CAMPAIGN_CREATED",
      resourceType: "campaign",
      resourceId: campaign.id,
      afterData: { name: campaign.name, status: campaign.status, channel: campaign.channel, utmCampaign: campaign.utmCampaign },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    await emitCampaignEvent("campaign.created", campaign, caller.id);

    return loadCampaignOrThrow(campaign.id, organizationId);
  },

  async updateCampaign(caller: SanitizedUser, id: string, input: UpdateCampaignInput, meta: RequestMeta = {}): Promise<CampaignWithRelations> {
    const organizationId = caller.organizationId;
    const existing = await loadCampaignOrThrow(id, organizationId);
    if (TERMINAL_STATUSES.has(existing.status)) {
      throw new ConflictError("This campaign has been archived and can no longer be edited.");
    }

    await assertRelationshipsUsable(input, organizationId);

    const patch: Record<string, unknown> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.description !== undefined) patch.description = input.description;
    if (input.channel !== undefined) patch.channel = input.channel;
    if (input.startDate !== undefined) patch.startDate = input.startDate;
    if (input.endDate !== undefined) patch.endDate = input.endDate;
    if (input.ownerId !== undefined) patch.ownerId = input.ownerId;
    if (input.budget !== undefined) patch.budget = input.budget === null ? null : toMoney(input.budget);
    if (input.currency !== undefined) patch.currency = input.currency;
    if (input.landingPageId !== undefined) patch.landingPageId = input.landingPageId;
    if (input.formId !== undefined) patch.formId = input.formId;
    if (input.utmSource !== undefined) patch.utmSource = input.utmSource;
    if (input.utmMedium !== undefined) patch.utmMedium = input.utmMedium;
    if (input.utmCampaign !== undefined) patch.utmCampaign = input.utmCampaign;
    if (input.utmTerm !== undefined) patch.utmTerm = input.utmTerm;
    if (input.utmContent !== undefined) patch.utmContent = input.utmContent;
    if (input.targetAudience !== undefined) patch.targetAudience = input.targetAudience;
    if (input.notes !== undefined) patch.notes = input.notes;

    if (Object.keys(patch).length > 0) {
      await campaignRepository.update(id, patch);
    }
    await setRelations(id, input);

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "CAMPAIGN_UPDATED",
      resourceType: "campaign",
      resourceId: id,
      beforeData: { name: existing.name, channel: existing.channel },
      afterData: patch,
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    const updated = await loadCampaignOrThrow(id, organizationId);
    await emitCampaignEvent("campaign.updated", updated, caller.id);
    return updated;
  },

  /** Creates a new DRAFT campaign copying this one's fields and relations (never its leads/opportunities/clients — those are this campaign's own attributed activity, not the new copy's). */
  async duplicateCampaign(caller: SanitizedUser, id: string, input: DuplicateCampaignInput, meta: RequestMeta = {}): Promise<CampaignWithRelations> {
    const organizationId = caller.organizationId;
    const existing = await loadCampaignOrThrow(id, organizationId);

    const copy = await campaignRepository.create({
      organizationId,
      name: input.name ?? `Copy of ${existing.name}`,
      description: existing.description,
      status: "DRAFT",
      channel: existing.channel,
      startDate: existing.startDate,
      endDate: existing.endDate,
      ownerId: existing.ownerId,
      budget: existing.budget,
      currency: existing.currency,
      landingPageId: existing.landingPageId,
      formId: existing.formId,
      // utmCampaign is deliberately NOT copied — two campaigns sharing one
      // utm_campaign value would make attribution resolution ambiguous
      // (campaignRepository.findActiveByUtmCampaignInOrg picks one
      // arbitrarily). The duplicate starts with no UTM tag; the author
      // sets a new one before activating it.
      utmSource: existing.utmSource,
      utmMedium: existing.utmMedium,
      utmTerm: existing.utmTerm,
      utmContent: existing.utmContent,
      targetAudience: existing.targetAudience,
      notes: existing.notes,
      createdById: caller.id,
    });

    await setRelations(copy.id, {
      productIds: existing.products.map((p) => p.productId),
      relatedPageIds: existing.relatedPages.map((p) => p.pageId),
      relatedPostIds: existing.relatedPosts.map((p) => p.postId),
      relatedCaseStudyIds: existing.relatedCaseStudies.map((c) => c.caseStudyId),
      mediaIds: existing.media.map((m) => m.mediaId),
    });

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "CAMPAIGN_DUPLICATED",
      resourceType: "campaign",
      resourceId: copy.id,
      beforeData: { duplicatedFromCampaignId: id },
      afterData: { name: copy.name },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return loadCampaignOrThrow(copy.id, organizationId);
  },

  async activateCampaign(caller: SanitizedUser, id: string, meta: RequestMeta = {}): Promise<CampaignWithRelations> {
    const organizationId = caller.organizationId;
    const existing = await loadCampaignOrThrow(id, organizationId);
    assertValidTransition(existing.status, "ACTIVE");
    if (existing.status === "ACTIVE") throw new ConflictError("This campaign is already active.");

    await campaignRepository.update(id, { status: "ACTIVE" });
    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "CAMPAIGN_ACTIVATED",
      resourceType: "campaign",
      resourceId: id,
      beforeData: { status: existing.status },
      afterData: { status: "ACTIVE" },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    const updated = await loadCampaignOrThrow(id, organizationId);
    await emitCampaignEvent("campaign.activated", updated, caller.id);
    return updated;
  },

  async pauseCampaign(caller: SanitizedUser, id: string, meta: RequestMeta = {}): Promise<CampaignWithRelations> {
    const organizationId = caller.organizationId;
    const existing = await loadCampaignOrThrow(id, organizationId);
    if (existing.status !== "ACTIVE") throw new ConflictError("Only an ACTIVE campaign can be paused.");

    await campaignRepository.update(id, { status: "PAUSED" });
    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "CAMPAIGN_PAUSED",
      resourceType: "campaign",
      resourceId: id,
      beforeData: { status: existing.status },
      afterData: { status: "PAUSED" },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    const updated = await loadCampaignOrThrow(id, organizationId);
    await emitCampaignEvent("campaign.paused", updated, caller.id);
    return updated;
  },

  async archiveCampaign(caller: SanitizedUser, id: string, meta: RequestMeta = {}): Promise<CampaignWithRelations> {
    const organizationId = caller.organizationId;
    const existing = await loadCampaignOrThrow(id, organizationId);
    if (existing.status === "ARCHIVED") throw new ConflictError("This campaign is already archived.");

    await campaignRepository.update(id, { status: "ARCHIVED" });
    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "CAMPAIGN_ARCHIVED",
      resourceType: "campaign",
      resourceId: id,
      beforeData: { status: existing.status },
      afterData: { status: "ARCHIVED" },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    const updated = await loadCampaignOrThrow(id, organizationId);
    await emitCampaignEvent("campaign.archived", updated, caller.id);
    return updated;
  },

  /**
   * "Publish" a campaign — activates it, but only after verifying its
   * attached landing page (if any) is actually PUBLISHED. A campaign
   * driving traffic to a DRAFT page would be a dead/broken URL on day
   * one (§5 "ensure campaign URLs resolve correctly") — this never
   * auto-publishes the page itself (that is content.publish's own,
   * separately permissioned action), it only refuses to go live until
   * that's genuinely true.
   */
  async publishCampaign(caller: SanitizedUser, id: string, meta: RequestMeta = {}): Promise<CampaignWithRelations> {
    const organizationId = caller.organizationId;
    const existing = await loadCampaignOrThrow(id, organizationId);
    assertValidTransition(existing.status, "ACTIVE");
    if (existing.status === "ACTIVE") throw new ConflictError("This campaign is already active.");

    if (existing.landingPageId && existing.landingPage?.status !== "PUBLISHED") {
      throw new ValidationError("This campaign's landing page must be published before the campaign can go live.");
    }

    return this.activateCampaign(caller, id, meta);
  },

  /**
   * Composes the real, resolvable preview URL for this campaign's landing
   * page with its own UTM parameters appended — never a fabricated URL.
   * Returns landingPageUrl: null (not a guessed string) when the campaign
   * has no landing page attached, or publicSiteBaseUrl: null when the
   * public site's base URL isn't configured for this environment.
   */
  async previewCampaign(organizationId: string, id: string): Promise<{ landingPageUrl: string | null; landingPageStatus: string | null; configured: boolean }> {
    const campaign = await loadCampaignOrThrow(id, organizationId);
    if (!campaign.landingPage) {
      return { landingPageUrl: null, landingPageStatus: null, configured: !!config.publicSiteBaseUrl };
    }
    if (!config.publicSiteBaseUrl) {
      return { landingPageUrl: null, landingPageStatus: campaign.landingPage.status, configured: false };
    }
    const params = new URLSearchParams();
    if (campaign.utmSource) params.set("utm_source", campaign.utmSource);
    if (campaign.utmMedium) params.set("utm_medium", campaign.utmMedium);
    if (campaign.utmCampaign) params.set("utm_campaign", campaign.utmCampaign);
    if (campaign.utmTerm) params.set("utm_term", campaign.utmTerm);
    if (campaign.utmContent) params.set("utm_content", campaign.utmContent);
    const query = params.toString();
    const base = config.publicSiteBaseUrl.replace(/\/$/, "");
    const landingPageUrl = `${base}/${campaign.landingPage.slug}${query ? `?${query}` : ""}`;
    return { landingPageUrl, landingPageStatus: campaign.landingPage.status, configured: true };
  },

  /** Unified activity timeline for one campaign, drawn entirely from the existing audit trail (never a parallel "activity" table — same convention as opportunityService.getActivity). */
  async getActivity(organizationId: string, id: string) {
    await loadCampaignOrThrow(id, organizationId);
    const { rows } = await auditLogQueryRepository.list({ organizationId, resourceType: "campaign", resourceId: id }, 1, 100);
    return rows;
  },
};
