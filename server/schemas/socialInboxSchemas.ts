import { z } from "zod";

const statusEnum = z.enum(["OPEN", "PENDING", "RESOLVED", "SPAM"]);
const priorityEnum = z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]);
const typeEnum = z.enum(["COMMENT", "DM", "MENTION", "REVIEW"]);
const bool = z.enum(["true", "false"]).transform((v) => v === "true");

export const listConversationsSchema = z.object({
  status: statusEnum.optional(), accountId: z.string().uuid().optional(), type: typeEnum.optional(), assignee: z.string().max(64).optional(), priority: priorityEnum.optional(),
  sentiment: z.enum(["positive", "neutral", "negative"]).optional(), overdue: bool.optional(), unread: bool.optional(), search: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(50).default(25),
});
export const sendReplySchema = z.object({ messageId: z.string().uuid().optional(), body: z.string().trim().min(1).max(5000).optional(), resolve: z.boolean().optional(), confirmNotSent: z.boolean().optional() })
  .refine((v) => v.messageId || v.body, { message: "Provide a draft id or a reply text." });
export const editDraftSchema = z.object({ body: z.string().trim().min(1).max(5000) });
export const noteSchema = z.object({ body: z.string().trim().min(1).max(5000) });
export const statusSchema = z.object({ status: statusEnum });
export const prioritySchema = z.object({ priority: priorityEnum });
export const assignSchema = z.object({ assigneeId: z.string().uuid().nullable() });
export const readSchema = z.object({ read: z.boolean() });
export const hideSchema = z.object({ hidden: z.boolean() });
export const leadSchema = z.object({ email: z.string().trim().email().max(255).optional(), name: z.string().trim().max(200).optional(), note: z.string().trim().max(1000).optional() });
export const bulkSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(100),
  patch: z.object({ status: statusEnum.optional(), assigneeId: z.string().uuid().nullable().optional(), priority: priorityEnum.optional(), markRead: z.boolean().optional() }).refine((p) => Object.keys(p).length > 0, { message: "Nothing to update." }),
});
export const inboxSettingsSchema = z.object({
  autoTriage: z.boolean(), autoDraft: z.boolean(), autoReply: z.boolean(), autoLead: z.boolean(),
  firstResponseMinutes: z.number().int().min(5).max(10080), retentionDays: z.number().int().min(7).max(3650),
}).partial().refine((v) => Object.keys(v).length > 0, { message: "Nothing to update." });
const words = z.array(z.string().trim().min(1).max(60)).max(30).default([]);
export const ruleSchema = z.object({
  name: z.string().trim().min(1).max(100), enabled: z.boolean().optional(), position: z.number().int().min(0).max(1000).optional(),
  matchKeywords: words.optional(), matchIntents: z.array(z.enum(["question", "lead", "complaint", "praise", "spam", "support_request", "other"])).max(7).optional(),
  matchSentiments: z.array(z.enum(["positive", "neutral", "negative"])).max(3).optional(), assigneeId: z.string().uuid().nullable().optional(),
  setPriority: priorityEnum.nullable().optional(), addTags: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
});
export const cannedSchema = z.object({ title: z.string().trim().min(1).max(100), body: z.string().trim().min(1).max(2000), category: z.string().trim().max(60).nullable().optional(), approvedForAuto: z.boolean().optional(), matchKeywords: words.optional() });
export const injectSchema = z.object({ accountId: z.string().uuid(), type: typeEnum.default("COMMENT"), text: z.string().trim().min(1).max(5000), handle: z.string().trim().max(60).optional(), name: z.string().trim().max(100).optional(), threadId: z.string().max(100).optional(), messageId: z.string().max(100).optional() });
