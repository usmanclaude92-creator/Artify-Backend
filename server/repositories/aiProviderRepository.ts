/** Platform-level AI provider/model catalog (Phase 12 — docs/AI_ARCHITECTURE.md). No organization scoping — this is admin-managed platform configuration, same pattern as the Phase 7 Product catalog. */
import { prisma } from "../db/prisma";
import type { CreateAiModelInput, CreateAiProviderInput, UpdateAiModelInput, UpdateAiProviderInput } from "../schemas/aiSchemas";

export const aiProviderRepository = {
  async listProviders() {
    return prisma.aIProvider.findMany({ include: { models: true }, orderBy: { name: "asc" } });
  },

  async getProvider(id: string) {
    return prisma.aIProvider.findUnique({ where: { id }, include: { models: true } });
  },

  async findProviderByCode(code: string) {
    return prisma.aIProvider.findUnique({ where: { code } });
  },

  async createProvider(input: CreateAiProviderInput) {
    return prisma.aIProvider.create({
      data: { code: input.code, name: input.name, status: input.status ?? "INACTIVE", isDefault: input.isDefault ?? false },
    });
  },

  async updateProvider(id: string, input: UpdateAiProviderInput) {
    return prisma.aIProvider.update({ where: { id }, data: input });
  },

  async clearDefaultProviders() {
    await prisma.aIProvider.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
  },

  async listModels(providerId?: string) {
    return prisma.aIModel.findMany({ where: providerId ? { providerId } : undefined, orderBy: { displayName: "asc" } });
  },

  async getModel(id: string) {
    return prisma.aIModel.findUnique({ where: { id } });
  },

  async createModel(input: CreateAiModelInput) {
    return prisma.aIModel.create({
      data: {
        providerId: input.providerId,
        modelId: input.modelId,
        displayName: input.displayName,
        contextWindow: input.contextWindow,
        supportsStructuredOutput: input.supportsStructuredOutput ?? false,
        supportsToolCalling: input.supportsToolCalling ?? false,
        inputPricePerMillionTokens: input.inputPricePerMillionTokens,
        outputPricePerMillionTokens: input.outputPricePerMillionTokens,
        isActive: input.isActive ?? true,
        isDefault: input.isDefault ?? false,
      },
    });
  },

  async updateModel(id: string, input: UpdateAiModelInput) {
    return prisma.aIModel.update({ where: { id }, data: input });
  },

  async clearDefaultModels(providerId: string) {
    await prisma.aIModel.updateMany({ where: { providerId, isDefault: true }, data: { isDefault: false } });
  },
};
