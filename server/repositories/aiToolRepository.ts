/** AI tool governance catalog + per-organization overrides (Phase 12 — docs/AI_TOOL_SECURITY.md). The AITool rows themselves are platform-level and code-seeded (prisma/aiToolSeed.ts); only AIOrgToolSetting is organization-scoped. */
import { prisma } from "../db/prisma";
import type { UpdateAiOrgToolSettingInput } from "../schemas/aiSchemas";

export const aiToolRepository = {
  async listTools() {
    return prisma.aITool.findMany({ orderBy: { code: "asc" } });
  },

  async getToolByCode(code: string) {
    return prisma.aITool.findUnique({ where: { code } });
  },

  async listOrgSettings(organizationId: string) {
    return prisma.aIOrgToolSetting.findMany({ where: { organizationId } });
  },

  async getOrgSetting(organizationId: string, toolCode: string) {
    return prisma.aIOrgToolSetting.findUnique({ where: { organizationId_toolCode: { organizationId, toolCode } } });
  },

  async upsertOrgSetting(organizationId: string, toolCode: string, input: UpdateAiOrgToolSettingInput) {
    return prisma.aIOrgToolSetting.upsert({
      where: { organizationId_toolCode: { organizationId, toolCode } },
      update: input,
      create: {
        organizationId,
        toolCode,
        enabled: input.enabled ?? true,
        requireApprovalOverride: input.requireApprovalOverride ?? null,
      },
    });
  },
};
