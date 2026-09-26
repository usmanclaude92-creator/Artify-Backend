import { z } from "zod";

const conversationModeSchema = z.enum(["ANSWER", "EXPLAIN", "SUMMARIZE", "ANALYZE", "RECOMMEND", "DRAFT", "EXECUTE"]);

export const createWorkspaceSchema = z.object({
  name: z.string().trim().min(1).max(200),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(150)
    .regex(/^[a-z0-9-]+$/, "slug must be lowercase, URL-safe (letters, numbers, hyphens)")
    .optional(),
  description: z.string().trim().max(2000).optional(),
  icon: z.string().trim().max(100).optional(),
  allowedTools: z.array(z.string().trim().min(1)).max(100).optional(),
  allowedModules: z.array(z.string().trim().min(1)).max(100).optional(),
  requiredPermissions: z.array(z.string().trim().min(1)).max(100).optional(),
  systemInstruction: z.string().trim().max(10000).optional(),
  defaultMode: conversationModeSchema.optional(),
  temperature: z.coerce.number().min(0).max(2).optional(),
  maxTokens: z.coerce.number().int().positive().max(32000).optional(),
  requireCitations: z.coerce.boolean().optional(),
});
export type CreateWorkspaceInput = z.infer<typeof createWorkspaceSchema>;

export const createConversationSchema = z.object({
  workspaceId: z.string().trim().uuid().optional(),
  title: z.string().trim().max(300).optional(),
  contextMetadata: z.record(z.unknown()).optional(),
});
export type CreateConversationInput = z.infer<typeof createConversationSchema>;

export const listConversationsQuerySchema = z.object({
  workspaceId: z.string().trim().uuid().optional(),
  status: z.string().trim().max(50).optional(),
  search: z.string().trim().max(300).optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
});
export type ListConversationsQuery = z.infer<typeof listConversationsQuerySchema>;

const contextMetadataSchema = z
  .object({
    currentModule: z.string().trim().max(200).optional(),
    currentPage: z.string().trim().max(200).optional(),
    selectedClientId: z.string().trim().uuid().optional(),
    selectedInvoiceId: z.string().trim().uuid().optional(),
    selectedDocumentId: z.string().trim().uuid().optional(),
    selectedWorkflowId: z.string().trim().uuid().optional(),
  })
  .catchall(z.unknown())
  .optional();

export const sendMessageSchema = z.object({
  conversationId: z.string().trim().uuid().optional(),
  workspaceId: z.string().trim().uuid().optional(),
  content: z.string().trim().min(1).max(20000),
  mode: conversationModeSchema.optional(),
  contextMetadata: contextMetadataSchema,
});
export type SendMessageInput = z.infer<typeof sendMessageSchema>;
