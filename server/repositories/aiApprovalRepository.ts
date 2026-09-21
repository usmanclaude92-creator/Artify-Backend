/** AI approval requests — the §17 human-approval gate (Phase 12 — docs/AI_GOVERNANCE.md). */
import { prisma } from "../db/prisma";

export interface AiApprovalFilters {
  status?: "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED";
}

export const aiApprovalRepository = {
  async list(organizationId: string, filters: AiApprovalFilters, page: number, limit: number, sort: string, order: "asc" | "desc") {
    const where = { organizationId, ...filters };
    const [rows, total] = await Promise.all([
      prisma.aIApprovalRequest.findMany({
        where,
        include: { toolExecution: true, requestedBy: { select: { id: true, firstName: true, lastName: true, email: true } } },
        orderBy: { [sort]: order },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.aIApprovalRequest.count({ where }),
    ]);
    return { rows, total };
  },

  async findByIdInOrg(id: string, organizationId: string) {
    return prisma.aIApprovalRequest.findFirst({
      where: { id, organizationId },
      include: { toolExecution: true, execution: true },
    });
  },

  async approve(id: string, approvedById: string) {
    return prisma.aIApprovalRequest.update({
      where: { id },
      data: { status: "APPROVED", approvedById, approvedAt: new Date() },
    });
  },

  async reject(id: string, approvedById: string, rejectionReason?: string) {
    return prisma.aIApprovalRequest.update({
      where: { id },
      data: { status: "REJECTED", approvedById, approvedAt: new Date(), rejectionReason },
    });
  },

  async expireStale() {
    return prisma.aIApprovalRequest.updateMany({
      where: { status: "PENDING", expiresAt: { lt: new Date() } },
      data: { status: "EXPIRED" },
    });
  },
};
