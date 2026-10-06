/**
 * Operator review of self-registered client-portal accounts. A registration
 * lives in its own TRIAL organization with the CLIENT_PORTAL role and sees an
 * empty portal until an operator links it to a CRM Client (the same
 * Client.workspaceOrganizationId link that workspace provisioning uses), or
 * rejects it (organization suspended, sessions revoked). Only operators of the
 * agency organization (or SUPER_ADMIN) may review.
 */
import { prisma } from "../db/prisma";
import { config } from "../config/env";
import { AuthorizationError, ConflictError, NotFoundError } from "../core/errors";
import { auditLogRepository } from "../repositories/auditLogRepository";
import { sessionRepository } from "../repositories/sessionRepository";
import type { SanitizedUser } from "../types/domain";

function assertOperator(caller: SanitizedUser): void {
  const agencyId = config.publicWebsiteOrganizationId;
  const isAgency = !!agencyId && caller.organizationId === agencyId;
  if (!isAgency && caller.role.key !== "SUPER_ADMIN") {
    throw new AuthorizationError("Only the agency organization can review portal registrations.");
  }
}

const pendingWhere = {
  type: "CLIENT" as const,
  status: "TRIAL" as const,
  provisionedForClient: null,
  memberships: { some: { role: { key: "CLIENT_PORTAL" } } },
};

export const portalRegistrationService = {
  async list(caller: SanitizedUser) {
    assertOperator(caller);
    const orgs = await prisma.organization.findMany({
      where: pendingWhere,
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        name: true,
        createdAt: true,
        memberships: { where: { role: { key: "CLIENT_PORTAL" } }, take: 1, select: { user: { select: { firstName: true, lastName: true, email: true, emailVerifiedAt: true } } } },
      },
    });
    return orgs.map((o) => {
      const u = o.memberships[0]?.user;
      return {
        organizationId: o.id,
        organizationName: o.name,
        registeredAt: o.createdAt,
        contactName: u ? `${u.firstName} ${u.lastName}`.trim() : null,
        contactEmail: u?.email ?? null,
        emailVerified: !!u?.emailVerifiedAt,
      };
    });
  },

  async link(caller: SanitizedUser, organizationId: string, clientId: string, meta: { ip?: string; userAgent?: string } = {}) {
    assertOperator(caller);
    const org = await prisma.organization.findFirst({ where: { id: organizationId, ...pendingWhere }, select: { id: true } });
    if (!org) throw new NotFoundError("Pending registration not found.");
    await prisma.$transaction(async (tx) => {
      const linked = await tx.client.updateMany({
        where: { id: clientId, organizationId: caller.organizationId, workspaceOrganizationId: null },
        data: { workspaceOrganizationId: organizationId },
      });
      if (linked.count !== 1) throw new ConflictError("That client does not exist in your organization or is already linked to a workspace.");
      await tx.organization.update({ where: { id: organizationId }, data: { status: "ACTIVE" } });
    });
    await auditLogRepository.record({
      organizationId: caller.organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "PORTAL_REGISTRATION_LINKED",
      resourceType: "organization",
      resourceId: organizationId,
      afterData: { clientId },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });
  },

  async reject(caller: SanitizedUser, organizationId: string, meta: { ip?: string; userAgent?: string } = {}) {
    assertOperator(caller);
    const org = await prisma.organization.findFirst({ where: { id: organizationId, ...pendingWhere }, select: { id: true } });
    if (!org) throw new NotFoundError("Pending registration not found.");
    const members = await prisma.organizationMembership.findMany({ where: { organizationId }, select: { userId: true } });
    await prisma.organization.update({ where: { id: organizationId }, data: { status: "SUSPENDED" } });
    await Promise.all(members.map((m) => sessionRepository.revokeAllForUser(m.userId)));
    await auditLogRepository.record({
      organizationId: caller.organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "PORTAL_REGISTRATION_REJECTED",
      resourceType: "organization",
      resourceId: organizationId,
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });
  },
};
