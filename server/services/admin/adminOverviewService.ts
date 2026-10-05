/** Phase 17 — Administration dashboard: real, organization-scoped counts only. Nothing here is estimated or defaulted to a plausible-looking number. */
import { prisma } from "../../db/prisma";
import { config } from "../../config/env";
import { encryptionKeySource } from "../../utils/secretBox";
import { auditSeverity } from "../../repositories/auditLogQueryRepository";
import type { SanitizedUser } from "../../types/domain";

export const SECURITY_EVENT_ACTIONS: readonly string[] = [
  "AUTH_LOGIN_FAILED", "AUTH_ACCOUNT_LOCKED", "AUTH_PASSWORD_CHANGE", "AUTH_PASSWORD_RESET_REQUESTED", "AUTH_PASSWORD_RESET_COMPLETED",
  "AUTH_LOGOUT_ALL", "AUTH_SESSION_REVOKED", "SESSION_REVOKED_BY_ADMIN", "USER_SESSIONS_REVOKED", "USER_UNLOCKED",
  "USER_STATUS_CHANGED", "USER_ROLE_CHANGED", "ROLE_CREATED", "ROLE_UPDATED", "ROLE_PERMISSIONS_CHANGED", "ROLE_DELETED",
  "API_KEY_CREATED", "API_KEY_REVOKED", "INTEGRATION_CREDENTIAL_SET", "INTEGRATION_CREDENTIAL_REMOVED", "WEBHOOK_SECRET_ROTATED", "SETTINGS_UPDATED",
];

const ADMIN_ACTION_PREFIXES = ["USER_", "ROLE_", "API_KEY_", "WEBHOOK_", "INTEGRATION_", "SETTINGS_", "SESSION_"];

export const adminOverviewService = {
  async overview(caller: SanitizedUser) {
    const organizationId = caller.organizationId;
    const now = new Date();
    const day = new Date(now.getTime() - 24 * 3600_000);
    const week = new Date(now.getTime() - 7 * 24 * 3600_000);
    const isSuper = caller.role.key === "SUPER_ADMIN";

    const [
      memberships, roleGroups, roles, activeSessions, sessions24h, failedLogins24h, lockouts24h, lockedNow,
      recentAdmin, orgGroups, endpoints, failedDeliveries24h, pendingDeliveries, apiKeys, expiringKeys, failingIntegrations, configurableIntegrations,
    ] = await Promise.all([
      prisma.organizationMembership.findMany({ where: { organizationId, status: { not: "SUSPENDED" } }, select: { user: { select: { status: true } } } }),
      prisma.organizationMembership.groupBy({ by: ["roleId"], where: { organizationId }, _count: true }),
      prisma.role.findMany({ select: { id: true, key: true, name: true, isSystem: true } }),
      prisma.session.count({ where: { organizationId, revokedAt: null, expiresAt: { gt: now } } }),
      prisma.session.count({ where: { organizationId, createdAt: { gte: day } } }),
      prisma.auditLog.count({ where: { organizationId, action: "AUTH_LOGIN_FAILED", createdAt: { gte: day } } }),
      prisma.auditLog.count({ where: { organizationId, action: "AUTH_ACCOUNT_LOCKED", createdAt: { gte: week } } }),
      prisma.user.count({ where: { lockedUntil: { gt: now }, memberships: { some: { organizationId } } } }),
      prisma.auditLog.findMany({
        where: { organizationId, OR: ADMIN_ACTION_PREFIXES.map((p) => ({ action: { startsWith: p } })) },
        orderBy: { createdAt: "desc" }, take: 8,
        select: { id: true, action: true, actorName: true, actorType: true, resourceType: true, resourceId: true, result: true, createdAt: true },
      }),
      isSuper ? prisma.organization.groupBy({ by: ["status"], _count: true }) : Promise.resolve(null),
      prisma.webhookEndpoint.findMany({ where: { organizationId, deletedAt: null }, select: { enabled: true } }),
      prisma.webhookDelivery.count({ where: { organizationId, status: "FAILED", createdAt: { gte: day } } }),
      prisma.webhookDelivery.count({ where: { organizationId, status: "PENDING", attempts: { gt: 0 } } }),
      prisma.apiKey.findMany({ where: { organizationId, revokedAt: null }, select: { expiresAt: true } }),
      prisma.apiKey.count({ where: { organizationId, revokedAt: null, expiresAt: { gt: now, lte: new Date(now.getTime() + 14 * 86400_000) } } }),
      prisma.integration.count({ where: { organizationId, status: "FAILING" } }),
      prisma.integration.count({ where: { organizationId, enabled: true } }),
    ]);

    const byStatus = (s: string) => memberships.filter((m) => m.user.status === s).length;
    const roleName = new Map(roles.map((r) => [r.id, r]));
    const systemConfigured = [
      config.aiProvider === "gemini" && !!config.geminiApiKey,
      config.objectStorageProvider !== "none" && !!config.objectStorageBucket,
      !!config.redisUrl, !!config.cronSecret, !!config.webhookSecret, !!config.publicWebsiteOrganizationId,
    ].filter(Boolean).length;

    return {
      users: { total: memberships.length, active: byStatus("ACTIVE"), invited: byStatus("INVITED"), disabled: byStatus("DISABLED"), lockedNow },
      roles: {
        total: roles.length, custom: roles.filter((r) => !r.isSystem).length,
        distribution: roleGroups.map((g) => ({ roleKey: roleName.get(g.roleId)?.key ?? "UNKNOWN", roleName: roleName.get(g.roleId)?.name ?? "Unknown", members: g._count })).sort((a, b) => b.members - a.members),
      },
      organizations: orgGroups ? { visibleToCaller: orgGroups.reduce((n, g) => n + g._count, 0), byStatus: Object.fromEntries(orgGroups.map((g) => [g.status, g._count])) } : null,
      sessions: { active: activeSessions, createdLast24h: sessions24h },
      security: { failedLogins24h, lockoutsLast7d: lockouts24h, expiringApiKeys14d: expiringKeys },
      recentActivity: recentAdmin.map((r) => ({ ...r, severity: auditSeverity(r) })),
      integrations: {
        systemConfigured, systemTotal: 6, configurableEnabled: configurableIntegrations, configurableFailing: failingIntegrations,
        webhookEndpoints: { total: endpoints.length, enabled: endpoints.filter((e) => e.enabled).length, failedDeliveries24h, retrying: pendingDeliveries },
        apiKeys: { active: apiKeys.length },
      },
    };
  },

  /** Read-only effective security policy — what the platform actually enforces right now. */
  policy() {
    return {
      sessions: { ttlHours: config.sessionTtlHours, tokenStorage: "SHA-256 hashed at rest; revocable per session" },
      passwords: { minLength: config.passwordMinLength, rules: ["Not entirely numeric", "Not on the common-password list"], hashing: "bcrypt" },
      lockout: { failedAttemptsThreshold: config.accountLockoutThreshold, lockDurationMinutes: config.accountLockoutDurationMinutes },
      tokens: { passwordResetTtlMinutes: config.passwordResetTokenTtlMinutes, invitationTtlHours: config.invitationTokenTtlHours },
      rateLimits: [
        { name: "General API", limit: 300, windowMinutes: 15 },
        { name: "Sign-in / register (per IP + email)", limit: 10, windowMinutes: 15 },
        { name: "Password reset", limit: 5, windowMinutes: 60 },
        { name: "Sensitive admin actions (per user)", limit: 20, windowMinutes: 15 },
        { name: "Inbound webhooks", limit: 100, windowMinutes: 5 },
      ],
      rateLimitStore: config.redisUrl ? "shared (Redis)" : "per-instance (in-memory) — not shared across serverless instances",
      cors: { allowedOrigins: config.corsOrigins, wildcardAllowed: false },
      transport: { httpsOnlyOutboundInProduction: true, secureHeaders: "helmet (CSP, HSTS, frame-ancestors none)" },
      secrets: { credentialEncryption: "AES-256-GCM", keySource: encryptionKeySource() },
      note: "These values come from deployment configuration and are intentionally read-only here; change them through environment configuration, not the UI.",
    };
  },
};
