import { z } from "zod";

export const formFieldTypeSchema = z.enum(["text", "email", "tel", "textarea"]);

export const formFieldSchema = z.object({
  key: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .regex(/^[a-z][a-z0-9_]*$/, "key must start with a lowercase letter and contain only lowercase letters, digits, and underscores"),
  label: z.string().trim().min(1).max(100),
  type: formFieldTypeSchema.default("text"),
  required: z.boolean().default(false),
});
export type FormField = z.infer<typeof formFieldSchema>;

/**
 * At least one of "name"/"email" must be present — a submission needs
 * *some* identity to become a Lead (formService.createForm reuses the
 * existing Lead-intake pattern, same as publicFormService.submit), and
 * Lead.companyName is a required, non-null column with no sane universal
 * fallback otherwise.
 */
export const formFieldsSchema = z
  .array(formFieldSchema)
  .min(1, "A form needs at least one field.")
  .max(20, "A form may define at most 20 fields.")
  .refine((fields) => new Set(fields.map((f) => f.key)).size === fields.length, { message: "Field keys must be unique." })
  .refine((fields) => fields.some((f) => f.key === "name" || f.key === "email"), {
    message: 'At least one field must use key "name" or "email" so a submission has an identity to attach to a CRM Lead.',
  });

export const listFormsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().trim().max(200).optional(),
  status: z.enum(["ACTIVE", "ARCHIVED"]).optional(),
  sort: z.enum(["createdAt", "updatedAt", "name"]).default("createdAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
});
export type ListFormsQuery = z.infer<typeof listFormsQuerySchema>;

const slugSchema = z
  .string()
  .trim()
  .min(1)
  .max(150)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "slug must be lowercase, alphanumeric, and hyphen-separated");

export const createFormSchema = z.object({
  name: z.string().trim().min(1).max(200),
  slug: slugSchema.optional(),
  fields: formFieldsSchema,
  successMessage: z.string().trim().max(500).optional(),
});
export type CreateFormInput = z.infer<typeof createFormSchema>;

export const updateFormSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    slug: slugSchema.optional(),
    fields: formFieldsSchema.optional(),
    successMessage: z.string().trim().max(500).nullable().optional(),
    status: z.enum(["ACTIVE", "ARCHIVED"]).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "At least one field must be provided." });
export type UpdateFormInput = z.infer<typeof updateFormSchema>;

export const listFormSubmissionsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});
export type ListFormSubmissionsQuery = z.infer<typeof listFormSubmissionsQuerySchema>;

/**
 * The public submission envelope. `data`'s per-field shape depends on the
 * target Form's own `fields` definition (loaded from the DB, not knowable
 * statically here) — publicFormService validates required-field presence
 * and length against that definition; this schema only bounds the overall
 * shape against abuse (a caller can't send an arbitrarily huge or deep
 * payload no matter what fields the form defines).
 */
export const publicFormSubmitSchema = z.object({
  data: z.record(z.string().trim().max(2000)).refine((obj) => Object.keys(obj).length <= 30, { message: "Too many fields submitted." }),
  utmSource: z.string().trim().max(200).optional(),
  utmMedium: z.string().trim().max(200).optional(),
  utmCampaign: z.string().trim().max(200).optional(),
  utmTerm: z.string().trim().max(200).optional(),
  utmContent: z.string().trim().max(200).optional(),
  /** Honeypot — must stay empty; never render this field visibly to a real visitor (mirrors createPublicLeadSchema's `website`). */
  website: z.string().trim().max(200).optional(),
});
export type PublicFormSubmitInput = z.infer<typeof publicFormSubmitSchema>;
