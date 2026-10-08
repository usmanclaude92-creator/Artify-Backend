/**
 * Landing page block contract (Step 12, docs/MARKETING_LANDING_PAGES.md).
 *
 * A landing page is a CMS `Page` whose revision `editorBlocks` holds a document of the restricted `lp_*` blocks below, and
 * ONLY those: a closed, typed vocabulary instead of free HTML. Every text field is plain text with a length cap (rendered
 * escaped on the public site, never as markup); images are Media-library ids with mandatory alt text; links are validated
 * (https, site-relative, #anchor, mailto, tel). Nothing here can carry a script, an inline style, an iframe or raw HTML.
 */
import { z } from "zod";

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const plain = (max: number, min = 0) =>
  z.string().trim().min(min).max(max).refine((v) => !CONTROL_CHARS.test(v), "Control characters are not allowed.");

/** https://… , /relative/path , #anchor , mailto:… , tel:… — nothing else (no javascript:, data:, //host, http:). */
export function isSafeHref(raw: string): boolean {
  const v = raw.trim();
  if (!v || v.length > 2000 || CONTROL_CHARS.test(v) || /\s/.test(v)) return false;
  if (v.startsWith("#")) return v.length > 1;
  if (v.startsWith("/")) return !v.startsWith("//") && !v.includes("\\");
  if (/^mailto:[^\s@]+@[^\s@]+$/i.test(v)) return true;
  if (/^tel:\+?[0-9()\-.\s]{3,30}$/i.test(v)) return true;
  try {
    const u = new URL(v);
    return u.protocol === "https:" && !!u.hostname;
  } catch {
    return false;
  }
}
const href = z.string().trim().min(1).max(2000).refine(isSafeHref, "Use an https:// link, a /site path, #anchor, mailto: or tel:.");

const idSchema = z.string().trim().min(1).max(60).regex(/^[A-Za-z0-9_-]+$/, "Block ids use letters, numbers, - and _.");
const base = { id: idSchema, placeholder: z.boolean().optional() };

const cta = z.object({ label: plain(40, 1), href });
/** Image from the Media library. Alt text is REQUIRED (empty is rejected): decorative images are not offered in these blocks. */
const imageRef = z.object({ mediaId: z.string().trim().uuid(), alt: plain(200, 1) });

const hero = z.object({
  ...base,
  type: z.literal("lp_hero"),
  props: z.object({ eyebrow: plain(60).optional(), headline: plain(120, 1), subheadline: plain(300).optional(), primaryCta: cta, secondaryCta: cta.optional(), image: imageRef.optional() }),
});
const benefits = z.object({
  ...base,
  type: z.literal("lp_benefits"),
  props: z.object({ heading: plain(120, 1), items: z.array(z.object({ title: plain(80, 1), text: plain(240, 1) })).min(2).max(6) }),
});
const features = z.object({
  ...base,
  type: z.literal("lp_features"),
  props: z.object({ heading: plain(120, 1), intro: plain(300).optional(), items: z.array(z.object({ title: plain(80, 1), text: plain(300, 1), image: imageRef.optional() })).min(1).max(8) }),
});
const testimonials = z.object({
  ...base,
  type: z.literal("lp_testimonials"),
  props: z.object({
    heading: plain(120, 1),
    items: z.array(z.object({ quote: plain(500, 1), authorName: plain(80, 1), authorRole: plain(80).optional(), company: plain(80).optional(), avatar: imageRef.optional() })).min(1).max(6),
    /** Publishing requires an explicit attestation that every quote is real, permitted, and attributed correctly. */
    confirmedReal: z.boolean().default(false),
  }),
});
const pricing = z.object({
  ...base,
  type: z.literal("lp_pricing"),
  props: z.object({
    heading: plain(120, 1),
    intro: plain(300).optional(),
    plans: z.array(z.object({ name: plain(60, 1), price: plain(40, 1), period: plain(30).optional(), description: plain(160).optional(), features: z.array(plain(100, 1)).max(10).default([]), cta, highlighted: z.boolean().optional() })).min(1).max(4),
    footnote: plain(200).optional(),
  }),
});
const faq = z.object({
  ...base,
  type: z.literal("lp_faq"),
  props: z.object({ heading: plain(120, 1), items: z.array(z.object({ question: plain(200, 1), answer: plain(1000, 1) })).min(1).max(12) }),
});
const ctaBlock = z.object({
  ...base,
  type: z.literal("lp_cta"),
  props: z.object({ heading: plain(120, 1), text: plain(300).optional(), cta }),
});

export const RESERVED_FORM_KEYS = ["website", "consent", "utm", "touch"] as const;
const formField = z.object({
  key: z.string().trim().regex(/^[a-z][a-z0-9_]{0,29}$/, "Field keys are lowercase letters, numbers and _ (start with a letter)."),
  label: plain(60, 1),
  type: z.enum(["text", "email", "tel", "textarea", "select"]),
  required: z.boolean().default(false),
  options: z.array(z.object({ value: plain(60, 1), label: plain(60, 1) })).max(12).optional(),
});
export type LandingFormField = z.infer<typeof formField>;
const leadForm = z.object({
  ...base,
  type: z.literal("lp_form"),
  props: z.object({
    heading: plain(120, 1),
    intro: plain(300).optional(),
    fields: z.array(formField).min(1).max(8),
    consent: z.object({ enabled: z.boolean().default(false), text: plain(300).default(""), privacyUrl: z.string().trim().max(2000).default("") }).default({ enabled: false, text: "", privacyUrl: "" }),
    submitLabel: plain(40, 1).default("Send"),
    successMessage: plain(300, 1),
    /** Optional: send the visitor to this page after a successful submit instead of showing the message. */
    redirectUrl: href.optional(),
  }),
});
const footer = z.object({
  ...base,
  type: z.literal("lp_footer"),
  props: z.object({ text: plain(300).optional(), links: z.array(z.object({ label: plain(40, 1), href })).max(6).default([]), copyright: plain(100).optional() }),
});

export const LANDING_BLOCK_TYPES = ["lp_hero", "lp_benefits", "lp_features", "lp_testimonials", "lp_pricing", "lp_faq", "lp_cta", "lp_form", "lp_footer"] as const;
export type LandingBlockType = (typeof LANDING_BLOCK_TYPES)[number];

export const landingBlockSchema = z.discriminatedUnion("type", [hero, benefits, features, testimonials, pricing, faq, ctaBlock, leadForm, footer]);
export type LandingBlock = z.infer<typeof landingBlockSchema>;

/** Structural rules of the whole page: one hero (first), at most one form, footer (if any) last, unique ids, bounded size. */
export const landingDocumentSchema = z
  .object({ version: z.literal(1).default(1), blocks: z.array(landingBlockSchema).max(20) })
  .superRefine((doc, ctx) => {
    const ids = new Set<string>();
    doc.blocks.forEach((b, i) => {
      if (ids.has(b.id)) ctx.addIssue({ code: "custom", path: ["blocks", i, "id"], message: `Duplicate block id "${b.id}".` });
      ids.add(b.id);
    });
    const count = (t: LandingBlockType) => doc.blocks.filter((b) => b.type === t).length;
    if (doc.blocks.length > 0) {
      if (count("lp_hero") !== 1) ctx.addIssue({ code: "custom", path: ["blocks"], message: "A landing page needs exactly one hero block (it carries the page's single H1)." });
      else if (doc.blocks[0]!.type !== "lp_hero") ctx.addIssue({ code: "custom", path: ["blocks"], message: "The hero block must be first." });
      if (count("lp_form") > 1) ctx.addIssue({ code: "custom", path: ["blocks"], message: "Only one lead form per page." });
      if (count("lp_footer") > 1) ctx.addIssue({ code: "custom", path: ["blocks"], message: "Only one footer per page." });
      const footerAt = doc.blocks.findIndex((b) => b.type === "lp_footer");
      if (footerAt !== -1 && footerAt !== doc.blocks.length - 1) ctx.addIssue({ code: "custom", path: ["blocks", footerAt], message: "The footer must be the last block." });
    }
    doc.blocks.forEach((b, i) => {
      if (b.type !== "lp_form") return;
      const keys = new Set<string>();
      b.props.fields.forEach((f, j) => {
        if ((RESERVED_FORM_KEYS as readonly string[]).includes(f.key)) ctx.addIssue({ code: "custom", path: ["blocks", i, "props", "fields", j, "key"], message: `"${f.key}" is reserved.` });
        if (keys.has(f.key)) ctx.addIssue({ code: "custom", path: ["blocks", i, "props", "fields", j, "key"], message: `Duplicate field key "${f.key}".` });
        keys.add(f.key);
        if (f.type === "select" && !(f.options && f.options.length >= 2)) ctx.addIssue({ code: "custom", path: ["blocks", i, "props", "fields", j, "options"], message: "A select field needs at least two options." });
        if (f.key === "email" && f.type !== "email") ctx.addIssue({ code: "custom", path: ["blocks", i, "props", "fields", j, "type"], message: 'The "email" field must have type email.' });
        if (f.key === "phone" && f.type !== "tel") ctx.addIssue({ code: "custom", path: ["blocks", i, "props", "fields", j, "type"], message: 'The "phone" field must have type tel.' });
      });
      if (!keys.has("email") && !keys.has("phone")) ctx.addIssue({ code: "custom", path: ["blocks", i, "props", "fields"], message: "The form needs an email or a phone field so the lead can be contacted." });
      const consent = b.props.consent;
      if (consent.enabled) {
        if (consent.text.trim().length < 10) ctx.addIssue({ code: "custom", path: ["blocks", i, "props", "consent", "text"], message: "Consent text is required (at least 10 characters) when the consent checkbox is on." });
        if (!isSafeHref(consent.privacyUrl) || /^(mailto|tel):|^#/i.test(consent.privacyUrl.trim())) ctx.addIssue({ code: "custom", path: ["blocks", i, "props", "consent", "privacyUrl"], message: "A privacy policy link (https:// or /path) is required when the consent checkbox is on." });
      }
    });
  });
export type LandingDocument = z.infer<typeof landingDocumentSchema>;

// ---------------------------------------------------------------------------------------------
// Page-level inputs
// ---------------------------------------------------------------------------------------------
export const LANDING_TEMPLATE_KEYS = ["lead-gen", "product-launch", "consultation"] as const;
export type LandingTemplateKey = (typeof LANDING_TEMPLATE_KEYS)[number];

export const landingSlugSchema = z
  .string()
  .trim()
  .min(3, "Slugs have at least 3 characters.")
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers and single hyphens (no leading, trailing or double hyphens).");

export const landingSeoSchema = z.object({
  metaTitle: plain(70).optional(),
  metaDescription: plain(320).optional(),
  ogImageMediaId: z.string().trim().uuid().nullable().optional(),
  noindex: z.boolean().optional(),
});
export type LandingSeoInput = z.infer<typeof landingSeoSchema>;

export const createLandingSchema = z.object({ title: plain(200, 1), slug: landingSlugSchema.optional(), templateKey: z.enum(LANDING_TEMPLATE_KEYS) });
export const updateLandingSchema = z
  .object({
    title: plain(200, 1).optional(),
    slug: landingSlugSchema.optional(),
    document: landingDocumentSchema.optional(),
    seo: landingSeoSchema.optional(),
    expectedUpdatedAt: z.coerce.date().optional(),
  })
  .refine((v) => Object.keys(v).some((k) => k !== "expectedUpdatedAt" && v[k as keyof typeof v] !== undefined), { message: "Nothing to update." });
export const restoreLandingSchema = z.object({ revisionId: z.string().trim().uuid() });
export const previewTokenSchema = z.object({ ttlHours: z.coerce.number().int().min(1).max(72).default(24) });
export const listLandingQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(25),
  search: z.string().trim().max(100).optional(),
  status: z.enum(["DRAFT", "IN_REVIEW", "PUBLISHED", "UNPUBLISHED", "ARCHIVED"]).optional(),
});
export const landingStatsQuerySchema = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) });
export const utmLinkQuerySchema = z.object({
  source: z.string().trim().min(1).max(60).regex(/^[A-Za-z0-9._~-]+$/, "Letters, numbers and . _ ~ - only."),
  medium: z.string().trim().min(1).max(60).regex(/^[A-Za-z0-9._~-]+$/, "Letters, numbers and . _ ~ - only."),
  campaign: z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9._~-]+$/, "Letters, numbers and . _ ~ - only."),
  term: z.string().trim().max(60).regex(/^[A-Za-z0-9._~-]*$/).optional(),
  content: z.string().trim().max(60).regex(/^[A-Za-z0-9._~-]*$/).optional(),
});

// ---------------------------------------------------------------------------------------------
// Public submit
// ---------------------------------------------------------------------------------------------
const touch = z
  .object({
    utmSource: z.string().trim().max(200).optional(),
    utmMedium: z.string().trim().max(200).optional(),
    utmCampaign: z.string().trim().max(200).optional(),
    utmTerm: z.string().trim().max(200).optional(),
    utmContent: z.string().trim().max(200).optional(),
    referrer: z.string().trim().max(2000).optional(),
    landingPath: z.string().trim().max(500).optional(),
    at: z.string().trim().max(40).optional(),
  })
  .strict();
export type LandingTouch = z.infer<typeof touch>;
export const publicLandingSubmitSchema = z.object({
  data: z.record(z.union([z.string().max(5000), z.array(z.string().max(500)).max(20)])).default({}),
  /** Honeypot: a real visitor never sees or fills this field. */
  website: z.string().max(500).optional(),
  firstTouch: touch.optional(),
  lastTouch: touch.optional(),
});
export type PublicLandingSubmitInput = z.infer<typeof publicLandingSubmitSchema>;
