/**
 * Opportunity (sales pipeline) management (Phase 7 —
 * docs/CRM_ARCHITECTURE.md). Every method is scoped to the caller's own
 * session organization — never a caller-supplied organizationId (§4).
 */
import { opportunityRepository, type OpportunityFilters, type OpportunityWithRelations } from "../repositories/opportunityRepository";
import { clientRepository } from "../repositories/clientRepository";
import { leadRepository } from "../repositories/leadRepository";
import { productRepository } from "../repositories/productRepository";
import { auditLogRepository } from "../repositories/auditLogRepository";
import { auditLogQueryRepository } from "../repositories/auditLogQueryRepository";
import { notificationService } from "./notificationService";
import { toMoney, DEFAULT_CURRENCY } from "../utils/money";
import { ConflictError, NotFoundError, ValidationError } from "../core/errors";
import type { SanitizedUser } from "../types/domain";
import type { CreateOpportunityInput, UpdateOpportunityInput, LoseOpportunityInput, LinkClientInput } from "../schemas/opportunitySchemas";
import type { RequestMeta } from "./authService";

/**
 * Both CLOSED_WON and CLOSED_LOST are terminal — reachable only through
 * winOpportunity()/loseOpportunity(), never the generic update (mirrors
 * Lead.CONVERTED, §17). Unlike Lead's LOST (which stays reopenable), a
 * closed Opportunity is not un-terminated: re-pursuing a lost deal means
 * creating a new Opportunity, which keeps the closed one an honest,
 * immutable record of what actually happened and when.
 */
const TERMINAL_STAGES = new Set(["CLOSED_WON", "CLOSED_LOST"]);
const NON_TERMINAL_STAGES = new Set(["PROSPECTING", "QUALIFICATION", "PROPOSAL", "NEGOTIATION"]);

function assertValidStageTransition(current: string, next: string): void {
  if (current === next) return;
  if (TERMINAL_STAGES.has(current)) {
    throw new ConflictError("This opportunity is closed and can no longer be changed.");
  }
  if (!NON_TERMINAL_STAGES.has(next)) {
    throw new ValidationError("Use POST /opportunities/:id/win or /lose to close an opportunity — stage cannot be set to a closed value directly.");
  }
}

async function loadOpportunityOrThrow(id: string, organizationId: string): Promise<OpportunityWithRelations> {
  const opportunity = await opportunityRepository.findByIdInOrg(id, organizationId);
  if (!opportunity) throw new NotFoundError("Opportunity not found.");
  return opportunity;
}

/** Notifies the assignee and creator (deduped, excluding whoever just performed the close) that a deal closed. */
async function notifyClose(params: {
  organizationId: string;
  actorId: string;
  assignedTo: string | null;
  createdById: string | null;
  title: string;
  message: string;
  type: string;
}): Promise<void> {
  const recipients = new Set([params.assignedTo, params.createdById].filter((id): id is string => !!id && id !== params.actorId));
  await Promise.all(
    [...recipients].map((userId) => notificationService.notify({ organizationId: params.organizationId, userId, type: params.type, title: params.title, message: params.message }))
  );
}

export const opportunityService = {
  async listOpportunities(organizationId: string, filters: OpportunityFilters, page: number, limit: number, sort: string, order: "asc" | "desc") {
    return opportunityRepository.list(organizationId, filters, page, limit, sort, order);
  },

  async getOpportunity(organizationId: string, id: string): Promise<OpportunityWithRelations> {
    return loadOpportunityOrThrow(id, organizationId);
  },

  async createOpportunity(caller: SanitizedUser, input: CreateOpportunityInput, meta: RequestMeta = {}): Promise<OpportunityWithRelations> {
    const organizationId = caller.organizationId;

    if (input.clientId) {
      const client = await clientRepository.findByIdInOrg(input.clientId, organizationId);
      if (!client) throw new ValidationError("clientId does not belong to this organization.");
    }

    if (input.leadId) {
      const lead = await leadRepository.findByIdInOrg(input.leadId, organizationId);
      if (!lead) throw new ValidationError("leadId does not belong to this organization.");
    }

    if (input.productId) {
      const product = await productRepository.findById(input.productId);
      if (!product) throw new ValidationError("productId does not refer to a real product/service/solution.");
    }

    const opportunity = await opportunityRepository.create({
      organizationId,
      clientId: input.clientId,
      leadId: input.leadId,
      productId: input.productId,
      source: input.source,
      probability: input.probability,
      name: input.name,
      stage: input.stage,
      value: toMoney(input.value),
      currency: input.currency ?? DEFAULT_CURRENCY,
      expectedCloseDate: input.expectedCloseDate,
      notes: input.notes,
      assignedTo: input.assignedTo,
      createdById: caller.id,
    });

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "OPPORTUNITY_CREATED",
      resourceType: "opportunity",
      resourceId: opportunity.id,
      afterData: { name: opportunity.name, stage: opportunity.stage, clientId: opportunity.clientId, leadId: opportunity.leadId, value: opportunity.value.toString() },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    if (opportunity.assignedTo && opportunity.assignedTo !== caller.id) {
      await notificationService.notify({
        organizationId,
        userId: opportunity.assignedTo,
        type: "opportunity_assigned",
        title: "New opportunity assigned to you",
        message: `${opportunity.name} was assigned to you.`,
      });
    }

    return opportunity;
  },

  async updateOpportunity(caller: SanitizedUser, id: string, input: UpdateOpportunityInput, meta: RequestMeta = {}): Promise<OpportunityWithRelations> {
    const organizationId = caller.organizationId;
    const existing = await loadOpportunityOrThrow(id, organizationId);

    if (input.stage !== undefined) {
      assertValidStageTransition(existing.stage, input.stage);
    } else if (TERMINAL_STAGES.has(existing.stage)) {
      throw new ConflictError("This opportunity is closed and can no longer be edited.");
    }

    if (input.productId) {
      const product = await productRepository.findById(input.productId);
      if (!product) throw new ValidationError("productId does not refer to a real product/service/solution.");
    }

    const patch: Record<string, unknown> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.stage !== undefined) patch.stage = input.stage;
    if (input.value !== undefined) patch.value = toMoney(input.value);
    if (input.currency !== undefined) patch.currency = input.currency;
    if (input.expectedCloseDate !== undefined) patch.expectedCloseDate = input.expectedCloseDate;
    if (input.notes !== undefined) patch.notes = input.notes;
    if (input.assignedTo !== undefined) patch.assignedTo = input.assignedTo;
    if (input.productId !== undefined) patch.productId = input.productId;
    if (input.source !== undefined) patch.source = input.source;
    if (input.probability !== undefined) patch.probability = input.probability;

    const updated = await opportunityRepository.update(id, organizationId, patch);

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "OPPORTUNITY_UPDATED",
      resourceType: "opportunity",
      resourceId: id,
      beforeData: { stage: existing.stage, value: existing.value.toString() },
      afterData: { ...patch, value: patch.value !== undefined ? (patch.value as { toString(): string }).toString() : undefined },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return updated;
  },

  async deleteOpportunity(caller: SanitizedUser, id: string, meta: RequestMeta = {}): Promise<void> {
    const organizationId = caller.organizationId;
    await loadOpportunityOrThrow(id, organizationId);
    await opportunityRepository.softDelete(id);

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "OPPORTUNITY_DELETED",
      resourceType: "opportunity",
      resourceId: id,
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });
  },

  async winOpportunity(caller: SanitizedUser, id: string, meta: RequestMeta = {}): Promise<OpportunityWithRelations> {
    const organizationId = caller.organizationId;
    const existing = await loadOpportunityOrThrow(id, organizationId);
    if (TERMINAL_STAGES.has(existing.stage)) {
      throw new ConflictError("This opportunity is already closed.");
    }
    // Phase 12 — a deal opened directly against a Lead (no client yet)
    // must be linked to a real Client (see linkClient()) before it can be
    // marked won: a won deal with nothing to bill is a contradiction, and
    // this is exactly the "Opportunity -> Client" step of the brief's
    // Lead -> Qualified Lead -> Opportunity -> Client handoff.
    if (!existing.clientId) {
      throw new ValidationError("This opportunity must be linked to a client (see POST /opportunities/:id/link-client) before it can be marked as won.");
    }

    const updated = await opportunityRepository.update(id, organizationId, { stage: "CLOSED_WON", actualCloseDate: new Date() });

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "OPPORTUNITY_WON",
      resourceType: "opportunity",
      resourceId: id,
      beforeData: { stage: existing.stage },
      afterData: { stage: "CLOSED_WON", value: existing.value.toString() },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    await notifyClose({
      organizationId,
      actorId: caller.id,
      assignedTo: existing.assignedTo,
      createdById: existing.createdById,
      type: "opportunity_won",
      title: "Opportunity won",
      message: `${existing.name} was marked as won.`,
    });

    return updated;
  },

  async loseOpportunity(caller: SanitizedUser, id: string, input: LoseOpportunityInput, meta: RequestMeta = {}): Promise<OpportunityWithRelations> {
    const organizationId = caller.organizationId;
    const existing = await loadOpportunityOrThrow(id, organizationId);
    if (TERMINAL_STAGES.has(existing.stage)) {
      throw new ConflictError("This opportunity is already closed.");
    }

    const updated = await opportunityRepository.update(id, organizationId, {
      stage: "CLOSED_LOST",
      actualCloseDate: new Date(),
      lostReason: input.lostReason,
    });

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "OPPORTUNITY_LOST",
      resourceType: "opportunity",
      resourceId: id,
      beforeData: { stage: existing.stage },
      afterData: { stage: "CLOSED_LOST", lostReason: input.lostReason ?? null },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    await notifyClose({
      organizationId,
      actorId: caller.id,
      assignedTo: existing.assignedTo,
      createdById: existing.createdById,
      type: "opportunity_lost",
      title: "Opportunity lost",
      message: `${existing.name} was marked as lost.`,
    });

    return updated;
  },

  async dashboardStats(organizationId: string) {
    const [byStage, recent] = await Promise.all([
      opportunityRepository.countByStage(organizationId),
      opportunityRepository.recentForOrg(organizationId, 5),
    ]);
    return { byStage, recent };
  },

  /**
   * Phase 12 — the "Opportunity -> Client" step of the Lead -> Qualified
   * Lead -> Opportunity -> Client handoff: attaches an existing Client to
   * a deal that was opened directly against a Lead. Never creates or
   * converts anything itself (reuse leadService.convertLead for that) —
   * this only links two already-real records together.
   */
  async linkClient(caller: SanitizedUser, id: string, input: LinkClientInput, meta: RequestMeta = {}): Promise<OpportunityWithRelations> {
    const organizationId = caller.organizationId;
    const existing = await loadOpportunityOrThrow(id, organizationId);
    if (TERMINAL_STAGES.has(existing.stage)) {
      throw new ConflictError("This opportunity is closed and can no longer be changed.");
    }
    if (existing.clientId) {
      throw new ConflictError("This opportunity is already linked to a client.");
    }

    const client = await clientRepository.findByIdInOrg(input.clientId, organizationId);
    if (!client) throw new ValidationError("clientId does not belong to this organization.");

    const updated = await opportunityRepository.update(id, organizationId, { clientId: input.clientId });

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "OPPORTUNITY_CLIENT_LINKED",
      resourceType: "opportunity",
      resourceId: id,
      beforeData: { clientId: null },
      afterData: { clientId: input.clientId },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return updated;
  },

  /** Phase 12 — unified activity timeline for one opportunity, drawn entirely from the existing audit trail (never a parallel "activity" table). */
  async getActivity(organizationId: string, id: string) {
    await loadOpportunityOrThrow(id, organizationId);
    const { rows } = await auditLogQueryRepository.list({ organizationId, resourceType: "opportunity", resourceId: id }, 1, 100);
    return rows;
  },
};
