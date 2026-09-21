/** Direct (non-workflow) AI tool-call execution + execution history reads (Phase 12 — docs/AI_ARCHITECTURE.md §19). */
import { aiExecutionRepository, type AiExecutionFilters } from "../repositories/aiExecutionRepository";
import { executeGovernedTool } from "../ai/governance";
import { NotFoundError } from "../core/errors";
import type { SanitizedUser } from "../types/domain";
import type { ExecuteAiToolInput } from "../schemas/aiSchemas";
import type { RequestMeta } from "./authService";

export const aiExecutionService = {
  async listExecutions(organizationId: string, filters: AiExecutionFilters, page: number, limit: number, sort: string, order: "asc" | "desc") {
    return aiExecutionRepository.list(organizationId, filters, page, limit, sort, order);
  },

  async getExecution(organizationId: string, id: string) {
    const execution = await aiExecutionRepository.findByIdInOrg(id, organizationId);
    if (!execution) throw new NotFoundError("AI execution not found.");
    return execution;
  },

  /** A single governed tool call, outside of any workflow — e.g. a human coworker's assistant panel invoking one action directly. */
  async executeTool(caller: SanitizedUser, input: ExecuteAiToolInput, meta: RequestMeta = {}) {
    const execution = await aiExecutionRepository.create({
      organizationId: caller.organizationId,
      userId: caller.id,
      kind: "TOOL_CALL",
      toolCode: input.toolCode,
      requestId: meta.requestId,
      input: input.input,
    });

    const result = await executeGovernedTool({
      caller,
      toolCode: input.toolCode,
      input: input.input,
      executionId: execution.id,
      meta,
    });

    if (result.status === "AWAITING_APPROVAL") {
      return aiExecutionRepository.complete(execution.id, "AWAITING_APPROVAL", result);
    }
    if (result.status === "FAILED") {
      return aiExecutionRepository.complete(execution.id, "FAILED", result, result.error);
    }
    return aiExecutionRepository.complete(execution.id, "COMPLETED", result);
  },
};
