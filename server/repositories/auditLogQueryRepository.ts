/**
 * Read-only audit log queries (Phase 4 — Control Center Audit Log UI).
 * Deliberately a SEPARATE module from auditLogRepository.ts, which must
 * keep exposing exactly one method (`record`) — tests/security/
 * rbacAndAudit.test.ts asserts that append-only invariant by checking its
 * key set exactly. Read access is a different concern from write
 * integrity, so it lives here instead of widening that repository's
 * surface.
 */
import type { AuditActorType, AuditResult, Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";

export interface AuditLogFilters {
  organizationId?: string;
  actorUserId?: string;
  action?: string;
  resourceType?: string;
  /** Phase 12 (CRM activity timeline) — matches any of several resource types at once, for a combined feed (e.g. lead + opportunity + client + form_submission) without widening the single-type `resourceType` filter every other caller relies on. */
  resourceTypes?: string[];
  resourceId?: string;
  result?: AuditResult;
  actorType?: AuditActorType;
  /** Matches any of several exact action names (security-event feeds). */
  actions?: string[];
  /** Free-text search across action, actor name, resource type/id. */
  q?: string;
  severity?: AuditSeverity;
  dateFrom?: Date;
  dateTo?: Date;
}

/** Actions that change who can do what, or touch credentials/secrets. */
export const CRITICAL_AUDIT_ACTIONS: readonly string[] = [
  "USER_ROLE_CHANGED", "USER_SESSIONS_REVOKED", "SESSION_REVOKED_BY_ADMIN", "ROLE_CREATED", "ROLE_UPDATED", "ROLE_PERMISSIONS_CHANGED", "ROLE_DELETED",
  "API_KEY_CREATED", "API_KEY_REVOKED", "INTEGRATION_CREDENTIAL_SET", "INTEGRATION_CREDENTIAL_REMOVED", "WEBHOOK_SECRET_ROTATED",
  "AUTH_ACCOUNT_LOCKED", "SETTINGS_UPDATED",
];
export type AuditSeverity = "info" | "warning" | "critical";

export function auditSeverity(row: { action: string; result: AuditResult }): AuditSeverity {
  if (CRITICAL_AUDIT_ACTIONS.includes(row.action)) return "critical";
  if (row.result === "FAILURE" || /FAILED|DENIED|LOCKED|REJECTED/.test(row.action)) return "warning";
  return "info";
}

export const auditLogQueryRepository = {
  async list(filters: AuditLogFilters, page: number, limit: number) {
    const where: Prisma.AuditLogWhereInput = {
      organizationId: filters.organizationId,
      actorUserId: filters.actorUserId,
      action: filters.action,
      resourceType: filters.resourceTypes ? { in: filters.resourceTypes } : filters.resourceType,
      resourceId: filters.resourceId,
      result: filters.result,
      actorType: filters.actorType,
    };
    if (filters.actions) where.action = { in: filters.actions };
    const and: Prisma.AuditLogWhereInput[] = [];
    if (filters.q) {
      and.push({
        OR: [
          { action: { contains: filters.q, mode: "insensitive" } },
          { actorName: { contains: filters.q, mode: "insensitive" } },
          { resourceType: { contains: filters.q, mode: "insensitive" } },
          { resourceId: { contains: filters.q, mode: "insensitive" } },
        ],
      });
    }
    if (filters.severity === "critical") and.push({ action: { in: [...CRITICAL_AUDIT_ACTIONS] } });
    if (filters.severity === "warning") {
      and.push({ action: { notIn: [...CRITICAL_AUDIT_ACTIONS] } }, { OR: [{ result: "FAILURE" }, { action: { contains: "FAILED" } }, { action: { contains: "DENIED" } }, { action: { contains: "LOCKED" } }, { action: { contains: "REJECTED" } }] });
    }
    if (filters.severity === "info") {
      and.push({ action: { notIn: [...CRITICAL_AUDIT_ACTIONS] }, result: "SUCCESS", NOT: [{ action: { contains: "FAILED" } }, { action: { contains: "DENIED" } }, { action: { contains: "LOCKED" } }, { action: { contains: "REJECTED" } }] });
    }
    if (and.length) where.AND = and;
    if (filters.dateFrom || filters.dateTo) {
      where.createdAt = {
        ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
        ...(filters.dateTo ? { lte: filters.dateTo } : {}),
      };
    }

    const [rows, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.auditLog.count({ where }),
    ]);

    return { rows, total };
  },

  /** Single event, scoped to an organization unless `organizationId` is undefined (SUPER_ADMIN). */
  async findById(id: string, organizationId?: string) {
    return prisma.auditLog.findFirst({ where: { id, ...(organizationId ? { organizationId } : {}) } });
  },

  /** Distinct action names seen in the organization — powers the action filter. */
  async distinctActions(organizationId: string): Promise<string[]> {
    const rows = await prisma.auditLog.findMany({ where: { organizationId }, distinct: ["action"], select: { action: true }, orderBy: { action: "asc" }, take: 300 });
    return rows.map((r) => r.action);
  },
};
