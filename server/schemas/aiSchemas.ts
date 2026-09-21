/** Phase 12 AI Control Center schemas (docs/AI_GOVERNANCE.md, docs/AI_ARCHITECTURE.md). */
import { z } from "zod";
import { paginationQuerySchema, expectedUpdatedAtSchema } from "./commercialSchemas";

// ---- Providers & models (admin catalog) ----------------------------------

export const createAiProviderSchema = z.object({
  code: z.string().trim().min(1).max(50),
  name: z.string().trim().min(1).max(200),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
  isDefault: z.boolean().optional(),
});
export type CreateAiProviderInput = z.infer<typeof createAiProviderSchema>;

export const updateAiProviderSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
  isDefault: z.boolean().optional(),
});
export type UpdateAiProviderInput = z.infer<typeof updateAiProviderSchema>;

export const createAiModelSchema = z.object({
  providerId: z.string().uuid(),
  modelId: z.string().trim().min(1).max(100),
  displayName: z.string().trim().min(1).max(200),
  contextWindow: z.number().int().positive().optional(),
  supportsStructuredOutput: z.boolean().optional(),
  supportsToolCalling: z.boolean().optional(),
  inputPricePerMillionTokens: z.number().nonnegative().optional(),
  outputPricePerMillionTokens: z.number().nonnegative().optional(),
  isActive: z.boolean().optional(),
  isDefault: z.boolean().optional(),
});
export type CreateAiModelInput = z.infer<typeof createAiModelSchema>;

export const updateAiModelSchema = createAiModelSchema.partial().omit({ providerId: true, modelId: true });
export type UpdateAiModelInput = z.infer<typeof updateAiModelSchema>;

// ---- Tools & org settings --------------------------------------------------

export const updateAiOrgToolSettingSchema = z.object({
  enabled: z.boolean().optional(),
  requireApprovalOverride: z.boolean().nullable().optional(),
});
export type UpdateAiOrgToolSettingInput = z.infer<typeof updateAiOrgToolSettingSchema>;

// ---- Prompt templates & versions -------------------------------------------

const PROMPT_SORT_FIELDS = ["key", "name", "status", "createdAt", "updatedAt"] as const;
export const listAiPromptsQuerySchema = z.object(paginationQuerySchema(PROMPT_SORT_FIELDS, "createdAt", "desc"));
export type ListAiPromptsQuery = z.infer<typeof listAiPromptsQuerySchema>;

export const createAiPromptTemplateSchema = z.object({
  key: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9._-]+$/, "key must be lowercase, URL-safe (letters, numbers, dots, hyphens, underscores)"),
  name: z.string().trim().min(1).max(200),
  purpose: z.string().trim().max(1000).optional(),
  systemInstructions: z.string().trim().min(1).max(20000),
  userTemplate: z.string().trim().min(1).max(20000),
  variablesSchema: z.record(z.unknown()).optional(),
});
export type CreateAiPromptTemplateInput = z.infer<typeof createAiPromptTemplateSchema>;

export const createAiPromptVersionSchema = z.object({
  systemInstructions: z.string().trim().min(1).max(20000),
  userTemplate: z.string().trim().min(1).max(20000),
  variablesSchema: z.record(z.unknown()).optional(),
});
export type CreateAiPromptVersionInput = z.infer<typeof createAiPromptVersionSchema>;

export const updateAiPromptTemplateSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  purpose: z.string().trim().max(1000).nullable().optional(),
  status: z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]).optional(),
});
export type UpdateAiPromptTemplateInput = z.infer<typeof updateAiPromptTemplateSchema>;

export const publishAiPromptVersionSchema = z.object({
  versionId: z.string().uuid(),
});
export type PublishAiPromptVersionInput = z.infer<typeof publishAiPromptVersionSchema>;

// ---- Workflows --------------------------------------------------------------

const WORKFLOW_SORT_FIELDS = ["key", "name", "status", "createdAt", "updatedAt"] as const;
export const listAiWorkflowsQuerySchema = z.object(paginationQuerySchema(WORKFLOW_SORT_FIELDS, "createdAt", "desc"));
export type ListAiWorkflowsQuery = z.infer<typeof listAiWorkflowsQuerySchema>;

export const workflowStepSchema = z.object({
  order: z.number().int().nonnegative(),
  toolCode: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).optional(),
});

export const createAiWorkflowSchema = z.object({
  key: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9._-]+$/, "key must be lowercase, URL-safe (letters, numbers, dots, hyphens, underscores)"),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  steps: z.array(workflowStepSchema).min(1).max(10),
  maxSteps: z.number().int().positive().max(10).optional(),
  timeoutMs: z.number().int().positive().max(120000).optional(),
});
export type CreateAiWorkflowInput = z.infer<typeof createAiWorkflowSchema>;

export const updateAiWorkflowSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  steps: z.array(workflowStepSchema).min(1).max(10).optional(),
  maxSteps: z.number().int().positive().max(10).optional(),
  timeoutMs: z.number().int().positive().max(120000).optional(),
  expectedUpdatedAt: expectedUpdatedAtSchema,
});
export type UpdateAiWorkflowInput = z.infer<typeof updateAiWorkflowSchema>;

export const executeAiWorkflowSchema = z.object({
  /** Keyed by step order — each step's tool input, supplied by the caller (Phase 12 has no autonomous planning, see AIWorkflow's schema.prisma doc comment). */
  stepInputs: z.record(z.string(), z.record(z.unknown())).default({}),
});
export type ExecuteAiWorkflowInput = z.infer<typeof executeAiWorkflowSchema>;

// ---- Executions & tool calls --------------------------------------------------

export const executeAiToolSchema = z.object({
  toolCode: z.string().trim().min(1).max(100),
  input: z.record(z.unknown()).default({}),
});
export type ExecuteAiToolInput = z.infer<typeof executeAiToolSchema>;

const EXECUTION_SORT_FIELDS = ["createdAt", "startedAt", "status"] as const;
export const listAiExecutionsQuerySchema = z.object({
  ...paginationQuerySchema(EXECUTION_SORT_FIELDS, "createdAt", "desc"),
  kind: z.enum(["TOOL_CALL", "WORKFLOW"]).optional(),
  status: z.enum(["PENDING", "RUNNING", "AWAITING_APPROVAL", "COMPLETED", "FAILED", "CANCELLED"]).optional(),
});
export type ListAiExecutionsQuery = z.infer<typeof listAiExecutionsQuerySchema>;

// ---- Usage --------------------------------------------------------------------

export const usageSummaryQuerySchema = z.object({
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
});
export type UsageSummaryQuery = z.infer<typeof usageSummaryQuerySchema>;

// ---- Approvals ------------------------------------------------------------------

const APPROVAL_SORT_FIELDS = ["createdAt", "expiresAt", "status"] as const;
export const listAiApprovalsQuerySchema = z.object({
  ...paginationQuerySchema(APPROVAL_SORT_FIELDS, "createdAt", "desc"),
  status: z.enum(["PENDING", "APPROVED", "REJECTED", "EXPIRED"]).optional(),
});
export type ListAiApprovalsQuery = z.infer<typeof listAiApprovalsQuerySchema>;

export const decideAiApprovalSchema = z.object({
  decision: z.enum(["APPROVE", "REJECT"]),
  rejectionReason: z.string().trim().max(2000).optional(),
});
export type DecideAiApprovalInput = z.infer<typeof decideAiApprovalSchema>;
