/** AI workflow catalog (Phase 12 — docs/AI_WORKFLOW_ARCHITECTURE.md). Bounded, deterministic step sequences only — see AIWorkflow's schema.prisma doc comment. */
import { prisma } from "../db/prisma";
import type { CreateAiWorkflowInput, UpdateAiWorkflowInput } from "../schemas/aiSchemas";

export interface AiWorkflowFilters {
  search?: string;
  status?: "DRAFT" | "ACTIVE" | "ARCHIVED";
}

export const aiWorkflowRepository = {
  async list(organizationId: string, filters: AiWorkflowFilters, page: number, limit: number, sort: string, order: "asc" | "desc") {
    const where = {
      organizationId,
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.search ? { name: { contains: filters.search, mode: "insensitive" as const } } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.aIWorkflow.findMany({ where, orderBy: { [sort]: order }, skip: (page - 1) * limit, take: limit }),
      prisma.aIWorkflow.count({ where }),
    ]);
    return { rows, total };
  },

  async findByIdInOrg(id: string, organizationId: string) {
    return prisma.aIWorkflow.findFirst({ where: { id, organizationId } });
  },

  async findByKeyInOrg(key: string, organizationId: string) {
    return prisma.aIWorkflow.findUnique({ where: { organizationId_key: { organizationId, key } } });
  },

  async create(organizationId: string, createdById: string, input: CreateAiWorkflowInput) {
    return prisma.aIWorkflow.create({
      data: {
        organizationId,
        key: input.key,
        name: input.name,
        description: input.description,
        status: "DRAFT",
        version: 1,
        steps: input.steps,
        maxSteps: input.maxSteps ?? 10,
        timeoutMs: input.timeoutMs ?? 30000,
        createdById,
        updatedById: createdById,
      },
    });
  },

  async update(id: string, updatedById: string, input: Omit<UpdateAiWorkflowInput, "expectedUpdatedAt">) {
    return prisma.aIWorkflow.update({
      where: { id },
      data: { ...input, updatedById, ...(input.steps ? { version: { increment: 1 } } : {}) },
    });
  },

  async setStatus(id: string, status: "DRAFT" | "ACTIVE" | "ARCHIVED", updatedById: string) {
    return prisma.aIWorkflow.update({ where: { id }, data: { status, updatedById } });
  },
};
