/**
 * Phase 12 — AI Control Center API client (docs/AI_ARCHITECTURE.md).
 * Same conventions as src/lib/api.ts's Phase 10 commercial modules
 * (paginatedGet for list endpoints, plain apiClient calls otherwise) — kept
 * in its own file given the size of the AI surface (7 sub-domains).
 */
import { apiClient } from "./apiClient";
import { paginatedGet } from "./api";

// ---- Providers & models ----------------------------------------------------

export type AiProviderStatusValue = "ACTIVE" | "INACTIVE";

export interface AiModel {
  id: string;
  providerId: string;
  modelId: string;
  displayName: string;
  contextWindow: number | null;
  supportsStructuredOutput: boolean;
  supportsToolCalling: boolean;
  inputPricePerMillionTokens: string | null;
  outputPricePerMillionTokens: string | null;
  isActive: boolean;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AiProvider {
  id: string;
  code: string;
  name: string;
  status: AiProviderStatusValue;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
  models?: AiModel[];
}

export const aiProvidersApi = {
  list: () => apiClient.get<{ providers: AiProvider[] }>("/ai/providers"),
  create: (payload: { code: string; name: string; status?: AiProviderStatusValue; isDefault?: boolean }) =>
    apiClient.post<{ provider: AiProvider }>("/ai/providers", payload),
  update: (id: string, payload: Partial<{ name: string; status: AiProviderStatusValue; isDefault: boolean }>) =>
    apiClient.patch<{ provider: AiProvider }>(`/ai/providers/${id}`, payload),
  listModels: (providerId?: string) => apiClient.get<{ models: AiModel[] }>(providerId ? `/ai/providers/models?providerId=${providerId}` : "/ai/providers/models"),
  createModel: (payload: {
    providerId: string;
    modelId: string;
    displayName: string;
    contextWindow?: number;
    supportsStructuredOutput?: boolean;
    supportsToolCalling?: boolean;
    inputPricePerMillionTokens?: number;
    outputPricePerMillionTokens?: number;
    isActive?: boolean;
    isDefault?: boolean;
  }) => apiClient.post<{ model: AiModel }>("/ai/providers/models", payload),
  updateModel: (id: string, payload: Partial<{ displayName: string; isActive: boolean; isDefault: boolean; contextWindow: number }>) =>
    apiClient.patch<{ model: AiModel }>(`/ai/providers/models/${id}`, payload),
};

// ---- Tools ------------------------------------------------------------------

export type AiToolRiskLevelValue = "READ_ONLY" | "LOW" | "MEDIUM" | "HIGH";

export interface AiTool {
  id: string;
  code: string;
  name: string;
  description: string;
  requiredPermission: string;
  riskLevel: AiToolRiskLevelValue;
  isMutating: boolean;
  requiresApproval: boolean;
  status: "ENABLED" | "DISABLED";
  orgEnabled: boolean;
  requireApprovalOverride: boolean | null;
}

export const aiToolsApi = {
  list: () => apiClient.get<{ tools: AiTool[] }>("/ai/tools"),
  updateSetting: (code: string, payload: { enabled?: boolean; requireApprovalOverride?: boolean | null }) =>
    apiClient.patch<{ setting: unknown }>(`/ai/tools/${code}/settings`, payload),
};

// ---- Prompt templates ---------------------------------------------------------

export type AiPromptStatusValue = "DRAFT" | "ACTIVE" | "ARCHIVED";

export interface AiPromptVersion {
  id: string;
  templateId: string;
  version: number;
  systemInstructions: string;
  userTemplate: string;
  createdAt: string;
}

export interface AiPromptTemplate {
  id: string;
  organizationId: string;
  key: string;
  name: string;
  purpose: string | null;
  status: AiPromptStatusValue;
  currentVersionId: string | null;
  currentVersion: AiPromptVersion | null;
  versions?: AiPromptVersion[];
  createdAt: string;
  updatedAt: string;
}

export const aiPromptsApi = {
  list: (params: { page?: number; limit?: number; search?: string } = {}) => paginatedGet<AiPromptTemplate>("/ai/prompts", "promptTemplates", params),
  get: (id: string) => apiClient.get<{ promptTemplate: AiPromptTemplate }>(`/ai/prompts/${id}`),
  create: (payload: { key: string; name: string; purpose?: string; systemInstructions: string; userTemplate: string }) =>
    apiClient.post<{ promptTemplate: AiPromptTemplate }>("/ai/prompts", payload),
  update: (id: string, payload: Partial<{ name: string; purpose: string | null; status: AiPromptStatusValue }>) =>
    apiClient.patch<{ promptTemplate: AiPromptTemplate }>(`/ai/prompts/${id}`, payload),
  createVersion: (id: string, payload: { systemInstructions: string; userTemplate: string }) =>
    apiClient.post<{ version: AiPromptVersion }>(`/ai/prompts/${id}/versions`, payload),
  publish: (id: string, versionId: string) => apiClient.post<{ promptTemplate: AiPromptTemplate }>(`/ai/prompts/${id}/publish`, { versionId }),
  archive: (id: string) => apiClient.delete<{ archived: boolean }>(`/ai/prompts/${id}`),
};

// ---- Workflows ------------------------------------------------------------------

export type AiWorkflowStatusValue = "DRAFT" | "ACTIVE" | "ARCHIVED";

export interface AiWorkflowStep {
  order: number;
  toolCode: string;
  description?: string;
}

export interface AiWorkflow {
  id: string;
  organizationId: string;
  key: string;
  name: string;
  description: string | null;
  status: AiWorkflowStatusValue;
  version: number;
  steps: AiWorkflowStep[];
  maxSteps: number;
  timeoutMs: number;
  createdAt: string;
  updatedAt: string;
}

export const aiWorkflowsApi = {
  list: (params: { page?: number; limit?: number; search?: string } = {}) => paginatedGet<AiWorkflow>("/ai/workflows", "workflows", params),
  get: (id: string) => apiClient.get<{ workflow: AiWorkflow }>(`/ai/workflows/${id}`),
  create: (payload: { key: string; name: string; description?: string; steps: AiWorkflowStep[]; maxSteps?: number; timeoutMs?: number }) =>
    apiClient.post<{ workflow: AiWorkflow }>("/ai/workflows", payload),
  update: (id: string, payload: Partial<{ name: string; description: string | null; steps: AiWorkflowStep[]; maxSteps: number; timeoutMs: number }>) =>
    apiClient.patch<{ workflow: AiWorkflow }>(`/ai/workflows/${id}`, payload),
  publish: (id: string) => apiClient.post<{ workflow: AiWorkflow }>(`/ai/workflows/${id}/publish`),
  archive: (id: string) => apiClient.delete<{ workflow: AiWorkflow }>(`/ai/workflows/${id}`),
  execute: (id: string, stepInputs: Record<string, Record<string, unknown>> = {}) =>
    apiClient.post<{ execution: AiExecution }>(`/ai/workflows/${id}/execute`, { stepInputs }),
};

// ---- Executions ------------------------------------------------------------------

export type AiExecutionKindValue = "TOOL_CALL" | "WORKFLOW";
export type AiExecutionStatusValue = "PENDING" | "RUNNING" | "AWAITING_APPROVAL" | "COMPLETED" | "FAILED" | "CANCELLED";

export interface AiToolExecution {
  id: string;
  executionId: string;
  toolCode: string;
  stepOrder: number | null;
  status: AiExecutionStatusValue;
  input: unknown;
  output: unknown;
  riskLevel: AiToolRiskLevelValue;
  requiresApproval: boolean;
  errorMessage: string | null;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
}

export interface AiExecution {
  id: string;
  organizationId: string;
  userId: string | null;
  kind: AiExecutionKindValue;
  workflowId: string | null;
  workflow?: { key: string; name: string } | null;
  toolCode: string | null;
  status: AiExecutionStatusValue;
  input: unknown;
  output: unknown;
  errorMessage: string | null;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  createdAt: string;
  toolExecutions?: AiToolExecution[];
}

export const aiExecutionsApi = {
  list: (params: { page?: number; limit?: number; kind?: AiExecutionKindValue; status?: AiExecutionStatusValue } = {}) =>
    paginatedGet<AiExecution>("/ai/executions", "executions", params),
  get: (id: string) => apiClient.get<{ execution: AiExecution }>(`/ai/executions/${id}`),
  executeTool: (toolCode: string, input: Record<string, unknown> = {}) =>
    apiClient.post<{ execution: AiExecution }>("/ai/executions/tool-call", { toolCode, input }),
};

// ---- Usage ------------------------------------------------------------------

export interface AiUsageRecord {
  id: string;
  organizationId: string;
  executionId: string;
  providerId: string | null;
  modelId: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  estimatedCost: string | null;
  currency: string;
  createdAt: string;
}

export interface AiUsageSummary {
  totals: { _sum: { inputTokens: number | null; outputTokens: number | null; totalTokens: number | null; estimatedCost: string | null }; _count: number };
  byModel: Array<{
    modelId: string | null;
    _sum: { inputTokens: number | null; outputTokens: number | null; totalTokens: number | null; estimatedCost: string | null };
    _count: number;
  }>;
}

export const aiUsageApi = {
  list: (params: { dateFrom?: string; dateTo?: string } = {}) => {
    const query = new URLSearchParams();
    if (params.dateFrom) query.set("dateFrom", params.dateFrom);
    if (params.dateTo) query.set("dateTo", params.dateTo);
    const qs = query.toString();
    return apiClient.get<{ usageRecords: AiUsageRecord[] }>(qs ? `/ai/usage?${qs}` : "/ai/usage");
  },
  summary: (params: { dateFrom?: string; dateTo?: string } = {}) => {
    const query = new URLSearchParams();
    if (params.dateFrom) query.set("dateFrom", params.dateFrom);
    if (params.dateTo) query.set("dateTo", params.dateTo);
    const qs = query.toString();
    return apiClient.get<{ summary: AiUsageSummary }>(qs ? `/ai/usage/summary?${qs}` : "/ai/usage/summary");
  },
};

// ---- Approvals ------------------------------------------------------------------

export type AiApprovalStatusValue = "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED";

export interface AiApprovalRequest {
  id: string;
  organizationId: string;
  executionId: string | null;
  toolExecutionId: string | null;
  requestedById: string;
  requestedBy?: { id: string; firstName: string; lastName: string; email: string };
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  payload: Record<string, unknown>;
  status: AiApprovalStatusValue;
  approvedById: string | null;
  approvedAt: string | null;
  rejectionReason: string | null;
  expiresAt: string;
  createdAt: string;
}

export const aiApprovalsApi = {
  list: (params: { page?: number; limit?: number; status?: AiApprovalStatusValue } = {}) => paginatedGet<AiApprovalRequest>("/ai/approvals", "approvals", params),
  get: (id: string) => apiClient.get<{ approval: AiApprovalRequest }>(`/ai/approvals/${id}`),
  decide: (id: string, decision: "APPROVE" | "REJECT", rejectionReason?: string) =>
    apiClient.post<{ approval: AiApprovalRequest }>(`/ai/approvals/${id}/decide`, { decision, rejectionReason }),
};
