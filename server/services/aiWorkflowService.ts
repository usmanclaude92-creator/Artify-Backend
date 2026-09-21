/** AI workflow CRUD + bounded execution (Phase 12 — docs/AI_WORKFLOW_ARCHITECTURE.md). Execution runs each step through server/ai/governance.ts — never calls a tool handler directly. */
import { aiWorkflowRepository, type AiWorkflowFilters } from "../repositories/aiWorkflowRepository";
import { aiExecutionRepository } from "../repositories/aiExecutionRepository";
import { auditLogRepository } from "../repositories/auditLogRepository";
import { executeGovernedTool } from "../ai/governance";
import { isRegisteredToolCode } from "../ai/toolRegistry";
import { ConflictError, NotFoundError, ValidationError } from "../core/errors";
import type { SanitizedUser } from "../types/domain";
import type { CreateAiWorkflowInput, ExecuteAiWorkflowInput, UpdateAiWorkflowInput } from "../schemas/aiSchemas";
import type { RequestMeta } from "./authService";

interface WorkflowStep {
  order: number;
  toolCode: string;
  description?: string;
}

function assertStepsValid(steps: WorkflowStep[], maxSteps: number): void {
  if (steps.length > maxSteps) {
    throw new ValidationError(`This workflow defines ${steps.length} steps, exceeding its own maxSteps (${maxSteps}).`);
  }
  for (const step of steps) {
    if (!isRegisteredToolCode(step.toolCode)) {
      throw new ValidationError(`Workflow step references unknown AI tool "${step.toolCode}".`);
    }
  }
}

async function loadWorkflowOrThrow(id: string, organizationId: string) {
  const workflow = await aiWorkflowRepository.findByIdInOrg(id, organizationId);
  if (!workflow) throw new NotFoundError("AI workflow not found.");
  return workflow;
}

export const aiWorkflowService = {
  async listWorkflows(organizationId: string, filters: AiWorkflowFilters, page: number, limit: number, sort: string, order: "asc" | "desc") {
    return aiWorkflowRepository.list(organizationId, filters, page, limit, sort, order);
  },

  async getWorkflow(organizationId: string, id: string) {
    return loadWorkflowOrThrow(id, organizationId);
  },

  async createWorkflow(caller: SanitizedUser, input: CreateAiWorkflowInput, meta: RequestMeta = {}) {
    const existing = await aiWorkflowRepository.findByKeyInOrg(input.key, caller.organizationId);
    if (existing) throw new ConflictError(`A workflow with key "${input.key}" already exists in this organization.`);

    assertStepsValid(input.steps, input.maxSteps ?? 10);
    const workflow = await aiWorkflowRepository.create(caller.organizationId, caller.id, input);

    await auditLogRepository.record({
      organizationId: caller.organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "AI_WORKFLOW_CREATED",
      resourceType: "ai_workflow",
      resourceId: workflow.id,
      afterData: { key: workflow.key, name: workflow.name },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return workflow;
  },

  async updateWorkflow(caller: SanitizedUser, id: string, input: UpdateAiWorkflowInput, meta: RequestMeta = {}) {
    const existing = await loadWorkflowOrThrow(id, caller.organizationId);
    if (input.expectedUpdatedAt && existing.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()) {
      throw new ConflictError("This workflow was modified by someone else since you loaded it.");
    }

    const { expectedUpdatedAt: _expectedUpdatedAt, ...patch } = input;
    if (patch.steps) {
      assertStepsValid(patch.steps, patch.maxSteps ?? existing.maxSteps);
    }

    const workflow = await aiWorkflowRepository.update(id, caller.id, patch);

    await auditLogRepository.record({
      organizationId: caller.organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "AI_WORKFLOW_UPDATED",
      resourceType: "ai_workflow",
      resourceId: id,
      afterData: patch,
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return workflow;
  },

  async publishWorkflow(caller: SanitizedUser, id: string, meta: RequestMeta = {}) {
    await loadWorkflowOrThrow(id, caller.organizationId);
    const workflow = await aiWorkflowRepository.setStatus(id, "ACTIVE", caller.id);

    await auditLogRepository.record({
      organizationId: caller.organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "AI_WORKFLOW_PUBLISHED",
      resourceType: "ai_workflow",
      resourceId: id,
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return workflow;
  },

  async archiveWorkflow(caller: SanitizedUser, id: string, meta: RequestMeta = {}) {
    await loadWorkflowOrThrow(id, caller.organizationId);
    const workflow = await aiWorkflowRepository.setStatus(id, "ARCHIVED", caller.id);

    await auditLogRepository.record({
      organizationId: caller.organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "AI_WORKFLOW_ARCHIVED",
      resourceType: "ai_workflow",
      resourceId: id,
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return workflow;
  },

  /**
   * Runs a workflow's bounded steps in order through the governance
   * dispatcher. Stops at the first step that fails or requires approval —
   * there is no retry/resume in Phase 12 (that is Phase 13's async job
   * territory); a workflow left AWAITING_APPROVAL is a terminal state here,
   * re-run from scratch once the approval is resolved.
   */
  async executeWorkflow(caller: SanitizedUser, id: string, input: ExecuteAiWorkflowInput, meta: RequestMeta = {}) {
    const workflow = await loadWorkflowOrThrow(id, caller.organizationId);
    if (workflow.status !== "ACTIVE") {
      throw new ValidationError("Only an ACTIVE workflow can be executed.");
    }

    const steps = (workflow.steps as unknown as WorkflowStep[]).slice().sort((a, b) => a.order - b.order);
    assertStepsValid(steps, workflow.maxSteps);

    const execution = await aiExecutionRepository.create({
      organizationId: caller.organizationId,
      userId: caller.id,
      kind: "WORKFLOW",
      workflowId: workflow.id,
      requestId: meta.requestId,
      input: input.stepInputs,
    });

    await auditLogRepository.record({
      organizationId: caller.organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "AI_WORKFLOW_EXECUTION_STARTED",
      resourceType: "ai_execution",
      resourceId: execution.id,
      afterData: { workflowId: workflow.id, workflowKey: workflow.key },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    const stepResults: unknown[] = [];
    const deadline = Date.now() + workflow.timeoutMs;

    for (const step of steps) {
      if (Date.now() > deadline) {
        const completed = await aiExecutionRepository.complete(execution.id, "FAILED", stepResults, "Workflow exceeded its timeout.");
        return completed;
      }

      const stepInput = input.stepInputs[String(step.order)] ?? {};
      const result = await executeGovernedTool({
        caller,
        toolCode: step.toolCode,
        input: stepInput,
        executionId: execution.id,
        stepOrder: step.order,
        meta,
      });

      stepResults.push({ order: step.order, toolCode: step.toolCode, ...result });

      if (result.status === "AWAITING_APPROVAL") {
        return aiExecutionRepository.complete(execution.id, "AWAITING_APPROVAL", stepResults);
      }
      if (result.status === "FAILED") {
        return aiExecutionRepository.complete(execution.id, "FAILED", stepResults, result.error);
      }
    }

    return aiExecutionRepository.complete(execution.id, "COMPLETED", stepResults);
  },
};
