/** AI tool catalog + per-organization enablement (Phase 12 — docs/AI_TOOL_SECURITY.md). */
import { aiToolRepository } from "../repositories/aiToolRepository";
import { auditLogRepository } from "../repositories/auditLogRepository";
import { NotFoundError } from "../core/errors";
import type { SanitizedUser } from "../types/domain";
import type { UpdateAiOrgToolSettingInput } from "../schemas/aiSchemas";
import type { RequestMeta } from "./authService";

export const aiToolService = {
  async listToolsForOrg(organizationId: string) {
    const [tools, settings] = await Promise.all([aiToolRepository.listTools(), aiToolRepository.listOrgSettings(organizationId)]);
    const settingByCode = new Map(settings.map((s) => [s.toolCode, s]));
    return tools.map((tool) => ({
      ...tool,
      orgEnabled: settingByCode.get(tool.code)?.enabled ?? true,
      requireApprovalOverride: settingByCode.get(tool.code)?.requireApprovalOverride ?? null,
    }));
  },

  async updateOrgSetting(caller: SanitizedUser, toolCode: string, input: UpdateAiOrgToolSettingInput, meta: RequestMeta = {}) {
    const tool = await aiToolRepository.getToolByCode(toolCode);
    if (!tool) throw new NotFoundError(`AI tool "${toolCode}" not found.`);

    const setting = await aiToolRepository.upsertOrgSetting(caller.organizationId, toolCode, input);

    await auditLogRepository.record({
      organizationId: caller.organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "AI_ORG_TOOL_SETTING_UPDATED",
      resourceType: "ai_tool",
      resourceId: toolCode,
      afterData: { enabled: setting.enabled, requireApprovalOverride: setting.requireApprovalOverride },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return setting;
  },
};
