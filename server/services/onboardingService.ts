/**
 * Client onboarding workflow (Phase 6 — docs/CLIENT_ONBOARDING_ARCHITECTURE.md;
 * extended Phase 13 with configurable templates, per-step owner/dueDate/
 * notes/document, and dashboard stats). Onboarding status is independent
 * of workspace status (§7) — this service never touches Organization.status,
 * and workspaceService never touches ClientOnboarding directly (only via
 * markStepComplete/completeStepForClient below).
 */
import {
  clientOnboardingRepository,
  freshChecklist,
  nextIncompleteStep,
  defaultOnboardingTemplateSteps,
  type ChecklistItem,
} from "../repositories/clientOnboardingRepository";
import { clientRepository } from "../repositories/clientRepository";
import { mediaRepository } from "../repositories/mediaRepository";
import { systemSettingRepository } from "../repositories/systemSettingRepository";
import { auditLogRepository } from "../repositories/auditLogRepository";
import { auditLogQueryRepository } from "../repositories/auditLogQueryRepository";
import { notificationService } from "./notificationService";
import { eventEngine } from "./automation/EventEngine";
import { ConflictError, NotFoundError, ValidationError } from "../core/errors";
import type { SanitizedUser } from "../types/domain";
import type {
  OnboardingStepKey,
  UpdateOnboardingInput,
  UpdateOnboardingStepInput,
  OnboardingTemplateInput,
  OnboardingTemplateStep,
  StartOnboardingInput,
} from "../schemas/onboardingSchemas";
import { onboardingTemplateSchema } from "../schemas/onboardingSchemas";
import type { RequestMeta } from "./authService";
import type { Client, ClientOnboarding } from "@prisma/client";

const TERMINAL_STATUSES = new Set(["COMPLETED", "CANCELLED"]);
const TEMPLATE_SETTING_KEY = "onboarding.checklist_template";

async function loadClientInOrgOrThrow(clientId: string, organizationId: string): Promise<Client> {
  const client = await clientRepository.findByIdInOrg(clientId, organizationId);
  if (!client) throw new NotFoundError("Client not found.");
  return client;
}

async function loadOnboardingInOrgOrThrow(id: string, organizationId: string): Promise<ClientOnboarding> {
  const record = await clientOnboardingRepository.findByIdInOrg(id, organizationId);
  if (!record) throw new NotFoundError("Onboarding record not found.");
  return record;
}

/** Resolves an organization's own configured template, if any — undefined means "use the system default". */
async function getCustomTemplateSteps(organizationId: string): Promise<OnboardingTemplateStep[] | undefined> {
  const row = await systemSettingRepository.findByKey(organizationId, TEMPLATE_SETTING_KEY);
  if (!row) return undefined;
  const parsed = onboardingTemplateSchema.safeParse(row.value);
  return parsed.success ? parsed.data : undefined;
}

export const onboardingService = {
  async listOnboarding(
    organizationId: string,
    filters: { status?: string; search?: string; ownerId?: string; overdue?: boolean },
    page: number,
    limit: number
  ) {
    return clientOnboardingRepository.list(organizationId, filters, page, limit);
  },

  async getOnboarding(organizationId: string, id: string) {
    return loadOnboardingInOrgOrThrow(id, organizationId);
  },

  async getOnboardingForClient(organizationId: string, clientId: string) {
    await loadClientInOrgOrThrow(clientId, organizationId);
    return clientOnboardingRepository.findByClientId(clientId);
  },

  /** Phase 13 — the org's resolved checklist template (custom if configured, else the Phase 6 system default) and whether it has been customized. */
  async getTemplate(organizationId: string) {
    const steps = await getCustomTemplateSteps(organizationId);
    return { steps: steps ?? defaultOnboardingTemplateSteps(), isCustom: !!steps };
  },

  async updateTemplate(caller: SanitizedUser, steps: OnboardingTemplateInput, meta: RequestMeta = {}) {
    await systemSettingRepository.upsert({
      organizationId: caller.organizationId,
      key: TEMPLATE_SETTING_KEY,
      value: steps,
      type: "JSON",
      description: "Default onboarding checklist template",
      updatedById: caller.id,
    });

    await auditLogRepository.record({
      organizationId: caller.organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "ONBOARDING_TEMPLATE_UPDATED",
      resourceType: "system_setting",
      resourceId: TEMPLATE_SETTING_KEY,
      afterData: { stepCount: steps.length },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return { steps, isCustom: true };
  },

  async startOnboarding(caller: SanitizedUser, clientId: string, input: StartOnboardingInput = {}, meta: RequestMeta = {}): Promise<ClientOnboarding> {
    await loadClientInOrgOrThrow(clientId, caller.organizationId);

    const existing = await clientOnboardingRepository.findByClientId(clientId);
    if (existing) {
      throw new ConflictError("Onboarding has already been started for this client.", { onboardingId: existing.id });
    }

    const steps = await getCustomTemplateSteps(caller.organizationId);
    const record = await clientOnboardingRepository.create({
      organizationId: caller.organizationId,
      clientId,
      createdById: caller.id,
      steps,
      ownerId: input.ownerId,
      dueDate: input.dueDate,
    });

    await auditLogRepository.record({
      organizationId: caller.organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "CLIENT_ONBOARDING_STARTED",
      resourceType: "client_onboarding",
      resourceId: record.id,
      afterData: { clientId, status: record.status },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return record;
  },

  async updateOnboarding(caller: SanitizedUser, id: string, input: UpdateOnboardingInput, meta: RequestMeta = {}): Promise<ClientOnboarding> {
    const existing = await loadOnboardingInOrgOrThrow(id, caller.organizationId);
    if (TERMINAL_STATUSES.has(existing.status)) {
      throw new ConflictError(`This onboarding is already ${existing.status.toLowerCase()} and can no longer be changed.`);
    }

    if (input.status === "CANCELLED") {
      const updated = await clientOnboardingRepository.update(id, { status: "CANCELLED", cancelledAt: new Date() });
      await auditLogRepository.record({
        organizationId: caller.organizationId,
        actorUserId: caller.id,
        actorType: "USER",
        action: "CLIENT_ONBOARDING_CANCELLED",
        resourceType: "client_onboarding",
        resourceId: id,
        beforeData: { status: existing.status },
        afterData: { status: "CANCELLED" },
        ipAddress: meta.ip,
        userAgent: meta.userAgent,
      });
      return updated;
    }

    if (input.completeStep) {
      return this.completeStep(caller, id, input.completeStep, meta);
    }

    if (input.ownerId !== undefined || input.dueDate !== undefined) {
      const patch: Record<string, unknown> = {};
      if (input.ownerId !== undefined) patch.ownerId = input.ownerId;
      if (input.dueDate !== undefined) patch.dueDate = input.dueDate;
      const updated = await clientOnboardingRepository.update(id, patch);

      await auditLogRepository.record({
        organizationId: caller.organizationId,
        actorUserId: caller.id,
        actorType: "USER",
        action: "CLIENT_ONBOARDING_UPDATED",
        resourceType: "client_onboarding",
        resourceId: id,
        afterData: patch,
        ipAddress: meta.ip,
        userAgent: meta.userAgent,
      });

      if (input.ownerId && input.ownerId !== existing.ownerId && input.ownerId !== caller.id) {
        await notificationService.notify({
          organizationId: caller.organizationId,
          userId: input.ownerId,
          type: "onboarding_assigned",
          title: "Onboarding assigned to you",
          message: "You were assigned as the owner of a client onboarding.",
        });
      }

      return updated;
    }

    return existing;
  },

  /**
   * Phase 13 — per-step detail edits (due date/assignee/notes/attached
   * document), distinct from completing the step. Idempotent target
   * lookup mirrors completeStep: an unknown key is a 400, never silently
   * ignored, since this is an explicit staff action (unlike
   * completeStepForClient's system-triggered no-op).
   */
  async updateStep(caller: SanitizedUser, onboardingId: string, step: string, input: UpdateOnboardingStepInput, meta: RequestMeta = {}): Promise<ClientOnboarding> {
    const record = await loadOnboardingInOrgOrThrow(onboardingId, caller.organizationId);
    if (TERMINAL_STATUSES.has(record.status)) {
      throw new ConflictError(`This onboarding is already ${record.status.toLowerCase()} and can no longer be changed.`);
    }

    const checklist = (record.checklist as unknown as ChecklistItem[]) ?? freshChecklist();
    const item = checklist.find((c) => c.key === step);
    if (!item) throw new ValidationError(`Unknown onboarding step: ${step}`);

    if (input.documentMediaId !== undefined && input.documentMediaId !== null) {
      const media = await mediaRepository.findByIdInOrg(input.documentMediaId, caller.organizationId);
      if (!media) throw new ValidationError("documentMediaId does not refer to a media asset in this organization.");
    }

    if (input.dueDate !== undefined) item.dueDate = input.dueDate ? input.dueDate.toISOString() : null;
    if (input.assignedTo !== undefined) item.assignedTo = input.assignedTo;
    if (input.notes !== undefined) item.notes = input.notes;
    if (input.documentMediaId !== undefined) item.documentMediaId = input.documentMediaId;

    const updated = await clientOnboardingRepository.update(record.id, { checklist: checklist as unknown as never });

    await auditLogRepository.record({
      organizationId: caller.organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "ONBOARDING_STEP_UPDATED",
      resourceType: "client_onboarding",
      resourceId: record.id,
      afterData: { step, ...input, dueDate: input.dueDate ? input.dueDate.toISOString() : input.dueDate },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    if (input.assignedTo && input.assignedTo !== caller.id) {
      await notificationService.notify({
        organizationId: caller.organizationId,
        userId: input.assignedTo,
        type: "onboarding_step_assigned",
        title: "Onboarding step assigned to you",
        message: `"${item.label}" was assigned to you.`,
      });
    }

    return updated;
  },

  /**
   * Marks one checklist step complete (idempotent — re-completing an
   * already-complete step is a no-op, not an error, since both manual PATCH
   * calls and automatic calls from workspaceService/invitationService can
   * race to mark the same step). Advances currentStep; flips status to
   * READY once every step is done — completion itself is a separate,
   * explicit action (completeOnboarding), never inferred (§7).
   */
  async completeStep(caller: SanitizedUser, onboardingId: string, step: string, meta: RequestMeta = {}): Promise<ClientOnboarding> {
    const record = await loadOnboardingInOrgOrThrow(onboardingId, caller.organizationId);
    if (TERMINAL_STATUSES.has(record.status)) return record;

    const checklist = (record.checklist as unknown as ChecklistItem[]) ?? freshChecklist();
    const item = checklist.find((c) => c.key === step);
    if (!item) throw new ValidationError(`Unknown onboarding step: ${step}`);
    if (item.completed) return record;

    item.completed = true;
    item.completedAt = new Date().toISOString();
    item.completedById = caller.id;

    const next = nextIncompleteStep(checklist);
    const updated = await clientOnboardingRepository.update(record.id, {
      checklist: checklist as unknown as never,
      currentStep: next,
      status: next === null ? "READY" : record.status,
    });

    await auditLogRepository.record({
      organizationId: caller.organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "ONBOARDING_STEP_COMPLETED",
      resourceType: "client_onboarding",
      resourceId: record.id,
      afterData: { step, status: updated.status },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    if (record.ownerId && record.ownerId !== caller.id) {
      await notificationService.notify({
        organizationId: caller.organizationId,
        userId: record.ownerId,
        type: "onboarding_step_completed",
        title: "Onboarding step completed",
        message: `"${item.label}" was completed.`,
      });
    }

    return updated;
  },

  /** Marks a step complete by clientId — used by workspaceService/invitationService, which know the client, not the onboarding record id. Silently no-ops if onboarding was never started for this client (starting onboarding is optional before provisioning), or if the organization's template doesn't include this system key. */
  async completeStepForClient(clientId: string, step: OnboardingStepKey, actorUserId?: string): Promise<void> {
    const record = await clientOnboardingRepository.findByClientId(clientId);
    if (!record) return;
    const checklist = (record.checklist as unknown as ChecklistItem[]) ?? freshChecklist();
    const item = checklist.find((c) => c.key === step);
    if (!item || item.completed) return;

    item.completed = true;
    item.completedAt = new Date().toISOString();
    item.completedById = actorUserId ?? null;
    const next = nextIncompleteStep(checklist);

    await clientOnboardingRepository.update(record.id, {
      checklist: checklist as unknown as never,
      currentStep: next,
      status: next === null ? "READY" : record.status,
    });

    await auditLogRepository.record({
      organizationId: record.organizationId,
      actorUserId,
      actorType: actorUserId ? "USER" : "SYSTEM",
      action: "ONBOARDING_STEP_COMPLETED",
      resourceType: "client_onboarding",
      resourceId: record.id,
      afterData: { step },
    });
  },

  async completeOnboarding(caller: SanitizedUser, id: string, meta: RequestMeta = {}): Promise<ClientOnboarding> {
    const existing = await loadOnboardingInOrgOrThrow(id, caller.organizationId);
    if (existing.status === "COMPLETED") {
      throw new ConflictError("This onboarding has already been completed.");
    }
    if (existing.status !== "READY") {
      throw new ValidationError("Complete every checklist step before finishing onboarding.");
    }

    const updated = await clientOnboardingRepository.update(id, {
      status: "COMPLETED",
      completedAt: new Date(),
      completedBy: { connect: { id: caller.id } },
    });

    await auditLogRepository.record({
      organizationId: caller.organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "CLIENT_ONBOARDING_COMPLETED",
      resourceType: "client_onboarding",
      resourceId: id,
      afterData: { status: "COMPLETED" },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    if (existing.ownerId && existing.ownerId !== caller.id) {
      await notificationService.notify({
        organizationId: caller.organizationId,
        userId: existing.ownerId,
        type: "onboarding_completed",
        title: "Onboarding completed",
        message: "A client onboarding you own has been completed.",
      });
    }

    // Phase 14 — real automation trigger: an ACTIVE workflow with
    // triggerType EVENT / triggerConfig.eventType "client.onboarded"
    // fires from this (already a registered standard event type that,
    // before this, nothing in the platform ever actually emitted).
    // Best-effort: never blocks or fails onboarding completion.
    try {
      await eventEngine.emit({
        eventType: "client.onboarded",
        entityType: "client",
        entityId: existing.clientId,
        organizationId: caller.organizationId,
        actorId: caller.id,
        actorType: "USER",
        sourceModule: "ONBOARDING",
        payload: { onboardingId: id },
      });
    } catch {
      // best-effort — see comment above.
    }

    return updated;
  },

  /** Phase 13 CRM/Client dashboard — real counts only. */
  async dashboardStats(organizationId: string, callerId: string) {
    return clientOnboardingRepository.dashboardStats(organizationId, callerId);
  },

  /** Phase 13 — real activity timeline for one onboarding record, same audit-log-backed pattern as leadService/opportunityService/clientService.getActivity. */
  async getActivity(organizationId: string, id: string) {
    await loadOnboardingInOrgOrThrow(id, organizationId);
    const { rows } = await auditLogQueryRepository.list({ organizationId, resourceType: "client_onboarding", resourceId: id }, 1, 100);
    return rows;
  },
};
