import { z } from "zod";

/**
 * Phase 6's fixed 7-step checklist — still the system default, and still
 * the exact set of keys that workspaceService/invitationService complete
 * automatically as real provisioning milestones happen
 * (completeStepForClient). An organization's custom template (Phase 13,
 * below) can include, omit, or reorder these freely: completeStepForClient
 * already no-ops when a key isn't present in a given onboarding's
 * checklist, so a custom template that drops e.g. ADMINISTRATOR_INVITED
 * simply never gets that automatic tick — never an error.
 */
export const ONBOARDING_CHECKLIST_KEYS = [
  "CLIENT_VERIFIED",
  "WORKSPACE_CREATED",
  "PRIMARY_CONTACT_CONFIRMED",
  "ADMINISTRATOR_INVITED",
  "ADMINISTRATOR_ACCEPTED",
  "WORKSPACE_CONFIGURED",
  "ONBOARDING_COMPLETED",
] as const;
export type OnboardingStepKey = (typeof ONBOARDING_CHECKLIST_KEYS)[number];

/** Optional owner/dueDate assignment at the moment onboarding starts — both can also be set later via PATCH /onboarding/:id. */
export const startOnboardingSchema = z.object({
  ownerId: z.string().trim().uuid().optional(),
  dueDate: z.coerce.date().optional(),
});
export type StartOnboardingInput = z.infer<typeof startOnboardingSchema>;

export const listOnboardingQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  status: z.enum(["NOT_STARTED", "IN_PROGRESS", "READY", "COMPLETED", "CANCELLED"]).optional(),
  search: z.string().trim().max(200).optional(),
  ownerId: z.string().trim().uuid().optional(),
  overdue: z.coerce.boolean().optional(),
});
export type ListOnboardingQuery = z.infer<typeof listOnboardingQuerySchema>;

// Phase 13 — a step key is now whatever the organization's own template
// (or the system default) names it, so this is a free-text slug rather
// than the fixed enum — the service layer validates it exists on the
// record's own checklist, the same place that already rejects an unknown
// key with a 400 (onboardingService.completeStep).
const stepKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_]+$/, "step key may only contain letters, numbers, and underscores");

export const updateOnboardingSchema = z
  .object({
    completeStep: stepKeySchema.optional(),
    status: z.enum(["CANCELLED"]).optional(),
    ownerId: z.string().trim().uuid().nullable().optional(),
    dueDate: z.coerce.date().nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "At least one field must be provided." });
export type UpdateOnboardingInput = z.infer<typeof updateOnboardingSchema>;

/** Phase 13 — per-step detail edits (owner/due date/notes), separate from completing the step itself. */
export const updateOnboardingStepSchema = z
  .object({
    dueDate: z.coerce.date().nullable().optional(),
    assignedTo: z.string().trim().uuid().nullable().optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
    documentMediaId: z.string().trim().uuid().nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "At least one field must be provided." });
export type UpdateOnboardingStepInput = z.infer<typeof updateOnboardingStepSchema>;

/** Phase 13 — an organization's configurable onboarding checklist template, stored via the existing SystemSetting key/value store (no new table). */
export const onboardingTemplateStepSchema = z.object({
  key: stepKeySchema,
  label: z.string().trim().min(1).max(200),
  requiresDocument: z.boolean().default(false),
});
export type OnboardingTemplateStep = z.infer<typeof onboardingTemplateStepSchema>;

export const onboardingTemplateSchema = z
  .array(onboardingTemplateStepSchema)
  .min(1, "A template must have at least one step.")
  .max(50)
  .refine((steps) => new Set(steps.map((s) => s.key)).size === steps.length, { message: "Step keys must be unique." });
export type OnboardingTemplateInput = z.infer<typeof onboardingTemplateSchema>;
