import { z } from "zod";

export const listAuditLogsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  organizationId: z.string().trim().uuid().optional(),
  actorUserId: z.string().trim().uuid().optional(),
  action: z.string().trim().max(100).optional(),
  resourceType: z.string().trim().max(100).optional(),
  resourceId: z.string().trim().max(100).optional(),
  actorType: z.enum(["USER", "AI_COWORKER", "SYSTEM", "API_KEY"]).optional(),
  q: z.string().trim().max(100).optional(),
  severity: z.enum(["info", "warning", "critical"]).optional(),
  result: z.enum(["SUCCESS", "FAILURE"]).optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
});
export type ListAuditLogsQuery = z.infer<typeof listAuditLogsQuerySchema>;
