/**
 * Social posts: CRUD, status transitions, calendar, guardrail evaluation, approval decisions, brand voice and
 * workspace settings. Everything is scoped to the caller's ACTIVE workspace. NO publishing happens here — SCHEDULED
 * posts wait for Step 6's workers. AI-created posts always start as DRAFT and use exactly the same rules.
 */
import type { Prisma, SocialPostStatus } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { config } from "../../config/env";
import { AuthorizationError, ConflictError, NotFoundError, ValidationError } from "../../core/errors";
import { auditLogRepository } from "../../repositories/auditLogRepository";
import { notificationService } from "../notificationService";
import { connectorRegistry } from "./connectors/registry";
import { runGuardrails, type GuardrailResult } from "./guardrails";
import { CONTENT_EDITABLE, SCHEDULE_EDITABLE, canTransition } from "./postTransitions";
import type { SanitizedUser } from "../../types/domain";
import type { RequestMeta } from "../authService";
import type { BrandVoiceInput, CreateSocialPostInput, UpdateSocialPostInput } from "../../schemas/socialPostSchemas";

const POST_INCLUDE = {
  targets: { include: { account: { select: { id: true, provider: true, displayName: true, handle: true, accountType: true, status: true, avatarUrl: true } } }, orderBy: { createdAt: "asc" as const } },
  createdBy: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.SocialPostInclude;

type PostWithRelations = Prisma.SocialPostGetPayload<{ include: typeof POST_INCLUDE }>;

const EMPTY_VOICE = { toneDescriptors: [] as string[], audience: null as string | null, dos: [] as string[], donts: [] as string[], bannedWords: [] as string[], requiredDisclaimers: [] as string[], defaultHashtags: [] as string[], ctaPhrases: [] as string[], languages: ["en"] };

const auditMeta = (post: { id: string; title: string; status: string }, extra: Record<string, unknown> = {}) => ({ title: post.title, status: post.status, ...extra });

export function projectPost(post: PostWithRelations) {
  return {
    id: post.id,
    title: post.title,
    body: post.body,
    mediaIds: post.mediaIds,
    linkUrl: post.linkUrl,
    status: post.status,
    scheduledAt: post.scheduledAt,
    timezone: post.timezone,
    aiGenerated: post.aiGenerated,
    aiExecutionId: post.aiExecutionId,
    sourceContentType: post.sourceContentType,
    sourceContentId: post.sourceContentId,
    planId: post.planId,
    rejectionReason: post.rejectionReason,
    decidedAt: post.decidedAt,
    guardrailResult: post.guardrailResult as GuardrailResult | null,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
    createdBy: post.createdBy ? { id: post.createdBy.id, name: `${post.createdBy.firstName} ${post.createdBy.lastName}`.trim() } : null,
    targets: post.targets.map((t) => ({ id: t.id, accountId: t.socialAccountId, bodyOverride: t.bodyOverride, status: t.status, scheduledAt: t.scheduledAt, account: t.account })),
  };
}

async function loadPost(organizationId: string, id: string): Promise<PostWithRelations> {
  const post = await prisma.socialPost.findFirst({ where: { id, organizationId, deletedAt: null }, include: POST_INCLUDE });
  if (!post) throw new NotFoundError("Social post not found.");
  return post;
}

async function accountsInOrg(organizationId: string, accountIds: string[]) {
  if (accountIds.length === 0) return [];
  const accounts = await prisma.socialAccount.findMany({ where: { organizationId, id: { in: accountIds } } });
  if (accounts.length !== new Set(accountIds).size) throw new ValidationError("One or more selected accounts do not exist in this workspace.");
  return accounts;
}

async function assertMediaInOrg(organizationId: string, mediaIds: string[]) {
  if (mediaIds.length === 0) return;
  const count = await prisma.mediaAsset.count({ where: { organizationId, id: { in: mediaIds }, status: "ACTIVE" } });
  if (count !== new Set(mediaIds).size) throw new ValidationError("One or more media files are missing or not ready in this workspace.");
}

async function getBrandVoiceRow(organizationId: string) {
  return (await prisma.socialBrandVoice.findUnique({ where: { organizationId } })) ?? { ...EMPTY_VOICE };
}

/** Runs the deterministic guardrails for a post's current content. */
async function evaluate(organizationId: string, post: { id?: string; body: string; linkUrl: string | null; mediaIds: string[]; sourceContentId: string | null }, targets: Array<{ socialAccountId: string; bodyOverride: string | null }>): Promise<GuardrailResult> {
  const [voice, accounts, recent] = await Promise.all([
    getBrandVoiceRow(organizationId),
    accountsInOrg(organizationId, targets.map((t) => t.socialAccountId)),
    prisma.socialPost.findMany({
      where: { organizationId, deletedAt: null, status: { notIn: ["CANCELLED", "REJECTED"] }, ...(post.id ? { id: { not: post.id } } : {}), createdAt: { gte: new Date(Date.now() - 30 * 86400_000) } },
      select: { body: true },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
  ]);
  return runGuardrails({
    targets: targets.map((t) => {
      const account = accounts.find((a) => a.id === t.socialAccountId)!;
      return {
        socialAccountId: account.id,
        label: account.displayName,
        text: t.bodyOverride ?? post.body,
        constraints: connectorRegistry.constraintsFor(account.provider, account.accountType),
        accountStatus: account.status,
      };
    }),
    fallbackText: post.body,
    linkUrl: post.linkUrl,
    mediaCount: post.mediaIds.length,
    hasSourceContent: !!post.sourceContentId,
    brandVoice: { bannedWords: voice.bannedWords, requiredDisclaimers: voice.requiredDisclaimers },
    recentBodies: recent.map((r) => r.body),
  });
}

async function userIdsWithPermission(organizationId: string, permission: string): Promise<string[]> {
  const rows = await prisma.organizationMembership.findMany({
    where: { organizationId, status: "ACTIVE", user: { status: "ACTIVE", deletedAt: null }, role: { rolePermissions: { some: { permission: { key: permission } } } } },
    select: { userId: true },
    take: 50,
  });
  return rows.map((r) => r.userId);
}

const has = (caller: SanitizedUser, key: string) => caller.role.permissions.includes(key);

async function record(caller: SanitizedUser, action: string, post: { id: string; title: string; status: string }, meta: RequestMeta, extra: Record<string, unknown> = {}) {
  await auditLogRepository.record({
    organizationId: caller.organizationId, actorUserId: caller.id, actorType: "USER", action, resourceType: "social_post", resourceId: post.id,
    metadata: auditMeta(post, extra), ipAddress: meta.ip, userAgent: meta.userAgent,
  });
}

export async function getApprovalMode(organizationId: string): Promise<"ALWAYS_REQUIRE" | "AUTO_IF_GUARDRAILS_PASS"> {
  return (await prisma.socialWorkspaceSetting.findUnique({ where: { organizationId } }))?.approvalMode ?? "ALWAYS_REQUIRE";
}

export const socialPostService = {
  evaluateGuardrails: evaluate,
  loadPost,

  async create(caller: SanitizedUser, input: CreateSocialPostInput, meta: RequestMeta = {}, extra: { aiGenerated?: boolean; aiExecutionId?: string; planId?: string } = {}) {
    const accounts = await accountsInOrg(caller.organizationId, input.accountIds);
    await assertMediaInOrg(caller.organizationId, input.mediaIds);
    if (input.sourceContent) await this.resolveSourceContent(caller.organizationId, input.sourceContent.type, input.sourceContent.id);
    const targets = accounts.map((a) => ({ socialAccountId: a.id, bodyOverride: input.bodyOverrides[a.id] ?? null }));
    const base = { body: input.body, linkUrl: input.linkUrl ?? null, mediaIds: input.mediaIds, sourceContentId: input.sourceContent?.id ?? null };
    const guardrailResult = await evaluate(caller.organizationId, base, targets);

    const created = await prisma.socialPost.create({
      data: {
        organizationId: caller.organizationId, title: input.title, body: input.body, mediaIds: input.mediaIds, linkUrl: input.linkUrl ?? null,
        scheduledAt: input.scheduledAt ?? null, timezone: input.timezone, createdById: caller.id, aiGenerated: extra.aiGenerated ?? false, aiExecutionId: extra.aiExecutionId ?? null,
        sourceContentType: input.sourceContent?.type ?? null, sourceContentId: input.sourceContent?.id ?? null, planId: extra.planId ?? null,
        guardrailResult: guardrailResult as unknown as Prisma.InputJsonValue,
        targets: { create: targets.map((t) => ({ ...t, scheduledAt: input.scheduledAt ?? null })) },
      },
      include: POST_INCLUDE,
    });
    await record(caller, extra.aiGenerated ? "SOCIAL_POST_CREATED_BY_AI" : "SOCIAL_POST_CREATED", created, meta, { accounts: accounts.length, aiExecutionId: extra.aiExecutionId });
    return projectPost(created);
  },

  async get(organizationId: string, id: string) {
    return projectPost(await loadPost(organizationId, id));
  },

  async list(organizationId: string, q: { status?: SocialPostStatus; accountId?: string; from?: Date; to?: Date; search?: string; page: number; limit: number }) {
    const where: Prisma.SocialPostWhereInput = {
      organizationId, deletedAt: null,
      ...(q.status ? { status: q.status } : {}),
      ...(q.accountId ? { targets: { some: { socialAccountId: q.accountId } } } : {}),
      ...(q.from || q.to ? { scheduledAt: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) } } : {}),
      ...(q.search ? { OR: [{ title: { contains: q.search, mode: "insensitive" } }, { body: { contains: q.search, mode: "insensitive" } }] } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.socialPost.findMany({ where, include: POST_INCLUDE, orderBy: [{ updatedAt: "desc" }], skip: (q.page - 1) * q.limit, take: q.limit }),
      prisma.socialPost.count({ where }),
    ]);
    return { posts: rows.map(projectPost), total, page: q.page, limit: q.limit };
  },

  /** Posts scheduled in a range, grouped by (UTC) day. */
  async calendar(organizationId: string, q: { from: Date; to: Date; accountId?: string; status?: SocialPostStatus }) {
    const rows = await prisma.socialPost.findMany({
      where: { organizationId, deletedAt: null, scheduledAt: { gte: q.from, lt: q.to }, ...(q.status ? { status: q.status } : {}), ...(q.accountId ? { targets: { some: { socialAccountId: q.accountId } } } : {}) },
      include: POST_INCLUDE, orderBy: { scheduledAt: "asc" }, take: 500,
    });
    const days: Record<string, ReturnType<typeof projectPost>[]> = {};
    for (const post of rows) (days[post.scheduledAt!.toISOString().slice(0, 10)] ??= []).push(projectPost(post));
    return { days, total: rows.length };
  },

  async update(caller: SanitizedUser, id: string, input: UpdateSocialPostInput, meta: RequestMeta = {}) {
    const post = await loadPost(caller.organizationId, id);
    const touchesContent = ["title", "body", "mediaIds", "linkUrl", "accountIds", "bodyOverrides", "sourceContent"].some((k) => k in input);
    const touchesSchedule = "scheduledAt" in input || "timezone" in input;
    if (touchesContent && !CONTENT_EDITABLE.includes(post.status)) throw new ConflictError(`A post in status ${post.status} cannot be edited. Move it back to draft first.`);
    if (touchesSchedule && !SCHEDULE_EDITABLE.includes(post.status)) throw new ConflictError(`The schedule of a ${post.status} post cannot be changed.`);

    const body = input.body ?? post.body;
    const mediaIds = input.mediaIds ?? post.mediaIds;
    const linkUrl = input.linkUrl === undefined ? post.linkUrl : input.linkUrl;
    if (input.mediaIds) await assertMediaInOrg(caller.organizationId, mediaIds);
    if (input.sourceContent) await this.resolveSourceContent(caller.organizationId, input.sourceContent.type, input.sourceContent.id);

    const accountIds = input.accountIds ?? post.targets.map((t) => t.socialAccountId);
    await accountsInOrg(caller.organizationId, accountIds);
    const existingOverrides = new Map(post.targets.map((t) => [t.socialAccountId, t.bodyOverride]));
    const targets = accountIds.map((accountId) => ({ socialAccountId: accountId, bodyOverride: input.bodyOverrides ? (input.bodyOverrides[accountId] ?? null) : (existingOverrides.get(accountId) ?? null) }));
    const sourceContentId = input.sourceContent ? input.sourceContent.id : post.sourceContentId;
    const scheduledAt = "scheduledAt" in input ? (input.scheduledAt ?? null) : post.scheduledAt;
    if (post.status === "SCHEDULED" && (!scheduledAt || scheduledAt.getTime() <= Date.now())) throw new ValidationError("A scheduled post needs a future date and time.");

    const guardrailResult = await evaluate(caller.organizationId, { id: post.id, body, linkUrl, mediaIds, sourceContentId }, targets);

    const updated = await prisma.$transaction(async (tx) => {
      if (touchesContent) {
        await tx.socialPostTarget.deleteMany({ where: { postId: id, socialAccountId: { notIn: accountIds } } });
        for (const t of targets) {
          await tx.socialPostTarget.upsert({
            where: { postId_socialAccountId: { postId: id, socialAccountId: t.socialAccountId } },
            create: { postId: id, socialAccountId: t.socialAccountId, bodyOverride: t.bodyOverride, scheduledAt },
            update: { bodyOverride: t.bodyOverride },
          });
        }
      }
      if (touchesSchedule) await tx.socialPostTarget.updateMany({ where: { postId: id }, data: { scheduledAt } });
      return tx.socialPost.update({
        where: { id },
        data: {
          ...(input.title !== undefined ? { title: input.title } : {}), body, mediaIds, linkUrl, scheduledAt,
          ...(input.timezone ? { timezone: input.timezone } : {}),
          ...(input.sourceContent ? { sourceContentType: input.sourceContent.type, sourceContentId: input.sourceContent.id } : {}),
          guardrailResult: guardrailResult as unknown as Prisma.InputJsonValue,
          // Editing a rejected post puts it back to draft for another round.
          ...(touchesContent && post.status === "REJECTED" ? { status: "DRAFT" as const, rejectionReason: null } : {}),
        },
        include: POST_INCLUDE,
      });
    });
    await record(caller, touchesContent ? "SOCIAL_POST_UPDATED" : "SOCIAL_POST_RESCHEDULED", updated, meta);
    return projectPost(updated);
  },

  async remove(caller: SanitizedUser, id: string, meta: RequestMeta = {}) {
    const post = await loadPost(caller.organizationId, id);
    if (!["DRAFT", "REJECTED", "CANCELLED"].includes(post.status)) throw new ConflictError(`A post in status ${post.status} cannot be deleted. Cancel it first.`);
    await prisma.socialPost.update({ where: { id }, data: { deletedAt: new Date() } });
    await record(caller, "SOCIAL_POST_DELETED", post, meta);
  },

  /** Moves a post to a new status after checking the transition table, guardrails and role rules. */
  async transition(caller: SanitizedUser, id: string, to: SocialPostStatus, opts: { comment?: string; scheduledAt?: Date; timezone?: string } = {}, meta: RequestMeta = {}) {
    const post = await loadPost(caller.organizationId, id);
    if (!canTransition(post.status, to)) throw new ConflictError(`A ${post.status} post cannot move to ${to}.`);

    let target: SocialPostStatus = to;
    const data: Prisma.SocialPostUpdateInput = {};
    let action = `SOCIAL_POST_${to}`;
    let guardrails: GuardrailResult | null = post.guardrailResult as GuardrailResult | null;

    if (to === "PENDING_APPROVAL" || to === "SCHEDULED" || to === "APPROVED") {
      // Re-run guardrails against the current content (accounts/voice may have changed since the last save).
      guardrails = await evaluate(caller.organizationId, post, post.targets.map((t) => ({ socialAccountId: t.socialAccountId, bodyOverride: t.bodyOverride })));
      data.guardrailResult = guardrails as unknown as Prisma.InputJsonValue;
      if (!(to === "APPROVED" && post.status === "SCHEDULED")) {
        if (!guardrails.passed) throw new ValidationError("Fix the blocking guardrail issues before continuing.", { issues: guardrails.issues.filter((i) => i.severity === "block") });
      }
    }

    if (to === "PENDING_APPROVAL") {
      if (post.status === "DRAFT" && (await getApprovalMode(caller.organizationId)) === "AUTO_IF_GUARDRAILS_PASS") {
        target = "APPROVED";
        data.decidedAt = new Date();
        action = "SOCIAL_POST_AUTO_APPROVED";
      } else {
        action = "SOCIAL_POST_SUBMITTED";
      }
    } else if (to === "APPROVED") {
      if (post.status === "PENDING_APPROVAL") {
        if (!has(caller, "social.approve")) throw new AuthorizationError("Missing permission: social.approve");
        data.decidedById = caller.id;
        data.decidedAt = new Date();
        data.rejectionReason = null;
        action = "SOCIAL_POST_APPROVED";
      } else if (post.status === "SCHEDULED") {
        action = "SOCIAL_POST_UNSCHEDULED";
      } else {
        throw new ConflictError("A post can only be approved by an approver after it is submitted.");
      }
    } else if (to === "REJECTED") {
      if (!has(caller, "social.approve")) throw new AuthorizationError("Missing permission: social.approve");
      if (!opts.comment?.trim()) throw new ValidationError("A comment is required when rejecting.");
      data.decidedById = caller.id;
      data.decidedAt = new Date();
      data.rejectionReason = opts.comment.trim();
      action = "SOCIAL_POST_REJECTED";
    } else if (to === "SCHEDULED") {
      const at = opts.scheduledAt ?? post.scheduledAt;
      if (!at || at.getTime() <= Date.now()) throw new ValidationError("Choose a future date and time to schedule.");
      data.scheduledAt = at;
      if (opts.timezone) data.timezone = opts.timezone;
      action = "SOCIAL_POST_SCHEDULED";
    } else if (to === "DRAFT") {
      action = post.status === "PENDING_APPROVAL" ? "SOCIAL_POST_WITHDRAWN" : "SOCIAL_POST_REOPENED";
      data.rejectionReason = null;
    } else if (to === "CANCELLED") {
      action = "SOCIAL_POST_CANCELLED";
    } else {
      throw new ConflictError("That status is managed by the publishing system.");
    }

    const targetStatus = target === "SCHEDULED" ? ("SCHEDULED" as const) : target === "CANCELLED" ? ("CANCELLED" as const) : ("PENDING" as const);
    const updated = await prisma.$transaction(async (tx) => {
      await tx.socialPostTarget.updateMany({ where: { postId: id }, data: { status: targetStatus, ...(data.scheduledAt ? { scheduledAt: data.scheduledAt as Date } : {}) } });
      return tx.socialPost.update({ where: { id }, data: { ...data, status: target }, include: POST_INCLUDE });
    });
    await record(caller, action, updated, meta, { from: post.status, to: updated.status, ...(opts.comment ? { comment: opts.comment.slice(0, 500) } : {}) });

    // Notifications: tell approvers about a new submission, and the creator about a decision.
    if (action === "SOCIAL_POST_SUBMITTED") {
      const approvers = (await userIdsWithPermission(caller.organizationId, "social.approve")).filter((u) => u !== caller.id);
      await Promise.all(approvers.map((userId) => notificationService.notify({ organizationId: caller.organizationId, userId, type: "approval_requested", title: "Social post awaiting approval", message: `"${post.title}" is waiting for your approval.`, entityType: "social_post", entityId: post.id })));
    } else if ((action === "SOCIAL_POST_APPROVED" || action === "SOCIAL_POST_REJECTED") && post.createdById && post.createdById !== caller.id) {
      await notificationService.notify({
        organizationId: caller.organizationId, userId: post.createdById, type: action === "SOCIAL_POST_APPROVED" ? "approval_completed" : "approval_rejected",
        title: action === "SOCIAL_POST_APPROVED" ? "Social post approved" : "Social post rejected", message: action === "SOCIAL_POST_REJECTED" ? `"${post.title}": ${opts.comment}` : `"${post.title}" was approved.`, entityType: "social_post", entityId: post.id,
      });
    }
    return projectPost(updated);
  },

  /** Approvals-center entry point: approve/reject a post that is PENDING_APPROVAL. */
  async decide(caller: SanitizedUser, id: string, approve: boolean, comment: string | undefined, meta: RequestMeta = {}) {
    const post = await loadPost(caller.organizationId, id);
    if (post.status !== "PENDING_APPROVAL") throw new ConflictError(`This post is ${post.status}, not awaiting approval.`);
    return this.transition(caller, id, approve ? "APPROVED" : "REJECTED", { comment }, meta);
  },

  // ---- source content ("share this blog post / case study") ----
  async resolveSourceContent(organizationId: string, type: "post" | "case_study", id: string) {
    const base = (config.publicSiteBaseUrl || "https://artifysols.com").replace(/\/+$/, "");
    const strip = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    const excerptOf = (excerpt: string | null | undefined, body: string | undefined) => (excerpt?.trim() || strip(body ?? "")).slice(0, 280);
    if (type === "post") {
      const post = await prisma.post.findFirst({ where: { id, organizationId, status: "PUBLISHED", deletedAt: null }, include: { currentRevision: { select: { excerpt: true, body: true } } } });
      if (!post) throw new NotFoundError("Published blog post not found.");
      return { type, id: post.id, title: post.title, excerpt: excerptOf(post.currentRevision?.excerpt, post.currentRevision?.body), url: `${base}/blog/${post.slug}`, featuredMediaId: post.featuredMediaId };
    }
    const study = await prisma.caseStudy.findFirst({ where: { id, organizationId, status: "PUBLISHED", deletedAt: null }, include: { currentRevision: { select: { excerpt: true, body: true } } } });
    if (!study) throw new NotFoundError("Published case study not found.");
    return { type, id: study.id, title: study.title, excerpt: excerptOf(study.currentRevision?.excerpt, study.currentRevision?.body), url: `${base}/case-studies/${study.slug}`, featuredMediaId: study.featuredMediaId };
  },

  async listSourceContent(organizationId: string, type: "post" | "case_study", search?: string) {
    const where = { organizationId, status: "PUBLISHED" as const, deletedAt: null, ...(search ? { title: { contains: search, mode: "insensitive" as const } } : {}) };
    const rows = type === "post" ? await prisma.post.findMany({ where, select: { id: true }, orderBy: { publishedAt: "desc" }, take: 20 }) : await prisma.caseStudy.findMany({ where, select: { id: true }, orderBy: { publishedAt: "desc" }, take: 20 });
    return Promise.all(rows.map((r) => this.resolveSourceContent(organizationId, type, r.id)));
  },

  // ---- brand voice & settings ----
  async getBrandVoice(organizationId: string) {
    const row = await getBrandVoiceRow(organizationId);
    const { toneDescriptors, audience, dos, donts, bannedWords, requiredDisclaimers, defaultHashtags, ctaPhrases, languages } = row;
    return { toneDescriptors, audience, dos, donts, bannedWords, requiredDisclaimers, defaultHashtags, ctaPhrases, languages };
  },

  async updateBrandVoice(caller: SanitizedUser, input: BrandVoiceInput, meta: RequestMeta = {}) {
    const data = { ...input, audience: input.audience ?? null, defaultHashtags: input.defaultHashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)), updatedById: caller.id };
    await prisma.socialBrandVoice.upsert({ where: { organizationId: caller.organizationId }, create: { organizationId: caller.organizationId, ...data }, update: data });
    await auditLogRepository.record({
      organizationId: caller.organizationId, actorUserId: caller.id, actorType: "USER", action: "SOCIAL_BRAND_VOICE_UPDATED", resourceType: "social_brand_voice",
      metadata: { bannedWords: data.bannedWords.length, disclaimers: data.requiredDisclaimers.length, languages: data.languages }, ipAddress: meta.ip, userAgent: meta.userAgent,
    });
    return this.getBrandVoice(caller.organizationId);
  },

  async getSettings(organizationId: string) {
    return { approvalMode: await getApprovalMode(organizationId) };
  },

  async updateSettings(caller: SanitizedUser, approvalMode: "ALWAYS_REQUIRE" | "AUTO_IF_GUARDRAILS_PASS", meta: RequestMeta = {}) {
    if (caller.role.key !== "ADMIN" && caller.role.key !== "SUPER_ADMIN") throw new AuthorizationError("Only administrators can change the approval mode.");
    const before = await getApprovalMode(caller.organizationId);
    await prisma.socialWorkspaceSetting.upsert({ where: { organizationId: caller.organizationId }, create: { organizationId: caller.organizationId, approvalMode, updatedById: caller.id }, update: { approvalMode, updatedById: caller.id } });
    await auditLogRepository.record({
      organizationId: caller.organizationId, actorUserId: caller.id, actorType: "USER", action: "SOCIAL_APPROVAL_MODE_CHANGED", resourceType: "social_workspace_setting",
      beforeData: { approvalMode: before }, afterData: { approvalMode }, ipAddress: meta.ip, userAgent: meta.userAgent,
    });
    return { approvalMode };
  },
};
