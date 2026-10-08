import { z } from "zod";

export const APPROVAL_SOURCES = ["ai", "automation", "content", "social", "landing"] as const;
export type ApprovalSource = (typeof APPROVAL_SOURCES)[number];

export const listApprovalsQuerySchema = z.object({
  source: z.enum(APPROVAL_SOURCES).optional(),
  status: z.enum(["pending", "approved", "rejected"]).default("pending"),
  assignee: z.enum(["me", "all"]).default("all"),
  search: z.string().trim().max(200).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type ListApprovalsQuery = z.infer<typeof listApprovalsQuerySchema>;

export const approvalDecisionSchema = z
  .object({
    decision: z.enum(["approve", "reject"]),
    comment: z.string().trim().max(2000).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.decision === "reject" && !v.comment) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["comment"], message: "A comment is required when rejecting." });
    }
  });
export type ApprovalDecisionInput = z.infer<typeof approvalDecisionSchema>;

export const approvalSourceParamSchema = z.enum(APPROVAL_SOURCES);
