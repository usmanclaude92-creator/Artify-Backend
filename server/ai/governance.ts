/**
 * Phase 12 AI governance dispatcher — the single choke point every AI tool
 * call goes through. Never call an `AiToolDefinition.handler` directly from
 * anywhere else (a route, a workflow step runner, a chat loop) — always go
 * through `executeGovernedTool` here, so every call gets the same
 * permission check, tenant scoping (via `caller`), org enablement check,
 * input validation, risk-based approval gate, and audit trail (see
 * docs/AI_GOVERNANCE.md).
 *
 * Financial-bypass-prevention guarantee: `resolveRequiresApproval` cannot
 * be made to return false for a HIGH-risk tool — an org's
 * `AIOrgToolSetting.requireApprovalOverride` can only ever *add* an
 * approval requirement, never remove the one a HIGH-risk tool always
 * carries. There is no code path from here into `invoiceService.issueInvoice`
 * or `contractService.activateContract` (the two HIGH-risk tools registered
 * today) that skips creating an `AIApprovalRequest` first.
 */
import crypto from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import { auditLogRepository } from "../repositories/auditLogRepository";
import { AuthorizationError, NotFoundError, ValidationError } from "../core/errors";
import type { SanitizedUser } from "../types/domain";
import type { RequestMeta } from "../services/authService";
import { AI_TOOL_REGISTRY, isRegisteredToolCode, type AiToolDefinition } from "./toolRegistry";

const SUPER_ADMIN_ROLE_KEY = "SUPER_ADMIN";

export type GovernedCallStatus = "COMPLETED" | "AWAITING_APPROVAL" | "FAILED";

export interface GovernedToolCallResult {
  status: GovernedCallStatus;
  output?: unknown;
  error?: string;
  toolExecutionId: string;
  approvalRequestId?: string;
}

function hasPermission(caller: SanitizedUser, permission: string): boolean {
  return caller.role.key === SUPER_ADMIN_ROLE_KEY || caller.role.permissions.includes(permission);
}

function payloadHash(input: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(input ?? {})).digest("hex");
}

/**
 * A HIGH-risk tool is always approval-gated. Below HIGH, an org can opt IN
 * to requiring approval (`requireApprovalOverride: true`) but never opt out
 * of a tool's own `requiresApproval: true` default — the override can only
 * raise the bar, never lower it.
 */
function resolveRequiresApproval(definition: AiToolDefinition, orgOverride: boolean | null | undefined): boolean {
  if (definition.riskLevel === "HIGH") return true;
  if (definition.requiresApproval) return true;
  return orgOverride === true;
}

async function assertToolEnabledForOrg(organizationId: string, toolCode: string): Promise<void> {
  const setting = await prisma.aIOrgToolSetting.findUnique({
    where: { organizationId_toolCode: { organizationId, toolCode } },
  });
  if (setting && !setting.enabled) {
    throw new AuthorizationError(`AI tool "${toolCode}" has been disabled for this organization.`);
  }
}

/**
 * Executes (or queues for approval) one governed tool call as a step of an
 * already-created `AIExecution` row. Returns without throwing on a business
 * failure (bad input, tool error) so a workflow runner can record the
 * failure on the AIExecution and decide whether to keep going — it only
 * throws for programmer errors (unknown tool, caller not authenticated).
 */
export async function executeGovernedTool(params: {
  caller: SanitizedUser;
  toolCode: string;
  input: unknown;
  executionId: string;
  stepOrder?: number;
  meta?: RequestMeta;
}): Promise<GovernedToolCallResult> {
  const { caller, toolCode, input, executionId, stepOrder, meta = {} } = params;

  if (!isRegisteredToolCode(toolCode)) {
    throw new NotFoundError(`AI tool "${toolCode}" is not registered.`);
  }
  const definition = AI_TOOL_REGISTRY[toolCode]!;

  const toolRow = await prisma.aITool.findUnique({ where: { code: toolCode } });
  if (!toolRow || toolRow.status !== "ENABLED") {
    throw new NotFoundError(`AI tool "${toolCode}" is not available.`);
  }

  if (!hasPermission(caller, definition.requiredPermission)) {
    throw new AuthorizationError(`Permission denied for AI tool "${toolCode}". Required privilege: "${definition.requiredPermission}"`);
  }

  await assertToolEnabledForOrg(caller.organizationId, toolCode);

  const parseResult = definition.inputSchema.safeParse(input);
  if (!parseResult.success) {
    throw new ValidationError(`Invalid input for AI tool "${toolCode}": ${parseResult.error.message}`);
  }
  const validatedInput = parseResult.data;

  const orgSetting = await prisma.aIOrgToolSetting.findUnique({
    where: { organizationId_toolCode: { organizationId: caller.organizationId, toolCode } },
  });
  const requiresApproval = resolveRequiresApproval(definition, orgSetting?.requireApprovalOverride);

  const startedAt = new Date();

  if (requiresApproval) {
    const toolExecution = await prisma.aIToolExecution.create({
      data: {
        executionId,
        toolCode,
        stepOrder,
        status: "AWAITING_APPROVAL",
        input: validatedInput as object,
        riskLevel: definition.riskLevel,
        requiresApproval: true,
        startedAt,
      },
    });

    const approval = await prisma.aIApprovalRequest.create({
      data: {
        organizationId: caller.organizationId,
        executionId,
        toolExecutionId: toolExecution.id,
        requestedById: caller.id,
        action: toolCode,
        resourceType: definition.riskLevel === "HIGH" ? toolCode.split(".")[0] : undefined,
        payload: validatedInput as object,
        payloadHash: payloadHash(validatedInput),
        status: "PENDING",
        expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
      },
    });

    await auditLogRepository.record({
      organizationId: caller.organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "AI_TOOL_APPROVAL_REQUESTED",
      resourceType: "ai_tool",
      resourceId: toolCode,
      afterData: { approvalRequestId: approval.id, toolExecutionId: toolExecution.id },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return { status: "AWAITING_APPROVAL", toolExecutionId: toolExecution.id, approvalRequestId: approval.id };
  }

  const toolExecution = await prisma.aIToolExecution.create({
    data: {
      executionId,
      toolCode,
      stepOrder,
      status: "RUNNING",
      input: validatedInput as object,
      riskLevel: definition.riskLevel,
      requiresApproval: false,
      startedAt,
    },
  });

  return runToolHandler(definition, caller, validatedInput, meta, toolExecution.id);
}

/**
 * Runs a tool's handler and records the outcome on an existing
 * AIToolExecution row. Shared by the direct (no-approval) path above and by
 * the approval-decision service once a human approves a pending request.
 */
export async function runToolHandler(
  definition: AiToolDefinition,
  caller: SanitizedUser,
  validatedInput: unknown,
  meta: RequestMeta,
  toolExecutionId: string
): Promise<GovernedToolCallResult> {
  const startedAt = new Date();
  try {
    const output = await definition.handler(caller, validatedInput, meta);
    const completedAt = new Date();

    await prisma.aIToolExecution.update({
      where: { id: toolExecutionId },
      data: {
        status: "COMPLETED",
        output: output === undefined ? Prisma.JsonNull : (output as Prisma.InputJsonValue),
        completedAt,
        durationMs: completedAt.getTime() - startedAt.getTime(),
      },
    });

    await auditLogRepository.record({
      organizationId: caller.organizationId,
      actorUserId: caller.id,
      actorType: "AI_COWORKER",
      actorName: `ai-tool:${definition.code}`,
      action: "AI_TOOL_EXECUTED",
      resourceType: "ai_tool",
      resourceId: definition.code,
      afterData: { toolExecutionId },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return { status: "COMPLETED", output, toolExecutionId };
  } catch (err) {
    const completedAt = new Date();
    const errorMessage = err instanceof Error ? err.message : "AI tool execution failed.";

    await prisma.aIToolExecution.update({
      where: { id: toolExecutionId },
      data: {
        status: "FAILED",
        errorMessage,
        completedAt,
        durationMs: completedAt.getTime() - startedAt.getTime(),
      },
    });

    await auditLogRepository.record({
      organizationId: caller.organizationId,
      actorUserId: caller.id,
      actorType: "AI_COWORKER",
      actorName: `ai-tool:${definition.code}`,
      action: "AI_TOOL_EXECUTION_FAILED",
      resourceType: "ai_tool",
      resourceId: definition.code,
      result: "FAILURE",
      afterData: { toolExecutionId, error: errorMessage },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return { status: "FAILED", error: errorMessage, toolExecutionId };
  }
}
