/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Phase 13: Autonomous AI Workflows & Business Automation (imported from
 * usmanclaude92-creator/Artify-Backend---Google-AI-Studio-, commit 4a1d7cd).
 * Robust Workflow Execution & Background Queue Engine.
 *
 * Adapted (see server/services/copilot/CopilotService.ts's header comment
 * for the same rationale, repeated here since this file is the other
 * consumer of the source repo's excluded AI Control Center stack):
 *   - TOOL_CALL steps now resolve and call this repo's own governed tool
 *     registry (server/ai/toolRegistry.ts) directly — permission-checked
 *     against the step's actual initiating user (resolved via
 *     `resolveSanitizedUserForOrganization`; a TOOL_CALL step with no
 *     `initiatedById` fails loudly rather than running as an unattributed
 *     system actor, since every tool handler ultimately calls a service
 *     that expects a real `SanitizedUser` caller for its own audit trail).
 *   - AI_DECISION / AI_GENERATION steps call this repo's existing
 *     `defaultAiProvider` (server/ai/provider.ts) instead of the source's
 *     `aiOrchestrator`/agent catalog, which this repo does not have.
 */

import crypto from "node:crypto";
import { prisma } from "../../db/prisma";
import { logger } from "../../core/logger";
import { auditLogRepository } from "../../repositories/auditLogRepository";
import { ConditionEngine } from "./ConditionEngine";
import { actionRegistry } from "./ActionRegistry";
import { approvalEngine } from "./ApprovalEngine";
import { notificationEngine } from "./NotificationEngine";
import { AI_TOOL_REGISTRY, isRegisteredToolCode } from "../../ai/toolRegistry";
import { defaultAiProvider } from "../../ai/provider";
import { userRepository } from "../../repositories/userRepository";
import { resolveSanitizedUserForOrganization } from "../authService";
import { KnowledgeService } from "../knowledge/KnowledgeService";
import {
  DEFAULT_WORKFLOW_LIMITS,
  DEFAULT_RETRY_POLICY,
  StructuredAiDecisionSchema,
  WorkflowLimits,
  WorkflowRetryPolicy,
  WorkflowStepConfig,
  WorkflowTriggerType,
} from "./types";

export class WorkflowEngine {
  private static instance: WorkflowEngine;
  private queueInterval: NodeJS.Timeout | null = null;
  private isProcessingQueue = false;

  private constructor() {}

  public static getInstance(): WorkflowEngine {
    if (!WorkflowEngine.instance) {
      WorkflowEngine.instance = new WorkflowEngine();
    }
    return WorkflowEngine.instance;
  }

  /** Starts background worker that processes QUEUED executions. */
  public startWorker(intervalMs = 2000): void {
    if (this.queueInterval) return;
    this.queueInterval = setInterval(() => {
      this.processQueue().catch((err) => {
        logger.error({ err }, "[WorkflowEngine] Queue worker processing error");
      });
    }, intervalMs);
    this.queueInterval.unref();
  }

  public stopWorker(): void {
    if (this.queueInterval) {
      clearInterval(this.queueInterval);
      this.queueInterval = null;
    }
  }

  /** Enqueues an execution for background worker processing. */
  public async enqueueExecution(params: {
    workflowId: string;
    organizationId: string;
    triggerType: WorkflowTriggerType;
    triggerEventId?: string;
    entityType?: string;
    entityId?: string;
    input?: Record<string, unknown>;
    correlationId?: string;
    initiatedById?: string;
    idempotencyKey?: string;
  }): Promise<{ executionId: string; status: string }> {
    const workflow = await prisma.automationWorkflow.findFirst({ where: { id: params.workflowId, organizationId: params.organizationId } });
    if (!workflow) {
      throw new Error(`Workflow ${params.workflowId} not found.`);
    }
    if (workflow.status !== "ACTIVE") {
      throw new Error(`Workflow "${workflow.name}" is not active (status: ${workflow.status}).`);
    }

    const correlationId = params.correlationId || crypto.randomUUID();
    const versionToRun = workflow.publishedVersion || workflow.currentVersion;
    const executionId = crypto.randomUUID();

    if (params.idempotencyKey) {
      const existing = await prisma.automationExecution.findFirst({
        where: { organizationId: params.organizationId, idempotencyKey: params.idempotencyKey, status: { in: ["COMPLETED", "RUNNING", "WAITING_APPROVAL"] } },
      });
      if (existing) {
        logger.info({ idempotencyKey: params.idempotencyKey, existingId: existing.id }, "[WorkflowEngine] Idempotent execution already exists, returning existing");
        return { executionId: existing.id, status: existing.status };
      }
    }

    const steps = (Array.isArray(workflow.steps) ? workflow.steps : []) as unknown as WorkflowStepConfig[];

    await prisma.automationExecution.create({
      data: {
        id: executionId,
        organizationId: params.organizationId,
        workflowId: workflow.id,
        workflowVersion: versionToRun,
        status: "QUEUED",
        triggerType: params.triggerType,
        triggerEventId: params.triggerEventId || null,
        entityType: params.entityType || null,
        entityId: params.entityId || null,
        correlationId,
        idempotencyKey: params.idempotencyKey || null,
        input: (params.input || {}) as any,
        output: {},
        context: (params.input || {}) as any,
        currentStepIndex: 0,
        totalSteps: steps.length,
        initiatedById: params.initiatedById || null,
      },
    });

    setImmediate(() => {
      this.execute(executionId).catch((err) => {
        logger.error({ err, executionId }, "[WorkflowEngine] Background run error");
      });
    });

    return { executionId, status: "QUEUED" };
  }

  /** Process pending queued jobs in batch. */
  public async processQueue(): Promise<number> {
    if (this.isProcessingQueue) return 0;
    this.isProcessingQueue = true;

    try {
      const queuedJobs = await prisma.automationExecution.findMany({ where: { status: "QUEUED" }, take: 5, orderBy: { createdAt: "asc" } });
      for (const job of queuedJobs) {
        await this.execute(job.id);
      }
      return queuedJobs.length;
    } finally {
      this.isProcessingQueue = false;
    }
  }

  /** Core workflow execution loop. */
  public async execute(executionId: string): Promise<any> {
    const execution = await prisma.automationExecution.findUnique({ where: { id: executionId }, include: { workflow: true } });
    if (!execution) return null;
    if (execution.status === "COMPLETED" || execution.status === "CANCELLED") {
      return execution;
    }

    const workflow = execution.workflow;
    const steps = (Array.isArray(workflow.steps) ? workflow.steps : []) as unknown as WorkflowStepConfig[];
    const limits: WorkflowLimits = { ...DEFAULT_WORKFLOW_LIMITS, ...((workflow.limits as Record<string, unknown>) || {}) };
    const retryPolicy: WorkflowRetryPolicy = { ...DEFAULT_RETRY_POLICY, ...((workflow.retryPolicy as Record<string, unknown>) || {}) };

    const startTime = execution.startedAt ? new Date(execution.startedAt).getTime() : Date.now();
    await prisma.automationExecution.update({ where: { id: executionId }, data: { status: "RUNNING", startedAt: new Date(startTime) } });

    const context: Record<string, unknown> = {
      ...((execution.context as Record<string, unknown>) || {}),
      input: execution.input,
      trigger: { type: execution.triggerType, eventId: execution.triggerEventId, entityType: execution.entityType, entityId: execution.entityId, correlationId: execution.correlationId },
    };

    let aiCallCount = 0;
    let toolCallCount = 0;
    let stepCount = 0;
    let currentStepIdx = execution.currentStepIndex || 0;

    while (currentStepIdx < steps.length) {
      const step = steps[currentStepIdx];
      if (!step) {
        return this.failExecution(executionId, execution.organizationId, `Step at index ${currentStepIdx} is missing from workflow definition.`);
      }
      stepCount++;

      const elapsedMs = Date.now() - startTime;
      if (elapsedMs > limits.maxDurationMs) {
        return this.failExecution(executionId, execution.organizationId, `Execution timed out after ${elapsedMs}ms.`);
      }
      if (stepCount > limits.maxSteps) {
        return this.failExecution(executionId, execution.organizationId, `Exceeded maximum allowed workflow steps (${limits.maxSteps}).`);
      }

      const stepExecutionId = crypto.randomUUID();
      const stepStartTime = Date.now();

      await prisma.automationStepExecution.create({
        data: { id: stepExecutionId, executionId, stepIndex: currentStepIdx, stepId: step.id, stepName: step.name, stepType: step.type as any, status: "RUNNING", input: context as any, startedAt: new Date(stepStartTime) },
      });

      try {
        let stepOutput: Record<string, unknown> = {};
        let nextStepIdx = currentStepIdx + 1;

        switch (step.type) {
          case "CONDITION": {
            const matches = ConditionEngine.evaluate(step.condition, context);
            stepOutput = { conditionMet: matches };

            if (matches && step.thenStepId) {
              const targetIdx = steps.findIndex((s) => s.id === step.thenStepId);
              if (targetIdx !== -1) nextStepIdx = targetIdx;
            } else if (!matches && step.elseStepId) {
              const targetIdx = steps.findIndex((s) => s.id === step.elseStepId);
              if (targetIdx !== -1) nextStepIdx = targetIdx;
            }
            break;
          }

          case "AI_DECISION": {
            aiCallCount++;
            if (aiCallCount > limits.maxAiCalls) {
              throw new Error(`Exceeded maximum allowed AI calls (${limits.maxAiCalls}).`);
            }

            const interpolatedPrompt = this.interpolate(step.prompt, context);
            const decisionInstruction = `${interpolatedPrompt}\n\nYou MUST respond strictly in valid JSON matching this schema:\n{\n  "decision": "APPROVED" | "REJECTED" | "REVIEW_REQUIRED" | "FLAGGED",\n  "reason": "explanation string",\n  "confidence": number between 0 and 1,\n  "recommended_action": "action_string"\n}`;
            const result = await defaultAiProvider.generateText(decisionInstruction, { temperature: 0.1, responseMimeType: "application/json" });

            const rawContent = (result.text || "").trim();
            let parsedJson: unknown;
            try {
              const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
              parsedJson = JSON.parse(jsonMatch ? jsonMatch[0] : rawContent);
            } catch {
              parsedJson = { decision: "REVIEW_REQUIRED", reason: `AI output was not strictly valid JSON: ${rawContent.slice(0, 100)}`, confidence: 0.5, recommended_action: "MANUAL_REVIEW" };
            }

            const validated = StructuredAiDecisionSchema.safeParse(parsedJson);
            stepOutput = validated.success ? (validated.data as Record<string, unknown>) : { decision: "REVIEW_REQUIRED", reason: "AI output failed schema validation", confidence: 0.5, raw: rawContent };
            context[step.id] = stepOutput;
            break;
          }

          case "AI_GENERATION": {
            aiCallCount++;
            if (aiCallCount > limits.maxAiCalls) {
              throw new Error(`Exceeded maximum allowed AI calls (${limits.maxAiCalls}).`);
            }

            const interpolatedPrompt = this.interpolate(step.prompt, context);
            let citations: unknown[] = [];
            let promptWithContext = interpolatedPrompt;

            if (step.useKnowledgeBase) {
              try {
                const grounded = await KnowledgeService.getGroundedContext(
                  interpolatedPrompt,
                  { organizationId: execution.organizationId, userId: execution.initiatedById || undefined, userPermissions: ["*"] },
                  { filter: step.knowledgeFilter }
                );
                if (grounded.formattedContext) {
                  promptWithContext = `${grounded.formattedContext}\n\n${interpolatedPrompt}`;
                  citations = grounded.citations;
                }
              } catch (kErr) {
                logger.warn({ kErr, executionId }, "[WorkflowEngine] Knowledge grounding non-fatal error");
              }
            }

            const genResult = await defaultAiProvider.generateText(promptWithContext);
            stepOutput = { generatedText: genResult.text, citations };
            context[step.outputKey || step.id] = genResult.text;
            break;
          }

          case "TOOL_CALL": {
            toolCallCount++;
            if (toolCallCount > limits.maxToolCalls) {
              throw new Error(`Exceeded maximum allowed tool calls (${limits.maxToolCalls}).`);
            }
            if (!execution.initiatedById) {
              throw new Error(`Tool call step "${step.name}" requires a workflow initiated by a real user (initiatedById is empty).`);
            }
            if (!isRegisteredToolCode(step.toolName)) {
              throw new Error(`Tool "${step.toolName}" is not registered.`);
            }

            const initiatingUser = await userRepository.findById(execution.initiatedById);
            const caller = initiatingUser && (await resolveSanitizedUserForOrganization(initiatingUser, execution.organizationId));
            if (!caller) {
              throw new Error(`Initiating user no longer has access to this organization.`);
            }

            const definition = AI_TOOL_REGISTRY[step.toolName]!;
            if (!caller.role.permissions.includes(definition.requiredPermission) && caller.role.key !== "SUPER_ADMIN") {
              throw new Error(`Caller lacks required permission "${definition.requiredPermission}" for tool "${step.toolName}".`);
            }

            const toolArgs = this.interpolateObject(step.argumentsTemplate, context);
            const parsed = definition.inputSchema.safeParse(toolArgs);
            if (!parsed.success) {
              throw new Error(`Invalid input for tool "${step.toolName}": ${parsed.error.message}`);
            }

            stepOutput = ((await definition.handler(caller, parsed.data, {})) || {}) as Record<string, unknown>;
            context[step.outputKey || step.id] = stepOutput;
            break;
          }

          case "BUSINESS_ACTION": {
            if (step.requireApproval) {
              await approvalEngine.requestApproval({
                organizationId: execution.organizationId,
                executionId,
                stepExecutionId,
                workflowId: workflow.id,
                stepId: step.id,
                action: step.actionId,
                description: `Human approval required for action "${step.actionId}"`,
                payload: { parameters: step.parameters, context: context[step.id] || {} },
              });

              await prisma.automationExecution.update({ where: { id: executionId }, data: { status: "WAITING_APPROVAL", currentStepIndex: currentStepIdx, context: context as any } });
              await prisma.automationStepExecution.update({ where: { id: stepExecutionId }, data: { status: "WAITING_APPROVAL" } });

              logger.info({ executionId, stepId: step.id }, "[WorkflowEngine] Paused for human approval");
              return { executionId, status: "WAITING_APPROVAL" };
            }

            const actionParams = this.interpolateObject(step.parameters, context);
            const idempotencyKey = `${workflow.id}:${execution.workflowVersion}:${execution.correlationId}:${step.id}`;

            const actionOutput = await actionRegistry.executeAction({
              actionId: step.actionId,
              input: actionParams,
              organizationId: execution.organizationId,
              userId: execution.initiatedById || undefined,
              userPermissions: ["*"],
              workflowId: workflow.id,
              executionId,
              stepId: step.id,
              correlationId: execution.correlationId,
              idempotencyKey,
            });

            stepOutput = actionOutput;
            context[step.outputKey || step.id] = stepOutput;
            break;
          }

          case "APPROVAL": {
            const pendingApproval = await prisma.automationApproval.findFirst({ where: { executionId, stepId: step.id, status: "APPROVED" } });

            if (!pendingApproval) {
              await approvalEngine.requestApproval({
                organizationId: execution.organizationId,
                executionId,
                stepExecutionId,
                workflowId: workflow.id,
                stepId: step.id,
                action: "APPROVAL_GATE",
                description: this.interpolate(step.actionDescription, context),
                requiredRole: step.requiredRole,
                payload: { contextSummary: context },
                timeoutMinutes: step.timeoutMinutes,
              });

              await prisma.automationExecution.update({ where: { id: executionId }, data: { status: "WAITING_APPROVAL", currentStepIndex: currentStepIdx, context: context as any } });
              await prisma.automationStepExecution.update({ where: { id: stepExecutionId }, data: { status: "WAITING_APPROVAL" } });

              return { executionId, status: "WAITING_APPROVAL" };
            }

            stepOutput = { approved: true, approverId: pendingApproval.approverId };
            break;
          }

          case "NOTIFICATION": {
            const title = this.interpolate(step.titleTemplate, context);
            const message = this.interpolate(step.messageTemplate, context);
            const targetUserId = step.recipientUserId ? this.interpolate(step.recipientUserId, context) : undefined;

            stepOutput = await notificationEngine.dispatchNotification({
              organizationId: execution.organizationId,
              userId: targetUserId,
              recipientRole: step.recipientRole,
              channel: step.channel,
              title,
              message,
              level: step.level || "INFO",
              sourceWorkflowId: workflow.id,
              sourceExecutionId: executionId,
            });
            break;
          }

          case "DELAY": {
            const delaySec = Math.min(step.durationSeconds, 10);
            await new Promise((resolve) => setTimeout(resolve, delaySec * 1000));
            stepOutput = { delayedSeconds: delaySec };
            break;
          }

          case "TRANSFORM": {
            const transformed: Record<string, unknown> = {};
            for (const [outKey, pathExpr] of Object.entries(step.mappings)) {
              transformed[outKey] = ConditionEngine.resolvePath(context, pathExpr);
            }
            stepOutput = transformed;
            context[step.outputKey || step.id] = transformed;
            break;
          }

          case "LOOP": {
            const items = ConditionEngine.resolvePath(context, step.itemsPath);
            const loopArray = Array.isArray(items) ? items : [];
            const maxIter = Math.min(loopArray.length, step.maxIterations || limits.maxLoopIterations);
            const loopOutputs: unknown[] = [];
            for (let i = 0; i < maxIter; i++) {
              loopOutputs.push({ index: i, item: loopArray[i] });
            }
            stepOutput = { iterations: maxIter, itemsProcessed: loopOutputs };
            context[step.id] = stepOutput;
            break;
          }

          case "KNOWLEDGE_RETRIEVAL": {
            const query = this.interpolate(step.queryTemplate, context);
            const results = await KnowledgeService.search(
              { query, limit: step.maxResults || 5, filter: step.collectionIds?.length ? { collectionIds: step.collectionIds } : undefined },
              { organizationId: execution.organizationId, userId: execution.initiatedById || undefined, userPermissions: ["*"] }
            );

            stepOutput = {
              query,
              count: results.length,
              results: results.map((r: (typeof results)[number]) => ({ documentTitle: r.documentTitle, collection: r.collectionName, score: r.score, snippet: r.content.slice(0, 300), content: r.content })),
            };
            context[step.outputKey || step.id] = stepOutput;
            break;
          }

          default:
            break;
        }

        const stepDuration = Date.now() - stepStartTime;
        await prisma.automationStepExecution.update({ where: { id: stepExecutionId }, data: { status: "COMPLETED", output: stepOutput as any, durationMs: stepDuration, completedAt: new Date() } });

        currentStepIdx = nextStepIdx;
        await prisma.automationExecution.update({ where: { id: executionId }, data: { currentStepIndex: currentStepIdx, context: context as any } });
      } catch (stepErr: any) {
        const stepDuration = Date.now() - stepStartTime;
        await prisma.automationStepExecution.update({ where: { id: stepExecutionId }, data: { status: "FAILED", errorMessage: stepErr?.message || String(stepErr), durationMs: stepDuration, completedAt: new Date() } });

        if (execution.retryCount < retryPolicy.maxRetries && step.retryOnFailure !== false) {
          const backoff = retryPolicy.exponential ? retryPolicy.backoffMs * Math.pow(2, execution.retryCount) : retryPolicy.backoffMs;
          await prisma.automationExecution.update({ where: { id: executionId }, data: { retryCount: { increment: 1 }, status: "QUEUED", errorMessage: `Retrying after step failure: ${stepErr?.message}` } });
          logger.warn({ executionId, stepId: step.id, retry: execution.retryCount + 1, backoff }, "[WorkflowEngine] Scheduling retry after failure");
          return { executionId, status: "RETRYING" };
        }

        return this.failExecution(executionId, execution.organizationId, stepErr?.message || String(stepErr));
      }
    }

    const totalDuration = Date.now() - startTime;
    const completed = await prisma.automationExecution.update({ where: { id: executionId }, data: { status: "COMPLETED", completedAt: new Date(), durationMs: totalDuration, output: context as any } });

    await auditLogRepository.record({
      organizationId: execution.organizationId,
      actorUserId: execution.initiatedById || undefined,
      actorType: execution.initiatedById ? "USER" : "SYSTEM",
      action: "AUTOMATION_WORKFLOW_COMPLETED",
      resourceType: "automation_workflow",
      resourceId: workflow.id,
      metadata: { executionId, workflowName: workflow.name, durationMs: totalDuration, stepsExecuted: stepCount },
    });

    return completed;
  }

  /** Resume an execution after approval grant. */
  public async resumeExecution(executionId: string, organizationId: string): Promise<any> {
    const execution = await prisma.automationExecution.findFirst({ where: { id: executionId, organizationId } });
    if (!execution) {
      throw new Error(`Execution ${executionId} not found.`);
    }
    if (execution.status !== "WAITING_APPROVAL") {
      throw new Error(`Execution ${executionId} is not in WAITING_APPROVAL status (current: ${execution.status}).`);
    }

    await prisma.automationExecution.update({ where: { id: executionId }, data: { status: "QUEUED", currentStepIndex: execution.currentStepIndex + 1 } });
    return this.execute(executionId);
  }

  /** Cancel a running or waiting execution. */
  public async cancelExecution(executionId: string, organizationId: string, reason?: string): Promise<any> {
    const execution = await prisma.automationExecution.findFirst({ where: { id: executionId, organizationId } });
    if (!execution) {
      throw new Error(`Execution ${executionId} not found.`);
    }
    if (execution.status === "COMPLETED" || execution.status === "FAILED") {
      throw new Error(`Cannot cancel an execution with status ${execution.status}.`);
    }

    return prisma.automationExecution.update({ where: { id: executionId }, data: { status: "CANCELLED", completedAt: new Date(), errorMessage: reason || "Cancelled by user" } });
  }

  private async failExecution(executionId: string, organizationId: string, error: string): Promise<any> {
    const failed = await prisma.automationExecution.update({ where: { id: executionId }, data: { status: "FAILED", completedAt: new Date(), errorMessage: error } });

    await auditLogRepository.record({ organizationId, actorType: "SYSTEM", action: "AUTOMATION_WORKFLOW_FAILED", resourceType: "automation_execution", resourceId: executionId, metadata: { error } });

    return failed;
  }

  /** Interpolate variable strings like {{payload.client.name}} or {{invoice.amount}} */
  private interpolate(template: string, context: Record<string, unknown>): string {
    if (!template) return "";
    return template.replace(/\{\{([^}]+)\}\}/g, (_match, path) => {
      const val = ConditionEngine.resolvePath(context, path.trim());
      if (val === undefined || val === null) return "";
      if (typeof val === "object") return JSON.stringify(val);
      return String(val);
    });
  }

  private interpolateObject(obj: unknown, context: Record<string, unknown>): any {
    if (typeof obj === "string") {
      return this.interpolate(obj, context);
    }
    if (Array.isArray(obj)) {
      return obj.map((item) => this.interpolateObject(item, context));
    }
    if (obj !== null && typeof obj === "object") {
      const result: Record<string, any> = {};
      for (const [k, v] of Object.entries(obj as Record<string, any>)) {
        result[k] = this.interpolateObject(v, context);
      }
      return result;
    }
    return obj;
  }
}

export const workflowEngine = WorkflowEngine.getInstance();
