/** AI prompt template/version management (Phase 12 — docs/AI_ARCHITECTURE.md §14/§15). Versions are immutable once created — publishing only moves the template's currentVersionId pointer. */
import { aiPromptRepository, type AiPromptFilters } from "../repositories/aiPromptRepository";
import { auditLogRepository } from "../repositories/auditLogRepository";
import { ConflictError, NotFoundError, ValidationError } from "../core/errors";
import type { SanitizedUser } from "../types/domain";
import type { CreateAiPromptTemplateInput, CreateAiPromptVersionInput, UpdateAiPromptTemplateInput } from "../schemas/aiSchemas";
import type { RequestMeta } from "./authService";

async function loadTemplateOrThrow(id: string, organizationId: string) {
  const template = await aiPromptRepository.findByIdInOrg(id, organizationId);
  if (!template) throw new NotFoundError("Prompt template not found.");
  return template;
}

export const aiPromptService = {
  async listTemplates(organizationId: string, filters: AiPromptFilters, page: number, limit: number, sort: string, order: "asc" | "desc") {
    return aiPromptRepository.list(organizationId, filters, page, limit, sort, order);
  },

  async getTemplate(organizationId: string, id: string) {
    return loadTemplateOrThrow(id, organizationId);
  },

  async createTemplate(caller: SanitizedUser, input: CreateAiPromptTemplateInput, meta: RequestMeta = {}) {
    const existing = await aiPromptRepository.findByKeyInOrg(input.key, caller.organizationId);
    if (existing) throw new ConflictError(`A prompt template with key "${input.key}" already exists in this organization.`);

    const template = await aiPromptRepository.create(caller.organizationId, caller.id, input);

    await auditLogRepository.record({
      organizationId: caller.organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "AI_PROMPT_TEMPLATE_CREATED",
      resourceType: "ai_prompt_template",
      resourceId: template.id,
      afterData: { key: template.key, name: template.name },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return template;
  },

  async createVersion(caller: SanitizedUser, templateId: string, input: CreateAiPromptVersionInput, meta: RequestMeta = {}) {
    await loadTemplateOrThrow(templateId, caller.organizationId);
    const version = await aiPromptRepository.createVersion(templateId, caller.id, input);

    await auditLogRepository.record({
      organizationId: caller.organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "AI_PROMPT_VERSION_CREATED",
      resourceType: "ai_prompt_version",
      resourceId: version.id,
      afterData: { templateId, version: version.version },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return version;
  },

  async updateTemplate(caller: SanitizedUser, id: string, input: UpdateAiPromptTemplateInput, meta: RequestMeta = {}) {
    await loadTemplateOrThrow(id, caller.organizationId);
    const template = await aiPromptRepository.update(id, caller.id, input);

    await auditLogRepository.record({
      organizationId: caller.organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "AI_PROMPT_TEMPLATE_UPDATED",
      resourceType: "ai_prompt_template",
      resourceId: id,
      afterData: input,
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return template;
  },

  async publishVersion(caller: SanitizedUser, templateId: string, versionId: string, meta: RequestMeta = {}) {
    await loadTemplateOrThrow(templateId, caller.organizationId);
    const version = await aiPromptRepository.findVersionInTemplate(templateId, versionId);
    if (!version) throw new ValidationError("versionId does not refer to a version of this prompt template.");

    const template = await aiPromptRepository.setCurrentVersion(templateId, versionId, caller.id);
    if (template.status === "DRAFT") {
      await aiPromptRepository.update(templateId, caller.id, { status: "ACTIVE" });
    }

    await auditLogRepository.record({
      organizationId: caller.organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "AI_PROMPT_VERSION_PUBLISHED",
      resourceType: "ai_prompt_template",
      resourceId: templateId,
      afterData: { versionId },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return aiPromptRepository.findByIdInOrg(templateId, caller.organizationId);
  },

  async deleteTemplate(caller: SanitizedUser, id: string, meta: RequestMeta = {}) {
    await loadTemplateOrThrow(id, caller.organizationId);
    await aiPromptRepository.update(id, caller.id, { status: "ARCHIVED" });

    await auditLogRepository.record({
      organizationId: caller.organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "AI_PROMPT_TEMPLATE_ARCHIVED",
      resourceType: "ai_prompt_template",
      resourceId: id,
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });
  },
};
