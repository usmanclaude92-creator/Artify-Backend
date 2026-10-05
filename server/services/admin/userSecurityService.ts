/** Phase 17 — session and account-security controls over a user within the caller's organization. Never returns tokens or token hashes. */
import { prisma } from "../../db/prisma";
import { NotFoundError } from "../../core/errors";
import { organizationMembershipRepository } from "../../repositories/organizationMembershipRepository";
import { auditLogRepository } from "../../repositories/auditLogRepository";
import type { SanitizedUser } from "../../types/domain";
import type { RequestMeta } from "../authService";
import { assertCallerMayManageTarget } from "./roleAccess";

async function loadMember(caller: SanitizedUser, userId: string) {
  const membership = await organizationMembershipRepository.findByUserAndOrg(userId, caller.organizationId);
  if (!membership) throw new NotFoundError("User not found.");
  return membership;
}

const sessionSelect = { id: true, createdAt: true, expiresAt: true, lastUsedAt: true, ipAddress: true, userAgent: true, userId: true } as const;

export const userSecurityService = {
  async listUserSessions(caller: SanitizedUser, userId: string) {
    await loadMember(caller, userId);
    return prisma.session.findMany({
      where: { userId, organizationId: caller.organizationId, revokedAt: null, expiresAt: { gt: new Date() } },
      select: sessionSelect,
      orderBy: { createdAt: "desc" },
    });
  },

  async revokeAllForUser(caller: SanitizedUser, userId: string, meta: RequestMeta = {}) {
    const membership = await loadMember(caller, userId);
    assertCallerMayManageTarget(caller, membership.role.key);
    const result = await prisma.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    await auditLogRepository.record({
      organizationId: caller.organizationId, actorUserId: caller.id, actorType: "USER", action: "USER_SESSIONS_REVOKED",
      resourceType: "user", resourceId: userId, afterData: { revoked: result.count }, ipAddress: meta.ip, userAgent: meta.userAgent,
    });
    return { revoked: result.count };
  },

  /** Clears a lockout caused by repeated failed sign-ins. */
  async unlock(caller: SanitizedUser, userId: string, meta: RequestMeta = {}) {
    const membership = await loadMember(caller, userId);
    assertCallerMayManageTarget(caller, membership.role.key);
    await prisma.user.update({ where: { id: userId }, data: { failedLoginAttempts: 0, lockedUntil: null } });
    await auditLogRepository.record({
      organizationId: caller.organizationId, actorUserId: caller.id, actorType: "USER", action: "USER_UNLOCKED",
      resourceType: "user", resourceId: userId, ipAddress: meta.ip, userAgent: meta.userAgent,
    });
  },

  /** Active sessions across the caller's organization (security.read). */
  async listOrganizationSessions(organizationId: string, page: number, limit: number) {
    const where = { organizationId, revokedAt: null, expiresAt: { gt: new Date() } };
    const [rows, total] = await Promise.all([
      prisma.session.findMany({
        where, orderBy: { lastUsedAt: { sort: "desc", nulls: "last" } }, skip: (page - 1) * limit, take: limit,
        select: { ...sessionSelect, user: { select: { email: true, firstName: true, lastName: true } } },
      }),
      prisma.session.count({ where }),
    ]);
    return { sessions: rows, total };
  },

  async revokeOrganizationSession(caller: SanitizedUser, sessionId: string, meta: RequestMeta = {}) {
    const session = await prisma.session.findFirst({ where: { id: sessionId, organizationId: caller.organizationId, revokedAt: null } });
    if (!session) throw new NotFoundError("Session not found.");
    if (session.userId !== caller.id) {
      const membership = await loadMember(caller, session.userId).catch(() => null);
      if (membership) assertCallerMayManageTarget(caller, membership.role.key);
    }
    await prisma.session.update({ where: { id: sessionId }, data: { revokedAt: new Date() } });
    await auditLogRepository.record({
      organizationId: caller.organizationId, actorUserId: caller.id, actorType: "USER", action: "SESSION_REVOKED_BY_ADMIN",
      resourceType: "session", resourceId: sessionId, afterData: { userId: session.userId }, ipAddress: meta.ip, userAgent: meta.userAgent,
    });
  },
};

