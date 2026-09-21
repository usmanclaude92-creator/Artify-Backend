/** AI execution history (Phase 12 — docs/AI_ARCHITECTURE.md §19). Read/create only — executions are an append-only audit trail, never edited after the fact beyond status/output transitions the execution/governance services make themselves. */
import { prisma } from "../db/prisma";

export interface AiExecutionFilters {
  kind?: "TOOL_CALL" | "WORKFLOW";
  status?: "PENDING" | "RUNNING" | "AWAITING_APPROVAL" | "COMPLETED" | "FAILED" | "CANCELLED";
}

export const aiExecutionRepository = {
  async list(organizationId: string, filters: AiExecutionFilters, page: number, limit: number, sort: string, order: "asc" | "desc") {
    const where = { organizationId, ...filters };
    const [rows, total] = await Promise.all([
      prisma.aIExecution.findMany({
        where,
        include: { toolExecutions: true, workflow: { select: { key: true, name: true } } },
        orderBy: { [sort]: order },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.aIExecution.count({ where }),
    ]);
    return { rows, total };
  },

  async findByIdInOrg(id: string, organizationId: string) {
    return prisma.aIExecution.findFirst({
      where: { id, organizationId },
      include: { toolExecutions: true, usageRecords: true, approvals: true, workflow: { select: { key: true, name: true } } },
    });
  },

  async create(data: {
    organizationId: string;
    userId: string;
    kind: "TOOL_CALL" | "WORKFLOW";
    workflowId?: string;
    toolCode?: string;
    requestId?: string;
    input?: unknown;
  }) {
    return prisma.aIExecution.create({
      data: {
        organizationId: data.organizationId,
        userId: data.userId,
        kind: data.kind,
        workflowId: data.workflowId,
        toolCode: data.toolCode,
        requestId: data.requestId,
        input: data.input as object,
        status: "RUNNING",
      },
    });
  },

  async complete(id: string, status: "COMPLETED" | "FAILED" | "AWAITING_APPROVAL" | "CANCELLED", output: unknown, errorMessage?: string) {
    const startedAt = (await prisma.aIExecution.findUnique({ where: { id }, select: { startedAt: true } }))?.startedAt ?? new Date();
    const completedAt = new Date();
    return prisma.aIExecution.update({
      where: { id },
      data: {
        status,
        output: output as object,
        errorMessage,
        completedAt,
        durationMs: completedAt.getTime() - startedAt.getTime(),
      },
    });
  },
};
