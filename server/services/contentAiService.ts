/**
 * AI writer for the Posts and Products editors. Built on the same governed path as social drafting (prompt catalog → AIExecution →
 * adapter → AIUsageRecord, daily org limits). It only RETURNS text for the editor form; nothing is saved or published here, so the normal
 * save, review and publish flow (and its HTML sanitising) still applies.
 */
import { z } from "zod";
import { prisma } from "../db/prisma";
import { run, brandVoiceText } from "./social/socialAiService";
import { socialPostService } from "./social/socialPostService";
import { CONTENT_PROMPTS } from "./contentAiPrompts";
import { sanitizeContentHtml } from "../utils/sanitizeHtml";
import type { SanitizedUser } from "../types/domain";
import type { RequestMeta } from "./authService";

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n).trimEnd() : s);
const list = (max: number, itemMax: number) => z.array(z.string().trim().min(1)).max(max).default([]).transform((a) => a.map((s) => clip(s, itemMax)));

const slugify = (input: string) => input.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 100);
const keywords = z.array(z.string().trim().min(1)).max(10).default([]).transform((a) => [...new Set(a.map((k) => clip(k.toLowerCase(), 60)))].slice(0, 6));
const seoFields = {
  seoTitle: z.string().trim().default("").transform((s) => clip(s, 60)),
  seoDescription: z.string().trim().default("").transform((s) => clip(s, 160)),
  focusKeywords: keywords,
  ogTitle: z.string().trim().default("").transform((s) => clip(s, 90)),
  ogDescription: z.string().trim().default("").transform((s) => clip(s, 200)),
};

const postSchema = z.object({
  title: z.string().trim().min(1).transform((s) => clip(s, 200)),
  slug: z.string().trim().default(""),
  excerpt: z.string().trim().default("").transform((s) => clip(s, 500)),
  bodyHtml: z.string().trim().min(1),
  ...seoFields,
});
const productSchema = z.object({
  name: z.string().trim().default("").transform((s) => clip(s, 100)),
  codePrefix: z.string().trim().default(""),
  slug: z.string().trim().default(""),
  shortDescription: z.string().trim().min(1).transform((s) => clip(s, 300)),
  description: z.string().trim().default(""),
  benefits: list(8, 160),
  features: list(10, 160),
  businessProblem: z.string().trim().default("").transform((s) => clip(s, 500)),
  ...seoFields,
});

/** Product slugs are unique across the platform; `excludeId` lets an edited product keep its own slug. */
export async function uniqueProductSlug(base: string, excludeId?: string): Promise<string> {
  const root = slugify(base) || "product";
  for (let n = 1; n <= 50; n++) {
    const slug = n === 1 ? root : `${root}-${n}`;
    const hit = await prisma.product.findUnique({ where: { slug }, select: { id: true } });
    if (!hit || hit.id === excludeId) return slug;
  }
  return `${root}-${Date.now().toString(36)}`;
}

/** Post slugs are unique per organization. */
export async function uniquePostSlug(organizationId: string, base: string, excludeId?: string): Promise<string> {
  const root = slugify(base) || "post";
  for (let n = 1; n <= 50; n++) {
    const slug = n === 1 ? root : `${root}-${n}`;
    const hit = await prisma.post.findFirst({ where: { organizationId, slug }, select: { id: true } });
    if (!hit || hit.id === excludeId) return slug;
  }
  return `${root}-${Date.now().toString(36)}`;
}

/** Next free `PREFIX-NNN` product code. The prefix is the AI's abbreviation, cleaned to A-Z/0-9; falls back to the first letters of the name. */
export async function nextProductCode(prefixHint: string, name: string): Promise<string> {
  let prefix = prefixHint.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5);
  if (prefix.length < 2) prefix = (name.toUpperCase().match(/[A-Z0-9]+/g) ?? ["PRD"]).map((w) => w[0]).join("").slice(0, 5).padEnd(2, "X");
  const existing = await prisma.product.findMany({ where: { code: { startsWith: `${prefix}-` } }, select: { code: true } });
  const used = existing.map((p) => Number(p.code.slice(prefix.length + 1))).filter((n) => Number.isInteger(n));
  const next = (used.length ? Math.max(...used) : 0) + 1;
  return `${prefix}-${String(next).padStart(3, "0")}`;
}

export const LENGTHS = { short: 400, medium: 800, long: 1400 } as const;
export const TONES = ["professional", "friendly", "persuasive", "technical"] as const;

export interface WritePostInput { brief: string; tone?: (typeof TONES)[number]; length?: keyof typeof LENGTHS; language?: string; currentTitle?: string; postId?: string }
export interface WriteProductInput { brief: string; name?: string; itemType?: "PRODUCT" | "SERVICE" | "SOLUTION"; tone?: (typeof TONES)[number]; language?: string; productId?: string }

export const contentAiService = {
  async writePost(caller: SanitizedUser, input: WritePostInput, meta: RequestMeta = {}) {
    const voice = await socialPostService.getBrandVoice(caller.organizationId);
    const length = input.length ?? "medium";
    const { result, executionId } = await run({
      caller, def: CONTENT_PROMPTS.post, toolCode: "social_cms_post", meta, schema: postSchema as z.ZodType<z.infer<typeof postSchema>>,
      inputSummary: { kind: "post", brief: input.brief.slice(0, 500), tone: input.tone ?? "professional", length },
      outputSummary: (r) => ({ title: r.title, words: r.bodyHtml.split(/\s+/).length }),
      variables: { brandVoice: brandVoiceText(voice), language: input.language?.trim() || voice.languages[0] || "en", tone: input.tone ?? "professional", length: LENGTHS[length], brief: input.brief, currentTitle: input.currentTitle ?? "" },
    });
    const slug = await uniquePostSlug(caller.organizationId, result.slug || result.title, input.postId);
    return { ...result, slug, bodyHtml: sanitizeContentHtml(result.bodyHtml), executionId };
  },

  async writeProduct(caller: SanitizedUser, input: WriteProductInput, meta: RequestMeta = {}) {
    const voice = await socialPostService.getBrandVoice(caller.organizationId);
    const { result, executionId } = await run({
      caller, def: CONTENT_PROMPTS.product, toolCode: "social_cms_product", meta, schema: productSchema as z.ZodType<z.infer<typeof productSchema>>,
      inputSummary: { kind: "product", brief: input.brief.slice(0, 500), itemType: input.itemType ?? "PRODUCT", tone: input.tone ?? "professional" },
      outputSummary: (r) => ({ shortDescription: r.shortDescription, benefits: r.benefits.length, features: r.features.length }),
      variables: { brandVoice: brandVoiceText(voice), language: input.language?.trim() || voice.languages[0] || "en", tone: input.tone ?? "professional", itemType: (input.itemType ?? "PRODUCT").toLowerCase(), name: input.name ?? "", brief: input.brief },
    });
    const name = result.name || input.name || "";
    const slug = await uniqueProductSlug(result.slug || name, input.productId);
    // An existing product keeps its code (it cannot be changed after creation); a new one gets the next free PREFIX-NNN.
    const code = input.productId ? null : await nextProductCode(result.codePrefix, name);
    const { codePrefix: _prefix, ...rest } = result;
    return { ...rest, name, slug, code, executionId };
  },
};
