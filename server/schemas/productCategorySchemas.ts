import { z } from "zod";

export const listProductCategoriesQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
});
export type ListProductCategoriesQuery = z.infer<typeof listProductCategoriesQuerySchema>;

export const createProductCategorySchema = z.object({
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
export type CreateProductCategoryInput = z.infer<typeof createProductCategorySchema>;

export const updateProductCategorySchema = z
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
export type UpdateProductCategoryInput = z.infer<typeof updateProductCategorySchema>;
