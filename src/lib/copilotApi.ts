/**
 * Phase 15 — AI Copilot API client (docs/COPILOT_ARCHITECTURE.md).
 * Same conventions as src/lib/aiApi.ts — kept in its own file given the
 * size of the Copilot surface. Types mirror this repo's actual Prisma
 * models/service return shapes (server/services/copilot/CopilotService.ts),
 * not the AI Studio source repo's shapes, which differ in a few fields
 * (e.g. citations carry `documentTitle`/`similarityScore`, not a
 * `collectionName`/`snippet` pair).
 */
import { apiClient } from "./apiClient";

export type CopilotResponseMode = "ANSWER" | "EXPLAIN" | "SUMMARIZE" | "ANALYZE" | "RECOMMEND" | "DRAFT" | "EXECUTE";

export interface CopilotWorkspace {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  description: string | null;
  icon: string;
  isSystem: boolean;
  isDefault: boolean;
  allowedTools: string[];
  allowedModules: string[];
  requiredPermissions: string[];
  systemInstruction: string | null;
  defaultMode: CopilotResponseMode;
  temperature: number;
  maxTokens: number;
  requireCitations: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CopilotCitation {
  sourceName: string;
  documentTitle: string;
  documentId: string;
  version: number;
  pageNumber?: number;
  sectionHeading?: string;
  chunkIndex: number;
  similarityScore: number;
}

export interface CopilotToolResult {
  tool: string;
  result: unknown;
}

export interface CopilotMessage {
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  status: "PENDING" | "COMPLETED" | "FAILED";
  providerType?: string | null;
  modelName?: string | null;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  durationMs: number;
  estimatedCost: number;
  citations?: CopilotCitation[];
  toolCalls?: CopilotToolResult[];
  createdAt: string;
}

export type CopilotActionPreviewStatus = "PENDING" | "EXECUTED" | "REJECTED" | "FAILED";

export interface CopilotActionPreview {
  id: string;
  organizationId: string;
  conversationId: string;
  toolName: string;
  actionType: string;
  targetEntity: string | null;
  changesSummary: string;
  parameters: Record<string, unknown>;
  riskLevel: string;
  reason: string | null;
  status: CopilotActionPreviewStatus;
  executionResult: unknown;
  createdAt: string;
}

export interface CopilotConversation {
  id: string;
  organizationId: string;
  workspaceId: string;
  userId: string;
  title: string;
  status: "ACTIVE" | "ARCHIVED";
  contextMetadata: Record<string, unknown>;
  messageCount: number;
  lastMessageAt: string;
  createdAt: string;
  workspace?: CopilotWorkspace;
  messages?: CopilotMessage[];
  actionPreviews?: CopilotActionPreview[];
}

export interface CopilotSendMessageResult {
  conversationId: string;
  userMessage: CopilotMessage;
  assistantMessage: CopilotMessage;
  actionPreview: CopilotActionPreview | null;
  citations: CopilotCitation[];
  toolResults: CopilotToolResult[];
  correlationId: string;
}

export interface CopilotDashboardStats {
  activeConversations: number;
  totalMessages: number;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  pendingActions: number;
  executedActions: number;
  totalTokens: number;
  estimatedCost: number;
  mostUsedWorkspaces: Array<{ id: string; name: string; slug: string; icon: string; conversationsCount: number }>;
  generatedAt: string;
}

export const copilotApi = {
  listWorkspaces: () => apiClient.get<{ workspaces: CopilotWorkspace[] }>("/copilot/workspaces"),
  getWorkspace: (id: string) => apiClient.get<{ workspace: CopilotWorkspace }>(`/copilot/workspaces/${id}`),
  createWorkspace: (payload: {
    name: string;
    description?: string;
    systemInstruction?: string;
    temperature?: number;
    allowedTools?: string[];
    allowedModules?: string[];
    requiredPermissions?: string[];
  }) => apiClient.post<{ workspace: CopilotWorkspace }>("/copilot/workspaces", payload),

  listConversations: (params: { workspaceId?: string; status?: "ACTIVE" | "ARCHIVED"; search?: string; limit?: number; offset?: number } = {}) => {
    const query = new URLSearchParams();
    if (params.workspaceId) query.set("workspaceId", params.workspaceId);
    if (params.status) query.set("status", params.status);
    if (params.search) query.set("search", params.search);
    if (params.limit) query.set("limit", String(params.limit));
    if (params.offset) query.set("offset", String(params.offset));
    const qs = query.toString();
    return apiClient.get<{ conversations: CopilotConversation[]; total: number; limit: number; offset: number }>(
      qs ? `/copilot/conversations?${qs}` : "/copilot/conversations"
    );
  },
  getConversation: (id: string) => apiClient.get<{ conversation: CopilotConversation }>(`/copilot/conversations/${id}`),
  createConversation: (payload: { workspaceId?: string; title?: string; contextMetadata?: Record<string, unknown> }) =>
    apiClient.post<{ conversation: CopilotConversation }>("/copilot/conversations", payload),
  archiveConversation: (id: string) => apiClient.post<{ conversation: CopilotConversation }>(`/copilot/conversations/${id}/archive`),
  deleteConversation: (id: string) => apiClient.delete<{ success: boolean; id: string }>(`/copilot/conversations/${id}`),

  sendMessage: (payload: {
    conversationId?: string;
    workspaceId?: string;
    content: string;
    mode?: CopilotResponseMode;
    contextMetadata?: Record<string, unknown>;
  }) => apiClient.post<CopilotSendMessageResult>("/copilot/messages", payload),

  confirmAction: (id: string) => apiClient.post<{ success: boolean; preview: CopilotActionPreview; result: unknown }>(`/copilot/actions/${id}/confirm`),
  rejectAction: (id: string) => apiClient.post<{ success: boolean; preview: CopilotActionPreview }>(`/copilot/actions/${id}/reject`),

  getDashboardStats: () => apiClient.get<CopilotDashboardStats>("/copilot/dashboard"),
};
