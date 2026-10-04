import { z } from "zod";

export const listIndustriesQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
});
export type ListIndustriesQuery = z.infer<typeof listIndustriesQuerySchema>;

export const createIndustrySchema = z.object({
  name: z.string().trim().min(1).max(150),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9-]+$/, "slug must be lowercase, URL-safe (letters, numbers, hyphens)")
    .optional(),
  description: z.string().trim().max(1000).optional(),
  displayOrder: z.number().int().min(0).optional(),
});
export type CreateIndustryInput = z.infer<typeof createIndustrySchema>;

export const updateIndustrySchema = z
  .object({
    name: z.string().trim().min(1).max(150).optional(),
    slug: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .regex(/^[a-z0-9-]+$/, "slug must be lowercase, URL-safe (letters, numbers, hyphens)")
      .optional(),
    description: z.string().trim().max(1000).nullable().optional(),
    displayOrder: z.number().int().min(0).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "At least one field must be provided." });
export type UpdateIndustryInput = z.infer<typeof updateIndustrySchema>;
