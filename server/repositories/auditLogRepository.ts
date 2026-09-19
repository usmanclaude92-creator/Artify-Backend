import type { AuditActorType, Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";

export interface AuditLogInput {
  companyId?: string;
  actorId?: string;
  actorName?: string;
  actorType: AuditActorType;
  action: string;
  resource: string;
  resourceId?: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
}

export const auditLogRepository = {
  /** Append-only by convention — no update/delete method exists on this repository. */
  async record(entry: AuditLogInput): Promise<void> {
    await prisma.auditLog.create({
      data: {
        companyId: entry.companyId,
        actorId: entry.actorId,
        actorName: entry.actorName,
        actorType: entry.actorType,
        action: entry.action,
        resource: entry.resource,
        resourceId: entry.resourceId,
        details: entry.details as Prisma.InputJsonValue | undefined,
        ipAddress: entry.ipAddress,
        userAgent: entry.userAgent,
        requestId: entry.requestId,
      },
    });
  },
};
