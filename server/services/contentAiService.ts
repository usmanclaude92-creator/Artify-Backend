/**
 * AI writer for the Posts and Products editors. Built on the same governed path as social drafting (prompt catalog → AIExecution →
 * adapter → AIUsageRecord, daily org limits). It only RETURNS text for the editor form; nothing is saved or published here, so the normal
 * save, review and publish flow (and its HTML sanitising) still applies.
 */
import { z } from "zod";
import { run, brandVoiceText } from "./social/socialAiService";
import { socialPostService } from "./social/socialPostService";
import { CONTENT_PROMPTS } from "./contentAiPrompts";
import { sanitizeContentHtml } from "../utils/sanitizeHtml";
import type { SanitizedUser } from "../types/domain";
import type { RequestMeta } from "./authService";

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n).trimEnd() : s);
const list = (max: number, itemMax: number) => z.array(z.string().trim().min(1)).max(max).default([]).transform((a) => a.map((s) => clip(s, itemMax)));

const postSchema = z.object({
  title: z.string().trim().min(1).transform((s) => clip(s, 200)),
  excerpt: z.string().trim().default("").transform((s) => clip(s, 500)),
  bodyHtml: z.string().trim().min(1),
  seoTitle: z.string().trim().default("").transform((s) => clip(s, 70)),
  seoDescription: z.string().trim().default("").transform((s) => clip(s, 160)),
});
const productSchema = z.object({
  shortDescription: z.string().trim().min(1).transform((s) => clip(s, 300)),
  description: z.string().trim().default(""),
  benefits: list(8, 160),
  features: list(10, 160),
  businessProblem: z.string().trim().default("").transform((s) => clip(s, 500)),
  seoTitle: z.string().trim().default("").transform((s) => clip(s, 70)),
  seoDescription: z.string().trim().default("").transform((s) => clip(s, 160)),
});

export const LENGTHS = { short: 400, medium: 800, long: 1400 } as const;
export const TONES = ["professional", "friendly", "persuasive", "technical"] as const;

export interface WritePostInput { brief: string; tone?: (typeof TONES)[number]; length?: keyof typeof LENGTHS; language?: string; currentTitle?: string }
export interface WriteProductInput { brief: string; name?: string; itemType?: "PRODUCT" | "SERVICE" | "SOLUTION"; tone?: (typeof TONES)[number]; language?: string }

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
    return { ...result, bodyHtml: sanitizeContentHtml(result.bodyHtml), executionId };
  },

  async writeProduct(caller: SanitizedUser, input: WriteProductInput, meta: RequestMeta = {}) {
    const voice = await socialPostService.getBrandVoice(caller.organizationId);
    const { result, executionId } = await run({
      caller, def: CONTENT_PROMPTS.product, toolCode: "social_cms_product", meta, schema: productSchema as z.ZodType<z.infer<typeof productSchema>>,
      inputSummary: { kind: "product", brief: input.brief.slice(0, 500), itemType: input.itemType ?? "PRODUCT", tone: input.tone ?? "professional" },
      outputSummary: (r) => ({ shortDescription: r.shortDescription, benefits: r.benefits.length, features: r.features.length }),
      variables: { brandVoice: brandVoiceText(voice), language: input.language?.trim() || voice.languages[0] || "en", tone: input.tone ?? "professional", itemType: (input.itemType ?? "PRODUCT").toLowerCase(), name: input.name ?? "", brief: input.brief },
    });
    return { ...result, executionId };
  },
};
