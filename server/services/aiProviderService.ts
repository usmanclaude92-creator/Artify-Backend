/** AI provider/model catalog management (Phase 12 — docs/AI_ARCHITECTURE.md). Platform-level, admin-only (ai.providers.manage/ai.models.manage) — credentials themselves stay in server-side env config (server/ai/provider.ts), never stored here. */
import { aiProviderRepository } from "../repositories/aiProviderRepository";
import { auditLogRepository } from "../repositories/auditLogRepository";
import { ConflictError, NotFoundError } from "../core/errors";
import type { SanitizedUser } from "../types/domain";
import type { CreateAiModelInput, CreateAiProviderInput, UpdateAiModelInput, UpdateAiProviderInput } from "../schemas/aiSchemas";
import type { RequestMeta } from "./authService";

export const aiProviderService = {
  async listProviders() {
    return aiProviderRepository.listProviders();
  },

  async getProvider(id: string) {
    const provider = await aiProviderRepository.getProvider(id);
    if (!provider) throw new NotFoundError("AI provider not found.");
    return provider;
  },

  async createProvider(caller: SanitizedUser, input: CreateAiProviderInput, meta: RequestMeta = {}) {
    const existing = await aiProviderRepository.findProviderByCode(input.code);
    if (existing) throw new ConflictError(`An AI provider with code "${input.code}" already exists.`);

    if (input.isDefault) await aiProviderRepository.clearDefaultProviders();
    const provider = await aiProviderRepository.createProvider(input);

    await auditLogRepository.record({
      organizationId: caller.organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "AI_PROVIDER_CREATED",
      resourceType: "ai_provider",
      resourceId: provider.id,
      afterData: { code: provider.code, status: provider.status },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return provider;
  },

  async updateProvider(caller: SanitizedUser, id: string, input: UpdateAiProviderInput, meta: RequestMeta = {}) {
    await this.getProvider(id);
    if (input.isDefault) await aiProviderRepository.clearDefaultProviders();
    const provider = await aiProviderRepository.updateProvider(id, input);

    await auditLogRepository.record({
      organizationId: caller.organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "AI_PROVIDER_UPDATED",
      resourceType: "ai_provider",
      resourceId: id,
      afterData: input,
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return provider;
  },

  async listModels(providerId?: string) {
    return aiProviderRepository.listModels(providerId);
  },

  async createModel(caller: SanitizedUser, input: CreateAiModelInput, meta: RequestMeta = {}) {
    await this.getProvider(input.providerId);
    if (input.isDefault) await aiProviderRepository.clearDefaultModels(input.providerId);
    const model = await aiProviderRepository.createModel(input);

    await auditLogRepository.record({
      organizationId: caller.organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "AI_MODEL_CREATED",
      resourceType: "ai_model",
      resourceId: model.id,
      afterData: { providerId: model.providerId, modelId: model.modelId },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return model;
  },

  async updateModel(caller: SanitizedUser, id: string, input: UpdateAiModelInput, meta: RequestMeta = {}) {
    const existing = await aiProviderRepository.getModel(id);
    if (!existing) throw new NotFoundError("AI model not found.");
    if (input.isDefault) await aiProviderRepository.clearDefaultModels(existing.providerId);
    const model = await aiProviderRepository.updateModel(id, input);

    await auditLogRepository.record({
      organizationId: caller.organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "AI_MODEL_UPDATED",
      resourceType: "ai_model",
      resourceId: id,
      afterData: input,
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return model;
  },
};
