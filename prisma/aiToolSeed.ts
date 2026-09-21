/**
 * Syncs the code-defined AI tool registry (server/ai/toolRegistry.ts) into
 * the `ai_tools` table — the same "code is the source of truth, the DB row
 * is governance metadata" pattern rolePermissionSeed.ts uses for
 * permissions. Idempotent upsert, safe to run on every boot/test-setup
 * (prisma/seed.ts, tests/setup.ts) — never deletes a tool row that the
 * current registry no longer defines, since org-level AIOrgToolSetting rows
 * and historical AIToolExecution rows may still reference it by code
 * (onDelete: Restrict on AIToolExecution.tool — see schema.prisma).
 */
import type { PrismaClient } from "@prisma/client";
import { AI_TOOL_REGISTRY } from "../server/ai/toolRegistry";

export async function seedAiTools(prisma: PrismaClient): Promise<void> {
  for (const definition of Object.values(AI_TOOL_REGISTRY)) {
    await prisma.aITool.upsert({
      where: { code: definition.code },
      update: {
        name: definition.name,
        description: definition.description,
        requiredPermission: definition.requiredPermission,
        riskLevel: definition.riskLevel,
        isMutating: definition.isMutating,
        requiresApproval: definition.requiresApproval,
      },
      create: {
        code: definition.code,
        name: definition.name,
        description: definition.description,
        requiredPermission: definition.requiredPermission,
        riskLevel: definition.riskLevel,
        isMutating: definition.isMutating,
        requiresApproval: definition.requiresApproval,
        status: "ENABLED",
      },
    });
  }
}
