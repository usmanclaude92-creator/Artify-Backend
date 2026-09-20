/** Client management (Phase 5 — docs/CRM_ARCHITECTURE.md). Every method is scoped to the caller's own session organization. */
import { clientRepository, type ClientFilters } from "../repositories/clientRepository";
import { auditLogRepository } from "../repositories/auditLogRepository";
import { ConflictError, NotFoundError } from "../core/errors";
import type { SanitizedUser } from "../types/domain";
import type { CreateClientInput, UpdateClientInput } from "../schemas/clientSchemas";
import type { RequestMeta } from "./authService";
import type { Client } from "@prisma/client";

async function loadClientInOrgOrThrow(id: string, organizationId: string): Promise<Client> {
  const client = await clientRepository.findByIdInOrg(id, organizationId);
  if (!client) throw new NotFoundError("Client not found.");
  return client;
}

export const clientService = {
  async listClients(organizationId: string, filters: ClientFilters, page: number, limit: number, sort: string, order: "asc" | "desc") {
    return clientRepository.list(organizationId, filters, page, limit, sort, order);
  },

  async getClient(organizationId: string, id: string): Promise<Client> {
    return loadClientInOrgOrThrow(id, organizationId);
  },

  async createClient(caller: SanitizedUser, input: CreateClientInput, meta: RequestMeta = {}): Promise<Client> {
    const [byCode, byName] = await Promise.all([
      clientRepository.findByCodeInOrg(caller.organizationId, input.clientCode),
      clientRepository.findByNameInOrg(caller.organizationId, input.name),
    ]);
    if (byCode) throw new ConflictError(`A client with code "${input.clientCode}" already exists in this organization.`);
    if (byName) {
      throw new ConflictError(`A client named "${input.name}" already exists in this organization.`, { existingClientId: byName.id });
    }

    const client = await clientRepository.create({
      organizationId: caller.organizationId,
      clientCode: input.clientCode,
      name: input.name,
      legalName: input.legalName,
      status: input.status,
      email: input.email || undefined,
      phone: input.phone,
      website: input.website,
      address: input.address,
      accountManager: input.accountManager,
      notes: input.notes,
    });

    await auditLogRepository.record({
      organizationId: caller.organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "CLIENT_CREATED",
      resourceType: "client",
      resourceId: client.id,
      afterData: { clientCode: client.clientCode, name: client.name, status: client.status },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return client;
  },

  async updateClient(caller: SanitizedUser, id: string, input: UpdateClientInput, meta: RequestMeta = {}): Promise<Client> {
    const existing = await loadClientInOrgOrThrow(id, caller.organizationId);

    if (input.name !== undefined && input.name.toLowerCase() !== existing.name.toLowerCase()) {
      const dup = await clientRepository.findByNameInOrg(caller.organizationId, input.name);
      if (dup && dup.id !== id) {
        throw new ConflictError(`A client named "${input.name}" already exists in this organization.`);
      }
    }

    const patch: Record<string, unknown> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.legalName !== undefined) patch.legalName = input.legalName;
    if (input.status !== undefined) patch.status = input.status;
    if (input.email !== undefined) patch.email = input.email || null;
    if (input.phone !== undefined) patch.phone = input.phone;
    if (input.website !== undefined) patch.website = input.website;
    if (input.address !== undefined) patch.address = input.address;
    if (input.accountManager !== undefined) patch.accountManager = input.accountManager;
    if (input.notes !== undefined) patch.notes = input.notes;

    const updated = await clientRepository.update(id, patch);

    await auditLogRepository.record({
      organizationId: caller.organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "CLIENT_UPDATED",
      resourceType: "client",
      resourceId: id,
      beforeData: { status: existing.status },
      afterData: patch,
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return updated;
  },

  async deleteClient(caller: SanitizedUser, id: string, meta: RequestMeta = {}): Promise<void> {
    await loadClientInOrgOrThrow(id, caller.organizationId);
    // Soft delete only (§12) — clients are never physically removed, so
    // historical contracts/subscriptions/invoices (RESTRICT FKs, Phase 2)
    // and any lead that converted into this client stay intact.
    await clientRepository.softDelete(id);

    await auditLogRepository.record({
      organizationId: caller.organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "CLIENT_ARCHIVED",
      resourceType: "client",
      resourceId: id,
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });
  },

  async dashboardCounts(organizationId: string) {
    return clientRepository.countByStatus(organizationId);
  },

  async recent(organizationId: string, limit: number) {
    return clientRepository.recentForOrg(organizationId, limit);
  },
};
