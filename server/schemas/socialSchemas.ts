import { z } from "zod";

export const connectStartSchema = z.object({ provider: z.string().regex(/^[a-z0-9_]{2,30}$/), accountId: z.string().min(1).max(64).optional() });
export const connectCallbackSchema = z.object({
  state: z.string().min(10).max(200),
  code: z.string().max(2000).optional(),
  error: z.string().max(500).optional(),
});
export const connectSelectSchema = z.object({ selectionId: z.string().uuid(), externalIds: z.array(z.string().min(1).max(100)).min(1).max(20) });
