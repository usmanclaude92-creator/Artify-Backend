import { z } from "zod";

const bool = z.enum(["true", "false"]).transform((v) => v === "true");
export const listeningQuerySchema = z.object({
  status: z.enum(["OPEN", "PENDING", "RESOLVED", "SPAM"]).optional(),
  sentiment: z.enum(["positive", "neutral", "negative"]).optional(),
  topic: z.string().trim().max(60).optional(),
  assignee: z.string().max(64).optional(),
  crisis: bool.optional(),
  accountId: z.string().uuid().optional(),
  search: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(25),
});
export const reviewOverviewSchema = z.object({ days: z.coerce.number().int().min(7).max(365).default(90) });
