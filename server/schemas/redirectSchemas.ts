import { z } from "zod";

/**
 * Site-relative path only — never an absolute URL. A redirect's `toPath`
 * ends up driving a real HTTP redirect on the public site
 * (server/services/publicSiteService.ts), so this also blocks the classic
 * open-redirect bypasses: a protocol-relative URL (`//evil.com`, browsers
 * treat it as same-scheme-different-host) and an embedded scheme
 * (`javascript:`, `https://evil.com`) anywhere in the string, not just at
 * the start (`/ok/../https://evil.com` would still pass a startsWith-only
 * check).
 */
const sitePathSchema = z
  .string()
  .trim()
  .min(1)
  .max(2048)
  .refine((v) => v.startsWith("/") && !v.startsWith("//"), { message: "Must be a site-relative path starting with a single /." })
  .refine((v) => !/[a-z][a-z0-9+.-]*:/i.test(v), { message: "Must not contain a URL scheme." });

export const listRedirectsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().trim().max(200).optional(),
  sort: z.enum(["createdAt", "updatedAt", "fromPath", "toPath"]).default("createdAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
});
export type ListRedirectsQuery = z.infer<typeof listRedirectsQuerySchema>;

export const createRedirectSchema = z
  .object({
    fromPath: sitePathSchema,
    toPath: sitePathSchema,
    statusCode: z.union([z.literal(301), z.literal(302), z.literal(307), z.literal(308)]).default(301),
  })
  .strict()
  .refine((v) => v.fromPath !== v.toPath, { message: "fromPath and toPath must differ.", path: ["toPath"] });
export type CreateRedirectInput = z.infer<typeof createRedirectSchema>;

export const updateRedirectSchema = z
  .object({
    toPath: sitePathSchema.optional(),
    statusCode: z.union([z.literal(301), z.literal(302), z.literal(307), z.literal(308)]).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "At least one field must be provided." });
export type UpdateRedirectInput = z.infer<typeof updateRedirectSchema>;
