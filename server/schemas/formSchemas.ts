import { z } from "zod";

/**
 * Phase 9 (Forms + Landing Pages + Conversion) — expands the MVP slice's
 * text/email/tel/textarea set to the full field-type list the roadmap
 * asks for. "file" is deliberately NOT included: every other write path
 * in this codebase requires an authenticated caller (mediaService.ts's
 * upload session flow), and there is no safe anonymous-upload endpoint to
 * build this on without a real security review of its own (unrestricted
 * file type/size, storage-cost abuse, malware hosting) — "File upload
 * where supported" is honestly "not supported" here rather than a
 * half-built, insecure corner.
 */
export const formFieldTypeSchema = z.enum([
  "text",
  "email",
  "tel",
  "number",
  "select",
  "multiselect",
  "checkbox",
  "radio",
  "date",
  "textarea",
  "hidden",
]);
const OPTION_TYPES = new Set(["select", "multiselect", "radio"]);

export const formFieldOptionSchema = z.object({
  value: z.string().trim().min(1).max(100),
  label: z.string().trim().min(1).max(150),
});

export const formFieldSchema = z
  .object({
    key: z
      .string()
      .trim()
      .min(1)
      .max(40)
      .regex(/^[a-z][a-z0-9_]*$/, "key must start with a lowercase letter and contain only lowercase letters, digits, and underscores"),
    label: z.string().trim().min(1).max(100),
    type: formFieldTypeSchema.default("text"),
    required: z.boolean().default(false),
    placeholder: z.string().trim().max(150).optional(),
    /** select/multiselect/radio only — validated below (OPTION_TYPES). */
    options: z.array(formFieldOptionSchema).max(50).optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    /**
     * Conditional visibility — the simplest practical rule the roadmap
     * asks for: show this field only when another field (by key) equals
     * a given value. Evaluated client-side for UX and re-checked
     * server-side (publicFormService) so a hidden-but-still-submitted
     * value can never bypass required-field validation by hiding it.
     */
    visibleWhen: z.object({ fieldKey: z.string().trim().min(1).max(40), equals: z.string().trim().max(2000) }).optional(),
  })
  .refine((f) => !OPTION_TYPES.has(f.type) || (f.options && f.options.length > 0), {
    message: "select/multiselect/radio fields need at least one option.",
    path: ["options"],
  });
export type FormField = z.infer<typeof formFieldSchema>;
export type FormFieldOption = z.infer<typeof formFieldOptionSchema>;

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
  })
  .refine((fields) => fields.every((f) => !f.visibleWhen || fields.some((other) => other.key === f.visibleWhen!.fieldKey)), {
    message: "A field's conditional visibility must reference another real field on the same form.",
  });

/** Users (within the form's own organization, checked by formService) to notify in-app on a real submission. */
export const notifyUserIdsSchema = z.array(z.string().trim().uuid()).max(20).default([]);

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
  notifyUserIds: notifyUserIdsSchema.optional(),
});
export type CreateFormInput = z.infer<typeof createFormSchema>;

export const updateFormSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    slug: slugSchema.optional(),
    fields: formFieldsSchema.optional(),
    successMessage: z.string().trim().max(500).nullable().optional(),
    status: z.enum(["ACTIVE", "ARCHIVED"]).optional(),
    notifyUserIds: notifyUserIdsSchema.optional(),
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
// A submitted value is a plain string for every field type except
// multiselect, which needs several — bounded the same as a single value
// so a multiselect can't be abused into an arbitrarily large payload.
const submittedValueSchema = z.union([z.string().trim().max(2000), z.array(z.string().trim().max(2000)).max(50)]);

export const publicFormSubmitSchema = z.object({
  data: z.record(submittedValueSchema).refine((obj) => Object.keys(obj).length <= 30, { message: "Too many fields submitted." }),
  utmSource: z.string().trim().max(200).optional(),
  utmMedium: z.string().trim().max(200).optional(),
  utmCampaign: z.string().trim().max(200).optional(),
  utmTerm: z.string().trim().max(200).optional(),
  utmContent: z.string().trim().max(200).optional(),
  /** Site-relative path the visitor submitted from, e.g. /landing/spring-sale — for attribution only, never trusted as an identity/auth signal. */
  landingPagePath: z.string().trim().max(500).optional(),
  /** Honeypot — must stay empty; never render this field visibly to a real visitor (mirrors createPublicLeadSchema's `website`). */
  website: z.string().trim().max(200).optional(),
});
export type PublicFormSubmitInput = z.infer<typeof publicFormSubmitSchema>;
