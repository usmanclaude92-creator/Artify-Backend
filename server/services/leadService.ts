/**
 * Lead management + lead→client conversion (Phase 5 —
 * docs/CRM_ARCHITECTURE.md). Every method is scoped to the caller's own
 * session organization — never a caller-supplied organizationId (§4).
 */
import { prisma } from "../db/prisma";
import { leadRepository, type LeadFilters } from "../repositories/leadRepository";
import { clientRepository } from "../repositories/clientRepository";
import { industryRepository } from "../repositories/industryRepository";
import { auditLogRepository } from "../repositories/auditLogRepository";
import { auditLogQueryRepository } from "../repositories/auditLogQueryRepository";
import { notificationService } from "./notificationService";
import { eventEngine } from "./automation/EventEngine";
import { ConflictError, NotFoundError, ValidationError } from "../core/errors";
import type { SanitizedUser } from "../types/domain";
import type { CreateLeadInput, UpdateLeadInput, ConvertLeadInput } from "../schemas/leadSchemas";
import type { RequestMeta } from "./authService";
import type { Lead } from "@prisma/client";

const TERMINAL_STATUSES = new Set(["CONVERTED"]);
/** Every non-terminal status may move to any other non-terminal status (including LOST → reopened) — CONVERTED is reachable only via convertLead(). */
const NON_TERMINAL_STATUSES = new Set(["NEW", "CONTACTED", "QUALIFIED", "LOST"]);

function assertValidTransition(current: string, next: string): void {
  if (current === next) return;
  if (TERMINAL_STATUSES.has(current)) {
    throw new ConflictError("This lead has already been converted; its status can no longer be changed.");
  }
  if (!NON_TERMINAL_STATUSES.has(next)) {
    throw new ValidationError('Use POST /leads/:id/convert to mark a lead as converted — status cannot be set to "CONVERTED" directly.');
  }
}

async function loadLeadInOrgOrThrow(id: string, organizationId: string): Promise<Lead> {
  const lead = await leadRepository.findByIdInOrg(id, organizationId);
  if (!lead) throw new NotFoundError("Lead not found.");
  return lead;
}

function splitName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/);
  const lastName = parts.slice(1).join(" ") || (parts[0] ?? fullName);
  return { firstName: parts[0] ?? fullName, lastName };
}

export const leadService = {
  async listLeads(organizationId: string, filters: LeadFilters, page: number, limit: number, sort: string, order: "asc" | "desc") {
    return leadRepository.list(organizationId, filters, page, limit, sort, order);
  },

  async getLead(organizationId: string, id: string): Promise<Lead> {
    return loadLeadInOrgOrThrow(id, organizationId);
  },

  async createLead(caller: SanitizedUser, input: CreateLeadInput, meta: RequestMeta = {}): Promise<Lead> {
    const email = input.email || undefined;
    if (email) {
      const duplicates = await leadRepository.findByEmailInOrg(caller.organizationId, email);
      if (duplicates.length > 0) {
        throw new ConflictError("An open lead with this email already exists for this organization.", {
          existingLeadId: duplicates[0]!.id,
        });
      }
    }

    const lead = await leadRepository.create({
      organizationId: caller.organizationId,
      companyName: input.companyName,
      contactName: input.contactName,
      email,
      phone: input.phone,
      source: input.source,
      status: input.status,
      notes: input.notes,
      assignedTo: input.assignedTo,
    });

    await auditLogRepository.record({
      organizationId: caller.organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "LEAD_CREATED",
      resourceType: "lead",
      resourceId: lead.id,
      afterData: { companyName: lead.companyName, status: lead.status },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    if (lead.assignedTo && lead.assignedTo !== caller.id) {
      await notificationService.notify({
        organizationId: caller.organizationId,
        userId: lead.assignedTo,
        type: "lead_assigned",
        title: "New lead assigned to you",
        message: `${lead.companyName} was assigned to you.`,
      });
    }

    // Phase 14 — real automation trigger: an ACTIVE workflow with
    // triggerType EVENT / triggerConfig.eventType "lead.created" fires
    // from this. Best-effort: never blocks or fails lead creation.
    try {
      await eventEngine.emit({
        eventType: "lead.created",
        entityType: "lead",
        entityId: lead.id,
        organizationId: caller.organizationId,
        actorId: caller.id,
        actorType: "USER",
        sourceModule: "CRM",
        payload: { companyName: lead.companyName, status: lead.status, source: lead.source ?? null },
      });
    } catch {
      // best-effort — see comment above.
    }

    return lead;
  },

  async updateLead(caller: SanitizedUser, id: string, input: UpdateLeadInput, meta: RequestMeta = {}): Promise<Lead> {
    const existing = await loadLeadInOrgOrThrow(id, caller.organizationId);

    if (input.status !== undefined) {
      assertValidTransition(existing.status, input.status);
    } else if (TERMINAL_STATUSES.has(existing.status)) {
      throw new ConflictError("This lead has already been converted and can no longer be edited.");
    }

    const patch: Record<string, unknown> = {};
    if (input.companyName !== undefined) patch.companyName = input.companyName;
    if (input.contactName !== undefined) patch.contactName = input.contactName;
    if (input.email !== undefined) patch.email = input.email || null;
    if (input.phone !== undefined) patch.phone = input.phone;
    if (input.source !== undefined) patch.source = input.source;
    if (input.status !== undefined) patch.status = input.status;
    if (input.notes !== undefined) patch.notes = input.notes;
    if (input.assignedTo !== undefined) patch.assignedTo = input.assignedTo;

    const updated = await leadRepository.update(id, patch);

    await auditLogRepository.record({
      organizationId: caller.organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "LEAD_UPDATED",
      resourceType: "lead",
      resourceId: id,
      beforeData: { status: existing.status },
      afterData: patch,
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    // Phase 14 — real automation trigger: an ACTIVE workflow with
    // triggerType EVENT / triggerConfig.eventType "lead.status_changed"
    // fires from this, only when the status genuinely changed.
    // Best-effort: never blocks or fails the update.
    if (input.status !== undefined && input.status !== existing.status) {
      try {
        await eventEngine.emit({
          eventType: "lead.status_changed",
          entityType: "lead",
          entityId: id,
          organizationId: caller.organizationId,
          actorId: caller.id,
          actorType: "USER",
          sourceModule: "CRM",
          payload: { fromStatus: existing.status, toStatus: input.status },
        });
      } catch {
        // best-effort — see comment above.
      }
    }

    if (input.assignedTo !== undefined && input.assignedTo !== existing.assignedTo && input.assignedTo !== caller.id) {
      await notificationService.notify({
        organizationId: caller.organizationId,
        userId: input.assignedTo,
        type: "lead_assigned",
        title: "New lead assigned to you",
        message: `${updated.companyName} was assigned to you.`,
      });
    }

    return updated;
  },

  async deleteLead(caller: SanitizedUser, id: string, meta: RequestMeta = {}): Promise<void> {
    await loadLeadInOrgOrThrow(id, caller.organizationId);
    await leadRepository.softDelete(id);

    await auditLogRepository.record({
      organizationId: caller.organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "LEAD_ARCHIVED",
      resourceType: "lead",
      resourceId: id,
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });
  },

  /**
   * Transactional lead→client conversion (§15-17). Race-safe: the lead's
   * status flip uses a conditional `updateMany` (status != CONVERTED)
   * inside the transaction and checks the affected row count — a
   * concurrent duplicate conversion attempt affects 0 rows, throws, and
   * rolls back the whole transaction (including the client/contact rows
   * already created in it), rather than racing on a read-then-write.
   */
  async convertLead(caller: SanitizedUser, id: string, input: ConvertLeadInput, meta: RequestMeta = {}) {
    const lead = await loadLeadInOrgOrThrow(id, caller.organizationId);

    if (lead.status === "CONVERTED") {
      throw new ConflictError("This lead has already been converted.", { convertedClientId: lead.convertedClientId });
    }

    const existingCode = await clientRepository.findByCodeInOrg(caller.organizationId, input.clientCode);
    if (existingCode) {
      throw new ConflictError(`A client with code "${input.clientCode}" already exists in this organization.`);
    }
    // Phase 13 — prevent duplicate client creation: the same case-insensitive
    // name-collision guard clientService.createClient already enforces for
    // a manually-created client (§19) applies here too, since convertLead
    // creates its own Client row directly rather than going through
    // clientService.
    const newClientName = input.name ?? lead.companyName;
    const existingName = await clientRepository.findByNameInOrg(caller.organizationId, newClientName);
    if (existingName) {
      throw new ConflictError(`A client named "${newClientName}" already exists in this organization.`, { existingClientId: existingName.id });
    }
    if (input.industryId && !(await industryRepository.findById(input.industryId))) {
      throw new ValidationError("industryId does not refer to a known industry.");
    }

    const result = await prisma.$transaction(async (tx) => {
      const client = await tx.client.create({
        data: {
          organizationId: caller.organizationId,
          clientCode: input.clientCode,
          name: newClientName,
          status: "ACTIVE",
          email: input.email ?? lead.email ?? undefined,
          phone: input.phone ?? lead.phone ?? undefined,
          website: input.website,
          address: input.address,
          // Assign owner/industry at conversion — defaults to the lead's
          // own assignedTo/source so CRM ownership and attribution carry
          // forward rather than resetting on handoff (§2 "assign owner/team").
          accountManager: input.accountManager ?? lead.assignedTo ?? undefined,
          industryId: input.industryId,
          source: lead.source ?? undefined,
          // Phase 14 — carries the lead's resolved campaign attribution
          // forward to the Client, preserving the complete
          // source/attribution history through the whole handoff (§6).
          campaignId: lead.campaignId ?? undefined,
        },
      });

      let contactId: string | null = null;
      if (input.createContact && lead.contactName) {
        const { firstName, lastName } = splitName(lead.contactName);
        const contact = await tx.contact.create({
          data: {
            organizationId: caller.organizationId,
            clientId: client.id,
            firstName,
            lastName,
            email: lead.email ?? undefined,
            phone: lead.phone ?? undefined,
            isPrimary: true,
          },
        });
        contactId = contact.id;
      }

      const conversion = await tx.lead.updateMany({
        where: { id, organizationId: caller.organizationId, status: { not: "CONVERTED" } },
        data: { status: "CONVERTED", convertedClientId: client.id, convertedAt: new Date() },
      });

      if (conversion.count !== 1) {
        // Someone else converted this lead in the moment between our read
        // above and this transaction — abort and roll back the client/
        // contact rows just created rather than leaving an orphaned client.
        throw new ConflictError("This lead has already been converted.");
      }

      return { client, contactId };
    });

    await auditLogRepository.record({
      organizationId: caller.organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "CLIENT_CREATED",
      resourceType: "client",
      resourceId: result.client.id,
      afterData: { clientCode: result.client.clientCode, name: result.client.name, convertedFromLeadId: id },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    await auditLogRepository.record({
      organizationId: caller.organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "LEAD_CONVERTED",
      resourceType: "lead",
      resourceId: id,
      afterData: { clientId: result.client.id, clientCode: result.client.clientCode },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return result;
  },

  async dashboardCounts(organizationId: string) {
    return leadRepository.countByStatus(organizationId);
  },

  async recent(organizationId: string, limit: number) {
    return leadRepository.recentForOrg(organizationId, limit);
  },

  async getActivity(organizationId: string, id: string) {
    await loadLeadInOrgOrThrow(id, organizationId);
    const { rows } = await auditLogQueryRepository.list({ organizationId, resourceType: "lead", resourceId: id }, 1, 100);
    return rows;
  },
};
