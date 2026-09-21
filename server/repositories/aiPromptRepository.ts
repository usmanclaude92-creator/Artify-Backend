/** AI prompt template/version catalog (Phase 12 — docs/AI_ARCHITECTURE.md §14/§15). Organization-scoped via the same "global = Artify's own internal organization" convention as SystemSetting. */
import type { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import type { CreateAiPromptTemplateInput, CreateAiPromptVersionInput, UpdateAiPromptTemplateInput } from "../schemas/aiSchemas";

export interface AiPromptFilters {
  search?: string;
  status?: "DRAFT" | "ACTIVE" | "ARCHIVED";
}

export const aiPromptRepository = {
  async list(organizationId: string, filters: AiPromptFilters, page: number, limit: number, sort: string, order: "asc" | "desc") {
    const where = {
      organizationId,
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.search ? { name: { contains: filters.search, mode: "insensitive" as const } } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.aIPromptTemplate.findMany({
        where,
        include: { currentVersion: true },
        orderBy: { [sort]: order },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.aIPromptTemplate.count({ where }),
    ]);
    return { rows, total };
  },

  async findByIdInOrg(id: string, organizationId: string) {
    return prisma.aIPromptTemplate.findFirst({
      where: { id, organizationId },
      include: { currentVersion: true, versions: { orderBy: { version: "desc" } } },
    });
  },

  async findByKeyInOrg(key: string, organizationId: string) {
    return prisma.aIPromptTemplate.findUnique({ where: { organizationId_key: { organizationId, key } } });
  },

  async create(organizationId: string, createdById: string, input: CreateAiPromptTemplateInput) {
    return prisma.$transaction(async (tx) => {
      const template = await tx.aIPromptTemplate.create({
        data: {
          organizationId,
          key: input.key,
          name: input.name,
          purpose: input.purpose,
          status: "DRAFT",
          createdById,
          updatedById: createdById,
        },
      });
      const version = await tx.aIPromptVersion.create({
        data: {
          templateId: template.id,
          version: 1,
          systemInstructions: input.systemInstructions,
          userTemplate: input.userTemplate,
          variablesSchema: input.variablesSchema as Prisma.InputJsonValue | undefined,
          createdById,
        },
      });
      return tx.aIPromptTemplate.update({
        where: { id: template.id },
        data: { currentVersionId: version.id },
        include: { currentVersion: true },
      });
    });
  },

  async createVersion(templateId: string, createdById: string, input: CreateAiPromptVersionInput) {
    const latest = await prisma.aIPromptVersion.findFirst({ where: { templateId }, orderBy: { version: "desc" } });
    const nextVersion = (latest?.version ?? 0) + 1;
    return prisma.aIPromptVersion.create({
      data: {
        templateId,
        version: nextVersion,
        systemInstructions: input.systemInstructions,
        userTemplate: input.userTemplate,
        variablesSchema: input.variablesSchema as Prisma.InputJsonValue | undefined,
        createdById,
      },
    });
  },

  async update(id: string, updatedById: string, input: UpdateAiPromptTemplateInput) {
    return prisma.aIPromptTemplate.update({
      where: { id },
      data: { ...input, updatedById },
      include: { currentVersion: true },
    });
  },

  async setCurrentVersion(id: string, versionId: string, updatedById: string) {
    return prisma.aIPromptTemplate.update({
      where: { id },
      data: { currentVersionId: versionId, updatedById },
      include: { currentVersion: true },
    });
  },

  async findVersionInTemplate(templateId: string, versionId: string) {
    return prisma.aIPromptVersion.findFirst({ where: { id: versionId, templateId } });
  },
};
