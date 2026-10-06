/**
 * AI drafting for social, built entirely on the existing AI module — no model provider is called directly:
 *  - prompts live in the AI prompt catalog (AIPromptTemplate/AIPromptVersion), registered per workspace on first use;
 *  - the model is reached through the AI adapter layer (AdapterFactory);
 *  - every call is an AIExecution with an AIUsageRecord (tokens + cost when the model has pricing metadata);
 *  - the org's daily AI limits apply (aiQuotaService), counting social usage as well.
 * AI output is ALWAYS saved as DRAFT and follows the normal approval rules; nothing here can publish.
 */
import { prisma } from "../../db/prisma";
import { z } from "zod";
import { InfrastructureError, ValidationError, ConflictError } from "../../core/errors";
import { logger } from "../../core/logger";
import { AdapterFactory } from "../../ai/adapters/adapterFactory";
import { aiPromptRepository } from "../../repositories/aiPromptRepository";
import { aiExecutionRepository } from "../../repositories/aiExecutionRepository";
import { aiUsageRepository } from "../../repositories/aiUsageRepository";
import { aiQuotaService } from "../aiQuotaService";
import { auditLogRepository } from "../../repositories/auditLogRepository";
import { connectorRegistry } from "./connectors/registry";
import { redactSecrets } from "./tokenVault";
import { SOCIAL_PROMPTS, fill, type SocialPromptDef } from "./socialAiPrompts";
import { socialPostService } from "./socialPostService";
import { CONTENT_EDITABLE } from "./postTransitions";
import type { SanitizedUser } from "../../types/domain";
import type { RequestMeta } from "../authService";

const FALLBACK_MODEL = "gemini-3.7-flash";
const MAX_PLAN_POSTS = 30;

/** Who an AI call is attributed to: a user, or `id: null` for system work (inbox triage from a webhook/cron). */
export type AiActor = { id: string | null; organizationId: string };

export async function ensureTemplate(caller: AiActor, def: SocialPromptDef) {
  let template = await aiPromptRepository.findByKeyInOrg(def.key, caller.organizationId);
  if (!template) {
    await aiPromptRepository.create(caller.organizationId, caller.id, { key: def.key, name: def.name, purpose: def.purpose, systemInstructions: def.systemInstructions, userTemplate: def.userTemplate });
    template = await aiPromptRepository.findByKeyInOrg(def.key, caller.organizationId);
    await prisma.aIPromptTemplate.update({ where: { id: template!.id }, data: { status: "ACTIVE" } });
    await auditLogRepository.record({ organizationId: caller.organizationId, actorUserId: caller.id ?? undefined, actorType: "SYSTEM", action: "AI_PROMPT_TEMPLATE_REGISTERED", resourceType: "ai_prompt_template", resourceId: template!.id, metadata: { key: def.key, source: "social" } });
  }
  const full = await prisma.aIPromptTemplate.findUnique({ where: { id: template!.id }, include: { currentVersion: true } });
  if (!full?.currentVersion) throw new InfrastructureError("The social prompt template has no current version.");
  return { template: full, version: full.currentVersion };
}

/** Daily AI limits (org-wide) also count social usage; copilot usage is read by the existing quota service. */
export async function assertQuota(organizationId: string): Promise<void> {
  await aiQuotaService.assertWithinLimits(organizationId);
  const limits = await aiQuotaService.getLimits(organizationId);
  if (!limits.dailyRequests && !limits.dailyTokens) return;
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const [copilot, social] = await Promise.all([
    aiQuotaService.usageToday(organizationId),
    prisma.aIUsageRecord.aggregate({ where: { organizationId, createdAt: { gte: start }, execution: { toolCode: { startsWith: "social_" } } }, _count: { _all: true }, _sum: { totalTokens: true } }),
  ]);
  const requests = copilot.requests + social._count._all;
  const tokens = copilot.tokens + (social._sum.totalTokens ?? 0);
  if ((limits.dailyRequests && requests >= limits.dailyRequests) || (limits.dailyTokens && tokens >= limits.dailyTokens)) {
    const { RateLimitError } = await import("../../core/errors");
    throw new RateLimitError("Daily AI usage limit reached for this organization.");
  }
}

export async function resolveModel() {
  const row = await prisma.aIModel.findFirst({ where: { isActive: true, isDefault: true, provider: { status: "ACTIVE" } }, include: { provider: true } });
  const providerType = row && ["GEMINI", "MOCK"].includes(row.provider.code.toUpperCase()) ? row.provider.code.toUpperCase() : "GEMINI";
  return { row, providerType, modelName: row?.modelId ?? FALLBACK_MODEL };
}

export function brandVoiceText(v: Awaited<ReturnType<typeof socialPostService.getBrandVoice>>): string {
  const parts = [
    v.toneDescriptors.length ? `Tone: ${v.toneDescriptors.join(", ")}` : "",
    v.audience ? `Audience: ${v.audience}` : "",
    v.dos.length ? `Do: ${v.dos.join("; ")}` : "",
    v.donts.length ? `Don't: ${v.donts.join("; ")}` : "",
    v.bannedWords.length ? `Never use these words: ${v.bannedWords.join(", ")}` : "",
    v.requiredDisclaimers.length ? `Always include these disclaimers verbatim: ${v.requiredDisclaimers.join(" | ")}` : "",
    v.defaultHashtags.length ? `Preferred hashtags: ${v.defaultHashtags.join(" ")}` : "",
    v.ctaPhrases.length ? `Call-to-action phrases to choose from: ${v.ctaPhrases.join(" | ")}` : "",
  ].filter(Boolean);
  return parts.length ? parts.join("\n") : "No brand voice has been configured: write clearly, professionally and without hype.";
}

export function parseJson<T>(text: string, schema: z.ZodType<T>): T {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  const start = cleaned.search(/[[{]/);
  const end = Math.max(cleaned.lastIndexOf("}"), cleaned.lastIndexOf("]"));
  try {
    return schema.parse(JSON.parse(start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned));
  } catch {
    throw new InfrastructureError("The AI response could not be understood. Please try again.");
  }
}

export interface RunParams<T> {
  caller: AiActor;
  def: SocialPromptDef;
  toolCode: string;
  variables: Record<string, string | number>;
  schema: z.ZodType<T>;
  meta: RequestMeta;
  inputSummary: Record<string, unknown>;
  /** What to keep in AIExecution.output (default: the whole result). Inbox passes a label-only view so message text is never stored there. */
  outputSummary?: (result: T) => unknown;
}

/** One governed model call: prompt from the catalog → execution row → adapter → usage record. */
export async function run<T>(p: RunParams<T>): Promise<{ result: T; executionId: string }> {
  const { caller, def } = p;
  await assertQuota(caller.organizationId);
  const { version } = await ensureTemplate(caller, def);
  const model = await resolveModel();
  const execution = await aiExecutionRepository.create({ organizationId: caller.organizationId, userId: caller.id, kind: "TOOL_CALL", toolCode: p.toolCode, requestId: p.meta.requestId, input: p.inputSummary });
  await prisma.aIExecution.update({ where: { id: execution.id }, data: { promptVersionId: version.id, providerId: model.row?.providerId ?? null, modelId: model.row?.id ?? null } });

  try {
    const adapter = AdapterFactory.getAdapter(model.providerType);
    const system = fill(version.systemInstructions, p.variables);
    const prompt = fill(version.userTemplate, p.variables);
    const response = await adapter.generateText({ modelName: model.modelName, prompt, systemInstruction: system, temperature: 0.7, maxTokens: 4096, responseMimeType: "application/json" });
    const result = parseJson(response.text, p.schema);

    const price = model.row;
    const cost = price?.inputPricePerMillionTokens != null && price.outputPricePerMillionTokens != null
      ? (response.inputTokens * Number(price.inputPricePerMillionTokens) + response.outputTokens * Number(price.outputPricePerMillionTokens)) / 1_000_000
      : undefined;
    await aiUsageRepository.record({ organizationId: caller.organizationId, executionId: execution.id, providerId: model.row?.providerId, modelId: model.row?.id, inputTokens: response.inputTokens, outputTokens: response.outputTokens, totalTokens: response.totalTokens, estimatedCost: cost });
    await aiExecutionRepository.complete(execution.id, "COMPLETED", { model: model.modelName, tokens: response.totalTokens, result: p.outputSummary ? p.outputSummary(result) : result });
    return { result, executionId: execution.id };
  } catch (err) {
    const message = redactSecrets(err).slice(0, 300);
    logger.error({ executionId: execution.id, err: message }, "[social-ai] generation failed");
    await aiExecutionRepository.complete(execution.id, "FAILED", { error: message }, message);
    if (err instanceof InfrastructureError || err instanceof ValidationError) throw err;
    throw new InfrastructureError("AI drafting is not available right now.");
  }
}

async function accountsFor(caller: SanitizedUser, accountIds: string[]) {
  const accounts = await prisma.socialAccount.findMany({ where: { organizationId: caller.organizationId, id: { in: accountIds } } });
  if (accounts.length !== new Set(accountIds).size) throw new ValidationError("One or more selected accounts do not exist in this workspace.");
  return accounts.map((a) => ({ account: a, constraints: connectorRegistry.constraintsFor(a.provider, a.accountType) }));
}

function planSlots(start: Date, end: Date, perWeek: number): Date[] {
  const PATTERNS: Record<number, number[]> = { 1: [3], 2: [2, 4], 3: [1, 3, 5], 4: [1, 2, 4, 5], 5: [1, 2, 3, 4, 5], 6: [1, 2, 3, 4, 5, 6], 7: [0, 1, 2, 3, 4, 5, 6] };
  const days = PATTERNS[Math.min(7, Math.max(1, perWeek))]!;
  const slots: Date[] = [];
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate(), 10, 0, 0));
  while (cursor <= end && slots.length < MAX_PLAN_POSTS) {
    if (days.includes(cursor.getUTCDay()) && cursor.getTime() > Date.now()) slots.push(new Date(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return slots;
}

const draftSchema = z.object({ title: z.string().trim().max(200).optional(), posts: z.array(z.object({ accountId: z.string(), body: z.string().min(1).max(10000) })).min(1) });
const planSchema = z.object({ posts: z.array(z.object({ title: z.string().trim().max(200).default("Planned post"), body: z.string().min(1).max(10000) })).min(1) });
const rewriteSchema = z.object({ body: z.string().min(1).max(10000) });

export const socialAiService = {
  async listPlans(organizationId: string) {
    const plans = await prisma.socialContentPlan.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" }, take: 50, include: { _count: { select: { posts: true } } } });
    return plans.map((p) => ({ id: p.id, brief: p.brief, cadencePerWeek: p.cadencePerWeek, startDate: p.startDate, endDate: p.endDate, status: p.status, createdAt: p.createdAt, postCount: p._count.posts }));
  },

  /** (a) Draft from brief: one DRAFT post with a per-account text for every selected account. */
  async draftFromBrief(caller: SanitizedUser, input: { instruction: string; accountIds: string[]; sourceContent?: { type: "post" | "case_study"; id: string }; title?: string; language?: string }, meta: RequestMeta = {}) {
    const targets = await accountsFor(caller, input.accountIds);
    const voice = await socialPostService.getBrandVoice(caller.organizationId);
    const source = input.sourceContent ? await socialPostService.resolveSourceContent(caller.organizationId, input.sourceContent.type, input.sourceContent.id) : null;

    const { result, executionId } = await run({
      caller, def: SOCIAL_PROMPTS.draft, toolCode: "social_draft_from_brief", meta, schema: draftSchema,
      inputSummary: { instruction: input.instruction.slice(0, 500), accounts: input.accountIds.length, sourceContent: input.sourceContent ?? null },
      variables: {
        brandVoice: brandVoiceText(voice), language: input.language ?? voice.languages[0] ?? "en",
        accounts: targets.map((t) => `- accountId=${t.account.id} (${t.account.provider}, ${t.account.displayName}): max ${t.constraints.maxChars} characters`).join("\n"),
        instruction: input.instruction,
        sourceContent: source ? `Title: ${source.title}\nSummary: ${source.excerpt}\nLink: ${source.url}` : "(none)",
      },
    });

    const byAccount = new Map(result.posts.map((p) => [p.accountId, p.body]));
    const first = result.posts[0]!.body;
    const bodies = targets.map((t) => byAccount.get(t.account.id) ?? first);
    const mediaIds: string[] = [];
    if (source?.featuredMediaId && (await prisma.mediaAsset.count({ where: { id: source.featuredMediaId, organizationId: caller.organizationId, status: "ACTIVE" } }))) mediaIds.push(source.featuredMediaId);

    const post = await socialPostService.create(
      caller,
      {
        title: input.title?.trim() || result.title?.trim() || input.instruction.slice(0, 80), body: bodies[0]!, mediaIds, linkUrl: source?.url ?? null, timezone: "UTC",
        accountIds: targets.map((t) => t.account.id),
        bodyOverrides: Object.fromEntries(targets.map((t, i) => [t.account.id, bodies[i]!]).filter(([, b]) => b !== bodies[0])),
        sourceContent: input.sourceContent,
      },
      meta, { aiGenerated: true, aiExecutionId: executionId }
    );
    return { post, executionId };
  },

  /** (b) Generate plan: a SocialContentPlan plus DRAFT posts at suggested slots, all linked to the plan. */
  async generatePlan(caller: SanitizedUser, input: { brief: string; accountIds: string[]; cadencePerWeek: number; startDate: Date; endDate: Date }, meta: RequestMeta = {}) {
    const targets = await accountsFor(caller, input.accountIds);
    const slots = planSlots(input.startDate, input.endDate, input.cadencePerWeek);
    if (slots.length === 0) throw new ValidationError("There are no future posting slots in that date range.");
    const voice = await socialPostService.getBrandVoice(caller.organizationId);

    const { result, executionId } = await run({
      caller, def: SOCIAL_PROMPTS.plan, toolCode: "social_content_plan", meta, schema: planSchema,
      inputSummary: { brief: input.brief.slice(0, 500), accounts: input.accountIds.length, cadencePerWeek: input.cadencePerWeek, slots: slots.length },
      variables: {
        brandVoice: brandVoiceText(voice), language: voice.languages[0] ?? "en", count: slots.length, maxChars: Math.min(...targets.map((t) => t.constraints.maxChars)),
        slots: slots.map((d, i) => `${i + 1}. ${d.toISOString().slice(0, 10)}`).join("\n"), brief: input.brief,
      },
    });

    const plan = await prisma.socialContentPlan.create({
      data: { organizationId: caller.organizationId, brief: input.brief, accountIds: input.accountIds, cadencePerWeek: input.cadencePerWeek, startDate: input.startDate, endDate: input.endDate, aiExecutionId: executionId, createdById: caller.id },
    });
    const posts = [];
    for (const [i, item] of result.posts.slice(0, slots.length).entries()) {
      posts.push(
        await socialPostService.create(
          caller,
          { title: item.title || `Planned post ${i + 1}`, body: item.body, mediaIds: [], linkUrl: null, scheduledAt: slots[i]!, timezone: "UTC", accountIds: input.accountIds, bodyOverrides: {} },
          meta, { aiGenerated: true, aiExecutionId: executionId, planId: plan.id }
        )
      );
    }
    await auditLogRepository.record({
      organizationId: caller.organizationId, actorUserId: caller.id, actorType: "USER", action: "SOCIAL_CONTENT_PLAN_CREATED", resourceType: "social_content_plan", resourceId: plan.id,
      metadata: { posts: posts.length, cadencePerWeek: input.cadencePerWeek, aiExecutionId: executionId }, ipAddress: meta.ip, userAgent: meta.userAgent,
    });
    return { plan: { id: plan.id, brief: plan.brief, cadencePerWeek: plan.cadencePerWeek, startDate: plan.startDate, endDate: plan.endDate, status: plan.status, createdAt: plan.createdAt }, posts, executionId };
  },

  /** (c) Rewrite / shorten / translate the text of an editable draft. The previous text is returned so the UI can undo. */
  async rewrite(caller: SanitizedUser, postId: string, input: { action: "rewrite" | "shorten" | "translate"; instruction?: string; language?: string; accountId?: string }, meta: RequestMeta = {}) {
    const post = await socialPostService.loadPost(caller.organizationId, postId);
    if (!CONTENT_EDITABLE.includes(post.status)) throw new ConflictError(`A post in status ${post.status} cannot be edited. Move it back to draft first.`);
    const target = input.accountId ? post.targets.find((t) => t.socialAccountId === input.accountId) : undefined;
    if (input.accountId && !target) throw new ValidationError("That account is not a target of this post.");
    const current = target?.bodyOverride ?? post.body;
    const constraints = target ? connectorRegistry.constraintsFor(target.account.provider, target.account.accountType) : connectorRegistry.constraintsFor(post.targets[0]?.account.provider ?? "", post.targets[0]?.account.accountType);
    if (input.action === "translate" && !input.language) throw new ValidationError("Choose a language to translate into.");
    const voice = await socialPostService.getBrandVoice(caller.organizationId);
    const task = input.action === "shorten" ? "Shorten the text while keeping its key message." : input.action === "translate" ? `Translate the text into ${input.language}.` : "Rewrite the text to be clearer and more engaging.";

    const { result, executionId } = await run({
      caller, def: SOCIAL_PROMPTS.rewrite, toolCode: `social_${input.action}`, meta, schema: rewriteSchema,
      inputSummary: { postId, action: input.action, language: input.language ?? null },
      variables: { brandVoice: brandVoiceText(voice), task: `${task}${input.instruction ? ` Extra guidance: ${input.instruction}` : ""}`, maxChars: constraints.maxChars, text: current },
    });

    const updated = await socialPostService.update(caller, postId, target ? { bodyOverrides: { ...Object.fromEntries(post.targets.filter((t) => t.bodyOverride).map((t) => [t.socialAccountId, t.bodyOverride!])), [target.socialAccountId]: result.body } } : { body: result.body }, meta);
    await prisma.socialPost.update({ where: { id: postId }, data: { aiGenerated: true, aiExecutionId: executionId } });
    await auditLogRepository.record({
      organizationId: caller.organizationId, actorUserId: caller.id, actorType: "USER", action: "SOCIAL_POST_AI_REWRITE", resourceType: "social_post", resourceId: postId,
      metadata: { action: input.action, aiExecutionId: executionId }, ipAddress: meta.ip, userAgent: meta.userAgent,
    });
    return { post: { ...updated, aiGenerated: true, aiExecutionId: executionId }, previousBody: current, executionId };
  },
};
