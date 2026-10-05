import { z } from "zod";

const permissionKeys = z.array(z.string().trim().min(1).max(100)).max(300);

export const createRoleSchema = z.object({
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(300).optional(),
  permissionKeys,
  confirmCritical: z.boolean().optional(),
});
export const updateRoleSchema = z
  .object({ name: z.string().trim().min(2).max(60).optional(), description: z.string().trim().max(300).nullable().optional() })
  .refine((v) => Object.keys(v).length > 0, { message: "At least one field must be provided." });
export const setRolePermissionsSchema = z.object({ permissionKeys, confirmCritical: z.boolean().default(false) });

export const upsertIntegrationSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    enabled: z.boolean().optional(),
    config: z.record(z.string().trim().max(500)).optional(),
    /** Write-only. Never returned by any endpoint. */
    secret: z.string().min(8).max(2000).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "At least one field must be provided." });

export const createWebhookEndpointSchema = z.object({
  name: z.string().trim().min(1).max(100),
  url: z.string().trim().url().max(2000),
  events: z.array(z.string().trim().min(1).max(100)).min(1).max(100),
});
export const updateWebhookEndpointSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    url: z.string().trim().url().max(2000).optional(),
    events: z.array(z.string().trim().min(1).max(100)).min(1).max(100).optional(),
    enabled: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "At least one field must be provided." });

export const createApiKeySchema = z.object({
  name: z.string().trim().min(1).max(100),
  scopes: z.array(z.string().trim().min(1).max(100)).min(1).max(50),
  expiresInDays: z.number().int().min(1).max(365).optional(),
});

export const pageQuerySchema = z.object({ page: z.coerce.number().int().positive().default(1), limit: z.coerce.number().int().positive().max(100).default(20) });
