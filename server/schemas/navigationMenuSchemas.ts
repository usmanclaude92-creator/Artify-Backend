/**
 * Navigation Menu schema fragments (Phase 5). Mirrors templateSchemas.ts's
 * shape for the top-level resource (list/create/update/duplicate/revert),
 * but — unlike Template.structure/TemplatePart.content, which stay
 * deliberately unconstrained JSON — a menu's `items` tree IS validated
 * structurally here: a menu item is a real, bounded concept (a label, a
 * link target, optional children), not an arbitrary editor document, so
 * loose free-form JSON would let a broken/unresolvable item slip in
 * silently instead of failing validation up front.
 */
import { z } from "zod";
import { expectedUpdatedAtSchema } from "./contentSchemas";

export const navigationMenuTypeSchema = z.enum(["PRIMARY", "HEADER", "FOOTER", "MOBILE", "CUSTOM"]);

const navigationMenuWorkflowStatusSchema = z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]);

const slugSchema = z
  .string()
  .trim()
  .min(1)
  .max(150)
  .regex(/^[a-z0-9-]+$/, "slug must be lowercase, URL-safe (letters, numbers, hyphens)");

const SORT_FIELDS = ["name", "slug", "type", "status", "createdAt", "updatedAt"] as const;

export const menuLinkTypeSchema = z.enum(["page", "post", "category", "tag", "product", "custom"]);

export interface MenuItemInput {
  id: string;
  label: string;
  linkType: z.infer<typeof menuLinkTypeSchema>;
  targetId?: string;
  url?: string;
  openInNewTab: boolean;
  children: MenuItemInput[];
}

const MAX_MENU_DEPTH = 4;

function menuItemSchemaAtDepth(depth: number): z.ZodType<MenuItemInput> {
  return z
    .object({
      id: z.string().trim().min(1).max(100),
      label: z.string().trim().min(1).max(150),
      linkType: menuLinkTypeSchema,
      targetId: z.string().trim().uuid().optional(),
      url: z.string().trim().max(2000).optional(),
      openInNewTab: z.boolean().default(false),
      children: depth >= MAX_MENU_DEPTH ? z.array(z.never()).default([]) : z.lazy(() => menuItemSchemaAtDepth(depth + 1).array()).default([]),
    })
    .refine((item) => (item.linkType === "custom" ? !!item.url : !!item.targetId), {
      message: "A custom link needs a url; any other link type needs a targetId.",
    }) as unknown as z.ZodType<MenuItemInput>;
}

export const menuItemSchema = menuItemSchemaAtDepth(0);
export const menuItemsSchema = z.array(menuItemSchema).default([]);

export const listNavigationMenusQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().trim().max(200).optional(),
  status: navigationMenuWorkflowStatusSchema.optional(),
  type: navigationMenuTypeSchema.optional(),
  sort: z.enum(SORT_FIELDS).default("updatedAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
});
export type ListNavigationMenusQuery = z.infer<typeof listNavigationMenusQuerySchema>;

export const createNavigationMenuSchema = z.object({
  type: navigationMenuTypeSchema,
  name: z.string().trim().min(1).max(150),
  slug: slugSchema.optional(),
  items: menuItemsSchema,
});
export type CreateNavigationMenuInput = z.infer<typeof createNavigationMenuSchema>;

export const updateNavigationMenuSchema = z
  .object({
    name: z.string().trim().min(1).max(150).optional(),
    slug: slugSchema.optional(),
    items: menuItemsSchema.optional(),
    expectedUpdatedAt: expectedUpdatedAtSchema,
  })
  .refine((v) => Object.keys(v).filter((k) => k !== "expectedUpdatedAt").length > 0, { message: "At least one field must be provided." });
export type UpdateNavigationMenuInput = z.infer<typeof updateNavigationMenuSchema>;

export const duplicateNavigationMenuSchema = z.object({
  name: z.string().trim().min(1).max(150).optional(),
});
export type DuplicateNavigationMenuInput = z.infer<typeof duplicateNavigationMenuSchema>;

export const revertNavigationMenuSchema = z.object({
  revisionId: z.string().trim().uuid(),
});
export type RevertNavigationMenuInput = z.infer<typeof revertNavigationMenuSchema>;
