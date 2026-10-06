import { z } from "zod";

export const POST_STATUSES = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "SCHEDULED", "PUBLISHING", "PUBLISHED", "FAILED", "REJECTED", "CANCELLED"] as const;

const timezone = z.string().max(64).refine((tz) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}, "Unknown timezone.");

const id = z.string().min(1).max(64);

export const sourceContentSchema = z.object({ type: z.enum(["post", "case_study"]), id });

export const createSocialPostSchema = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().max(10000).default(""),
  mediaIds: z.array(id).max(10).default([]),
  linkUrl: z.string().trim().max(2000).nullable().optional(),
  scheduledAt: z.coerce.date().nullable().optional(),
  timezone: timezone.default("UTC"),
  accountIds: z.array(id).max(20).default([]),
  /** Per-account text overrides keyed by social account id. */
  bodyOverrides: z.record(z.string().max(10000)).default({}),
  sourceContent: sourceContentSchema.optional(),
});
export type CreateSocialPostInput = z.infer<typeof createSocialPostSchema>;

export const updateSocialPostSchema = createSocialPostSchema.partial().refine((v) => Object.keys(v).length > 0, { message: "Nothing to update." });
export type UpdateSocialPostInput = z.infer<typeof updateSocialPostSchema>;

export const listSocialPostsQuerySchema = z.object({
  status: z.enum(POST_STATUSES).optional(),
  accountId: id.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  search: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const calendarQuerySchema = z
  .object({
    from: z.coerce.date(),
    to: z.coerce.date(),
    accountId: id.optional(),
    status: z.enum(POST_STATUSES).optional(),
  })
  .refine((v) => v.to > v.from && v.to.getTime() - v.from.getTime() <= 62 * 86400_000, { message: "Choose a date range of at most 62 days." });

export const scheduleSchema = z.object({ scheduledAt: z.coerce.date(), timezone: timezone.optional() });
export const commentSchema = z.object({ comment: z.string().trim().max(2000).optional() });
export const rejectSchema = z.object({ comment: z.string().trim().min(1, "A comment is required when rejecting.").max(2000) });
export const rescheduleSchema = z.object({ scheduledAt: z.coerce.date().nullable(), timezone: timezone.optional() });

export const brandVoiceSchema = z.object({
  toneDescriptors: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
  audience: z.string().trim().max(500).nullable().optional(),
  dos: z.array(z.string().trim().min(1).max(300)).max(30).default([]),
  donts: z.array(z.string().trim().min(1).max(300)).max(30).default([]),
  bannedWords: z.array(z.string().trim().min(1).max(80)).max(200).default([]),
  requiredDisclaimers: z.array(z.string().trim().min(1).max(500)).max(10).default([]),
  defaultHashtags: z.array(z.string().trim().regex(/^#?[\p{L}\p{N}_]{1,60}$/u, "Invalid hashtag.")).max(30).default([]),
  ctaPhrases: z.array(z.string().trim().min(1).max(200)).max(20).default([]),
  languages: z.array(z.string().trim().regex(/^[a-zA-Z]{2,3}(-[a-zA-Z]{2,4})?$/, "Use a language code like en or pt-BR.")).min(1).max(10).default(["en"]),
});
export type BrandVoiceInput = z.infer<typeof brandVoiceSchema>;

export const workspaceSettingsSchema = z.object({ approvalMode: z.enum(["ALWAYS_REQUIRE", "AUTO_IF_GUARDRAILS_PASS"]) });

export const aiDraftSchema = z.object({
  instruction: z.string().trim().min(3).max(2000),
  accountIds: z.array(id).min(1).max(20),
  sourceContent: sourceContentSchema.optional(),
  title: z.string().trim().max(200).optional(),
  language: z.string().trim().max(10).optional(),
});

export const aiPlanSchema = z
  .object({
    brief: z.string().trim().min(3).max(2000),
    accountIds: z.array(id).min(1).max(20),
    cadencePerWeek: z.number().int().min(1).max(14),
    startDate: z.coerce.date(),
    endDate: z.coerce.date(),
  })
  .refine((v) => v.endDate >= v.startDate && v.endDate.getTime() - v.startDate.getTime() <= 92 * 86400_000, { message: "Choose a date range of at most 92 days." });

export const aiRewriteSchema = z.object({
  action: z.enum(["rewrite", "shorten", "translate"]),
  instruction: z.string().trim().max(500).optional(),
  language: z.string().trim().max(40).optional(),
  accountId: id.optional(),
});

export const contentSourcesQuerySchema = z.object({ type: z.enum(["post", "case_study"]), search: z.string().trim().max(200).optional() });
