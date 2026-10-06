/**
 * Publisher: claims due targets, sends them through the connector interface and records every outcome.
 *
 * Safety properties (each is covered by tests):
 *  - Gate (env → global → workspace; kill switch + enabled) is re-read from the database before every attempt, and
 *    again after the claim, immediately before the network call. Dry-run performs everything except that call.
 *  - Only targets of SCHEDULED/PUBLISHING posts that were approved and still pass guardrails are ever sent.
 *  - At-most-once: the claim is a single atomic UPDATE (SCHEDULED → PUBLISHING, attempts+1). Only the worker whose
 *    UPDATE matched a row proceeds. A target whose outcome is unknown (timeout, worker died mid-flight) becomes
 *    UNCERTAIN and is never retried automatically. A success that cannot be recorded stays PUBLISHING → stale → UNCERTAIN.
 *  - Errors are redacted before storage/logging; tokens never leave this module except into the connector call.
 */
import { randomUUID } from "node:crypto";
import type { Prisma, SocialPostTargetStatus } from "@prisma/client";
import { prisma } from "../../../db/prisma";
import { config } from "../../../config/env";
import { logger } from "../../../core/logger";
import { ConflictError, NotFoundError, ValidationError } from "../../../core/errors";
import { auditLogRepository } from "../../../repositories/auditLogRepository";
import { notificationService } from "../../notificationService";
import { getStorageProvider } from "../../../storage";
import { connectorRegistry } from "../connectors/registry";
import type { PublishMedia, SocialConnector } from "../connectors/types";
import { socialPostService } from "../socialPostService";
import { socialAccountService } from "../socialAccountService";
import { redactSecrets, type SocialTokenSet } from "../tokenVault";
import { SocialPublishError } from "./publishErrors";
import { DEFAULT_GRACE_MINUTES, STALE_PUBLISHING_MS, decideFailure, derivePostStatus, isMissed, type BackoffOptions } from "./publishPolicy";
import { publishingSettingsService, type PublishGate } from "./publishingSettingsService";
import type { SanitizedUser } from "../../../types/domain";
import type { RequestMeta } from "../../authService";

/** Hard ceiling for one connector call. Exceeding it means the outcome is unknown → UNCERTAIN. */
export const PUBLISH_CALL_TIMEOUT_MS = 25_000;
const safe = (err: unknown, secrets: Array<string | undefined> = []) => redactSecrets(err, secrets).slice(0, 300);

export type TargetOutcome = "published" | "dry_run" | "retry_scheduled" | "failed" | "uncertain" | "reauth" | "skipped" | "not_claimed" | "blocked";

export interface TickResult {
  gate: string;
  recoveredStale: number;
  missed: number;
  considered: number;
  outcomes: Record<TargetOutcome, number>;
  durationMs: number;
}

const emptyOutcomes = (): Record<TargetOutcome, number> => ({ published: 0, dry_run: 0, retry_scheduled: 0, failed: 0, uncertain: 0, reauth: 0, skipped: 0, not_claimed: 0, blocked: 0 });

async function publishers(organizationId: string): Promise<string[]> {
  const rows = await prisma.organizationMembership.findMany({
    where: { organizationId, status: "ACTIVE", user: { status: "ACTIVE", deletedAt: null }, role: { rolePermissions: { some: { permission: { key: "social.publish" } } } } },
    select: { userId: true }, take: 50,
  });
  return rows.map((r) => r.userId);
}

async function notifyPublishers(organizationId: string, postId: string, title: string, message: string) {
  const userIds = await publishers(organizationId);
  await Promise.all(userIds.map((userId) => notificationService.notify({ organizationId, userId, type: "social_publish_failed", title, message, entityType: "social_post", entityId: postId })));
}

/** Recomputes the post's status from its targets (worker-owned transitions bypass the user transition table on purpose). */
export async function syncPostStatus(postId: string): Promise<void> {
  const post = await prisma.socialPost.findUnique({ where: { id: postId }, select: { status: true, targets: { select: { status: true } } } });
  if (!post || !["SCHEDULED", "PUBLISHING", "FAILED", "APPROVED"].includes(post.status)) return;
  const next = derivePostStatus(post.status, post.targets);
  if (next) await prisma.socialPost.update({ where: { id: postId }, data: { status: next } });
}

async function audit(organizationId: string, action: string, targetId: string, result: "SUCCESS" | "FAILURE", metadata: Record<string, unknown>, actor?: { id: string }, meta?: RequestMeta) {
  await auditLogRepository.record({
    organizationId, actorUserId: actor?.id, actorType: actor ? "USER" : "SYSTEM", action, resourceType: "social_post_target", resourceId: targetId, result, metadata,
    ipAddress: meta?.ip, userAgent: meta?.userAgent,
  }).catch((err) => logger.error({ targetId, err: safe(err) }, "[social-publish] audit write failed"));
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([p, new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new SocialPublishError("uncertain", "The network did not answer in time; the post may or may not have been published.")), ms); })]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function buildMedia(organizationId: string, mediaIds: string[]): Promise<PublishMedia[]> {
  if (mediaIds.length === 0) return [];
  const assets = await prisma.mediaAsset.findMany({ where: { organizationId, id: { in: mediaIds }, status: "ACTIVE" } });
  if (assets.length !== mediaIds.length) throw new SocialPublishError("permanent", "One or more attached media files are missing.");
  const storage = getStorageProvider();
  return mediaIds.map((id) => {
    const a = assets.find((x) => x.id === id)!;
    return {
      mediaId: a.id, mimeType: a.mimeType, altText: a.altText,
      signedUrl: () => storage.createSignedReadUrl({ key: a.storageKey, expiresInSeconds: 600 }),
      load: async () => {
        if (Number(a.sizeBytes) > 10 * 1024 * 1024) throw new SocialPublishError("permanent", "Media file is larger than the 10 MB publishing limit.");
        const url = await storage.createSignedReadUrl({ key: a.storageKey, expiresInSeconds: 120 });
        const res = await fetch(url);
        if (!res.ok) throw new SocialPublishError("transient", `Could not read the media file (HTTP ${res.status}).`, { httpStatus: res.status });
        return Buffer.from(await res.arrayBuffer());
      },
    };
  });
}

export interface PublishTargetOptions {
  workerId?: string;
  now?: Date;
  /** Operator-triggered ("Retry now"): skips the scheduledAt/nextAttemptAt due check, never any safety gate. */
  manual?: { actor: SanitizedUser; meta?: RequestMeta };
  backoff?: BackoffOptions;
}

const TARGET_INCLUDE = { post: true, account: { select: { id: true, organizationId: true, provider: true, externalAccountId: true, displayName: true, accountType: true, status: true, tokenExpiresAt: true } } } satisfies Prisma.SocialPostTargetInclude;

export const publisher = {
  /** Attempts one target. Safe to call concurrently from many workers: at most one wins the claim. */
  async publishTarget(targetId: string, opts: PublishTargetOptions = {}): Promise<{ outcome: TargetOutcome; detail?: string }> {
    const now = opts.now ?? new Date();
    const workerId = opts.workerId ?? `w_${randomUUID().slice(0, 8)}`;
    const head = await prisma.socialPostTarget.findUnique({ where: { id: targetId }, include: { post: { select: { organizationId: true } } } });
    if (!head) throw new NotFoundError("Publishing target not found.");
    const organizationId = head.post.organizationId;

    // 1) Gate — before touching any state.
    const gate: PublishGate = await publishingSettingsService.gate(organizationId);
    if (!gate.allowed) return { outcome: "blocked", detail: gate.reason };

    // 2) Idempotency key: assigned once, kept for the life of the target (sent to networks that honour it).
    if (!head.idempotencyKey) await prisma.socialPostTarget.updateMany({ where: { id: targetId, idempotencyKey: null }, data: { idempotencyKey: `art_${randomUUID()}` } });

    // 3) Atomic claim. count === 1 means THIS worker owns the attempt.
    const claim = await prisma.socialPostTarget.updateMany({
      where: {
        id: targetId, status: "SCHEDULED",
        ...(opts.manual ? {} : { scheduledAt: { lte: now }, OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] }),
        post: { status: { in: ["SCHEDULED", "PUBLISHING"] }, deletedAt: null, decidedAt: { not: null } },
      },
      data: { status: "PUBLISHING", lockedAt: now, lockedBy: workerId, attempts: { increment: 1 } },
    });
    if (claim.count !== 1) return { outcome: "not_claimed" };
    await prisma.socialPost.updateMany({ where: { id: head.postId, status: "SCHEDULED" }, data: { status: "PUBLISHING" } });

    const target = await prisma.socialPostTarget.findUniqueOrThrow({ where: { id: targetId }, include: TARGET_INCLUDE });
    const { post, account } = target;
    const attemptNumber = (await prisma.socialPublishAttempt.count({ where: { targetId } })) + 1;
    const attempt = await prisma.socialPublishAttempt.create({ data: { targetId, attemptNumber, startedAt: new Date(), dryRun: gate.dryRun, actorUserId: opts.manual?.actor.id } });
    const startedMs = Date.now();
    const actor = opts.manual?.actor;
    const settings = await publishingSettingsService.getWorkspace(organizationId);

    const finish = async (data: { outcome: "SUCCESS" | "TRANSIENT_FAILURE" | "PERMANENT_FAILURE" | "AUTH_FAILURE" | "UNCERTAIN" | "DRY_RUN" | "SKIPPED"; category?: string; message?: string; externalPostId?: string; externalUrl?: string | null; httpStatus?: number }) =>
      prisma.socialPublishAttempt.update({
        where: { id: attempt.id },
        data: { finishedAt: new Date(), outcome: data.outcome, errorCategory: data.category ?? null, errorMessage: data.message ?? null, externalPostId: data.externalPostId ?? null, externalUrl: data.externalUrl ?? null, httpStatus: data.httpStatus ?? null, durationMs: Date.now() - startedMs },
      });
    const settle = async (status: SocialPostTargetStatus, extra: Prisma.SocialPostTargetUpdateInput = {}) => {
      await prisma.socialPostTarget.update({ where: { id: targetId }, data: { status, lockedAt: null, lockedBy: null, ...extra } });
      await syncPostStatus(post.id);
    };
    /** Undo a claim that turned out not to be a real attempt (nothing was sent). */
    const release = async (status: SocialPostTargetStatus, message: string, category: string, extra: Prisma.SocialPostTargetUpdateInput = {}) => {
      await finish({ outcome: "SKIPPED", category, message });
      await settle(status, { attempts: { decrement: 1 }, publishError: message, ...extra });
    };
    const failTerminal = async (outcome: "PERMANENT_FAILURE" | "AUTH_FAILURE", category: string, message: string, httpStatus?: number) => {
      await finish({ outcome, category, message, httpStatus });
      await settle("FAILED", { publishError: `${category}: ${message}` });
      await audit(organizationId, "SOCIAL_PUBLISH_FAILED", targetId, "FAILURE", { provider: account.provider, accountId: account.id, postId: post.id, attempt: attemptNumber, category, message, httpStatus });
      await notifyPublishers(organizationId, post.id, "Social post failed to publish", `"${post.title}" → ${account.displayName}: ${message}`);
      logger.warn({ targetId, postId: post.id, attempt: attemptNumber, category, httpStatus }, "[social-publish] failed");
      return { outcome: "failed" as const, detail: category };
    };

    try {
      // 4) Re-check the gate right before the network call (a kill switch may have been flipped since step 1).
      const gate2 = await publishingSettingsService.gate(organizationId);
      if (!gate2.allowed) {
        await release("SCHEDULED", `Publishing paused (${gate2.reason}).`, "gate");
        return { outcome: "blocked", detail: gate2.reason };
      }
      const dryRun = gate2.dryRun;

      // 5) Preconditions that can change between scheduling and sending.
      if (account.status !== "CONNECTED") {
        return await failTerminal("AUTH_FAILURE", "account_unavailable", `${account.displayName} is ${account.status.toLowerCase().replace("_", " ")}. Reconnect it, then retry.`);
      }
      const guardrails = await socialPostService.evaluateGuardrails(organizationId, post, [{ socialAccountId: account.id, bodyOverride: target.bodyOverride }]);
      if (!guardrails.passed) {
        const first = guardrails.issues.find((i) => i.severity === "block");
        return await failTerminal("PERMANENT_FAILURE", "guardrails", `Guardrails no longer pass: ${first?.message ?? "blocking issue"}`);
      }
      const connector: SocialConnector | undefined = connectorRegistry.getAvailable(account.provider);
      if (!connector?.publish) return await failTerminal("PERMANENT_FAILURE", "unsupported", `${account.provider} publishing is not available in this environment.`);

      if (dryRun) {
        const text = target.bodyOverride ?? post.body;
        await finish({ outcome: "DRY_RUN", category: "dry_run", message: `Dry run: would publish ${text.length} characters${post.mediaIds.length ? ` and ${post.mediaIds.length} media` : ""} to ${account.displayName}. Nothing was sent.` });
        await settle("FAILED", { publishError: "dry_run: Dry run — nothing was sent to the network. Switch off dry-run and use Retry now to publish." });
        await audit(organizationId, "SOCIAL_PUBLISH_DRY_RUN", targetId, "SUCCESS", { provider: account.provider, accountId: account.id, postId: post.id, attempt: attemptNumber }, actor, opts.manual?.meta);
        return { outcome: "dry_run" };
      }

      let tokens: SocialTokenSet | null = null;
      try {
        tokens = await socialAccountService.loadTokens(account.id);
      } catch {
        return await failTerminal("PERMANENT_FAILURE", "credentials", "Stored credentials could not be read. Reconnect the account.");
      }
      if (!tokens) return await failTerminal("AUTH_FAILURE", "credentials", "No stored credentials. Reconnect the account.");
      if (account.tokenExpiresAt && account.tokenExpiresAt.getTime() <= now.getTime()) {
        await prisma.socialAccount.update({ where: { id: account.id }, data: { status: "NEEDS_REAUTH", lastError: "Access token expired." } });
        return await failTerminal("AUTH_FAILURE", "token_expired", "The access token expired. Reconnect the account, then retry.");
      }

      // 6) The only network call. Any throw below is classified; anything unclassified is treated as UNCERTAIN (never a blind retry).
      let result;
      try {
        const media = await buildMedia(organizationId, post.mediaIds);
        result = await withTimeout(connector.publish(tokens, {
          accountExternalId: account.externalAccountId, accountType: account.accountType, text: target.bodyOverride ?? post.body, linkUrl: post.linkUrl, media,
          idempotencyKey: (await prisma.socialPostTarget.findUniqueOrThrow({ where: { id: targetId }, select: { idempotencyKey: true } })).idempotencyKey!, attempt: attemptNumber,
        }), PUBLISH_CALL_TIMEOUT_MS);
      } catch (err) {
        const kind = err instanceof SocialPublishError ? err.kind : "uncertain";
        const message = safe(err instanceof SocialPublishError ? err.message : `Unexpected error: ${(err as Error)?.message ?? err}`, [tokens.accessToken, tokens.refreshToken]);
        const httpStatus = err instanceof SocialPublishError ? err.httpStatus : undefined;
        const decision = decideFailure(kind, target.attempts, settings.maxAttempts, err instanceof SocialPublishError ? err.retryAfterMs : undefined, opts.backoff);

        if (decision.action === "retry") {
          await finish({ outcome: "TRANSIENT_FAILURE", category: "transient", message, httpStatus });
          await settle("SCHEDULED", { nextAttemptAt: new Date(now.getTime() + decision.delayMs), publishError: `transient: ${message}` });
          await audit(organizationId, "SOCIAL_PUBLISH_RETRY_SCHEDULED", targetId, "FAILURE", { provider: account.provider, postId: post.id, attempt: attemptNumber, message, httpStatus, retryInMs: decision.delayMs }, actor, opts.manual?.meta);
          logger.info({ targetId, attempt: attemptNumber, retryInMs: decision.delayMs, httpStatus }, "[social-publish] transient failure, retry scheduled");
          return { outcome: "retry_scheduled", detail: String(decision.delayMs) };
        }
        if (decision.action === "uncertain") {
          await finish({ outcome: "UNCERTAIN", category: "uncertain", message });
          await settle("UNCERTAIN", { publishError: `uncertain: ${message}` });
          await audit(organizationId, "SOCIAL_PUBLISH_UNCERTAIN", targetId, "FAILURE", { provider: account.provider, postId: post.id, attempt: attemptNumber, message }, actor, opts.manual?.meta);
          await notifyPublishers(organizationId, post.id, "Social post needs a manual check", `"${post.title}" → ${account.displayName}: the network did not confirm whether it was published. Check the account, then mark it published or retry.`);
          logger.warn({ targetId, attempt: attemptNumber }, "[social-publish] outcome unknown — marked UNCERTAIN");
          return { outcome: "uncertain" };
        }
        if (decision.action === "reauth") {
          await prisma.socialAccount.update({ where: { id: account.id }, data: { status: "NEEDS_REAUTH", lastError: message } });
          const r = await failTerminal("AUTH_FAILURE", "auth", message, httpStatus);
          return { ...r, outcome: "reauth" };
        }
        return await failTerminal("PERMANENT_FAILURE", decision.reason === "max_attempts" ? "max_attempts" : "permanent", decision.reason === "max_attempts" ? `Gave up after ${target.attempts} attempts. Last error: ${message}` : message, httpStatus);
      }

      // 7) Success: record it. If this write fails the target stays PUBLISHING and is later recovered as UNCERTAIN (never re-sent).
      await finish({ outcome: "SUCCESS", externalPostId: result.externalPostId, externalUrl: result.externalUrl });
      await settle("PUBLISHED", { publishedAt: new Date(), externalPostId: result.externalPostId, externalUrl: result.externalUrl, publishError: null, nextAttemptAt: null });
      await audit(organizationId, "SOCIAL_PUBLISHED", targetId, "SUCCESS", { provider: account.provider, accountId: account.id, postId: post.id, attempt: attemptNumber, externalPostId: result.externalPostId }, actor, opts.manual?.meta);
      logger.info({ targetId, postId: post.id, provider: account.provider, attempt: attemptNumber, durationMs: Date.now() - startedMs }, "[social-publish] published");
      return { outcome: "published" };
    } catch (err) {
      // Bookkeeping failed AFTER we may have sent. Leave the target PUBLISHING (stale recovery → UNCERTAIN); never release it for retry.
      logger.error({ targetId, err: safe(err) }, "[social-publish] bookkeeping error; target left PUBLISHING for stale recovery");
      return { outcome: "uncertain", detail: "bookkeeping_error" };
    }
  },

  /** PUBLISHING targets whose worker vanished become UNCERTAIN. Never retried automatically. */
  async recoverStale(now = new Date()): Promise<number> {
    const stale = await prisma.socialPostTarget.findMany({ where: { status: "PUBLISHING", lockedAt: { lt: new Date(now.getTime() - STALE_PUBLISHING_MS) } }, include: { post: { select: { id: true, title: true, organizationId: true } }, account: { select: { displayName: true } } }, take: 50 });
    let n = 0;
    for (const t of stale) {
      const moved = await prisma.socialPostTarget.updateMany({ where: { id: t.id, status: "PUBLISHING", lockedAt: t.lockedAt }, data: { status: "UNCERTAIN", lockedAt: null, lockedBy: null, publishError: "uncertain: The worker stopped before recording the outcome. Check the account before retrying." } });
      if (moved.count !== 1) continue;
      n += 1;
      await prisma.socialPublishAttempt.updateMany({ where: { targetId: t.id, finishedAt: null }, data: { finishedAt: now, outcome: "UNCERTAIN", errorCategory: "stale", errorMessage: "Worker stopped before the outcome was recorded." } });
      await syncPostStatus(t.post.id);
      await audit(t.post.organizationId, "SOCIAL_PUBLISH_UNCERTAIN", t.id, "FAILURE", { postId: t.post.id, reason: "stale_lock" });
      await notifyPublishers(t.post.organizationId, t.post.id, "Social post needs a manual check", `"${t.post.title}" → ${t.account.displayName}: publishing was interrupted. Check the account, then mark it published or retry.`);
    }
    return n;
  },

  /** Marks never-attempted targets that are older than their workspace's grace window as MISSED. */
  async markMissed(now = new Date()): Promise<number> {
    const overdue = await prisma.socialPostTarget.findMany({
      where: { status: "SCHEDULED", attempts: 0, scheduledAt: { lt: new Date(now.getTime() - 60_000) } },
      include: { post: { select: { id: true, title: true, organizationId: true } }, account: { select: { displayName: true } } }, orderBy: { scheduledAt: "asc" }, take: 200,
    });
    if (overdue.length === 0) return 0;
    const graceByOrg = new Map<string, number>();
    let n = 0;
    for (const t of overdue) {
      const org = t.post.organizationId;
      if (!graceByOrg.has(org)) graceByOrg.set(org, (await publishingSettingsService.getWorkspace(org)).graceMinutes ?? DEFAULT_GRACE_MINUTES);
      if (!isMissed(t.scheduledAt!, t.attempts, now, graceByOrg.get(org)!)) continue;
      const moved = await prisma.socialPostTarget.updateMany({ where: { id: t.id, status: "SCHEDULED", attempts: 0 }, data: { status: "MISSED", publishError: `missed: Not published within ${graceByOrg.get(org)} minutes of its scheduled time.` } });
      if (moved.count !== 1) continue;
      n += 1;
      await syncPostStatus(t.post.id);
      await audit(org, "SOCIAL_PUBLISH_MISSED", t.id, "FAILURE", { postId: t.post.id, scheduledAt: t.scheduledAt });
      await notifyPublishers(org, t.post.id, "Social post missed its slot", `"${t.post.title}" → ${t.account.displayName} was not published within the grace window. Reschedule or retry it from the Failures page.`);
    }
    return n;
  },

  /** One scheduler run: recover stale, mark missed, then publish due targets with bounded batch/concurrency/per-account fairness. */
  async tick(opts: { now?: Date; batchSize?: number; concurrency?: number; perAccountLimit?: number; timeBudgetMs?: number; backoff?: BackoffOptions } = {}): Promise<TickResult> {
    const started = Date.now();
    const now = opts.now ?? new Date();
    const batchSize = opts.batchSize ?? config.socialPublishBatchSize;
    const concurrency = opts.concurrency ?? config.socialPublishConcurrency;
    const perAccount = opts.perAccountLimit ?? config.socialPublishPerAccountLimit;
    const budget = opts.timeBudgetMs ?? config.socialPublishTimeBudgetMs;
    const workerId = `tick_${randomUUID().slice(0, 8)}`;
    const outcomes = emptyOutcomes();

    const recoveredStale = await this.recoverStale(now);
    const missed = await this.markMissed(now);

    const candidates = await prisma.socialPostTarget.findMany({
      where: { status: "SCHEDULED", scheduledAt: { lte: now }, OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }], post: { status: { in: ["SCHEDULED", "PUBLISHING"] }, deletedAt: null, decidedAt: { not: null } } },
      select: { id: true, socialAccountId: true }, orderBy: { scheduledAt: "asc" }, take: batchSize * 3,
    });
    // Per-account fairness: at most `perAccount` targets per account per tick, `batchSize` overall.
    const perCount = new Map<string, number>();
    const queue = candidates.filter((c) => {
      const n = perCount.get(c.socialAccountId) ?? 0;
      if (n >= perAccount) return false;
      perCount.set(c.socialAccountId, n + 1);
      return true;
    }).slice(0, batchSize);

    let gateReason = "open";
    const rateLimitedAccounts = new Set<string>();
    let idx = 0;
    const worker = async () => {
      while (idx < queue.length && Date.now() - started < budget) {
        const item = queue[idx++]!;
        if (rateLimitedAccounts.has(item.socialAccountId)) { outcomes.skipped += 1; continue; }
        try {
          const r = await this.publishTarget(item.id, { workerId, now, backoff: opts.backoff });
          outcomes[r.outcome] += 1;
          if (r.outcome === "blocked") gateReason = r.detail ?? "blocked";
          if (r.outcome === "retry_scheduled") rateLimitedAccounts.add(item.socialAccountId); // network pushed back: leave this account alone for this tick
        } catch (err) {
          outcomes.skipped += 1;
          logger.error({ targetId: item.id, err: safe(err) }, "[social-publish] unexpected error while publishing");
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(queue.length, 1)) }, worker));

    const result: TickResult = { gate: gateReason, recoveredStale, missed, considered: queue.length, outcomes, durationMs: Date.now() - started };
    logger.info({ ...result }, "[social-publish] tick");
    return result;
  },
};

// ---- operator actions (Failures page) ----
const ACTIONABLE: SocialPostTargetStatus[] = ["FAILED", "UNCERTAIN", "MISSED"];

async function loadActionable(caller: SanitizedUser, targetId: string, allowed: SocialPostTargetStatus[] = ACTIONABLE) {
  const target = await prisma.socialPostTarget.findFirst({ where: { id: targetId, post: { organizationId: caller.organizationId, deletedAt: null } }, include: { post: true, account: { select: { displayName: true, provider: true } } } });
  if (!target) throw new NotFoundError("Publishing target not found.");
  if (!allowed.includes(target.status)) throw new ConflictError(`This target is ${target.status}; that action is not available.`);
  return target;
}

export const publishingActions = {
  /** Retry now. UNCERTAIN targets require explicit confirmation that nothing was posted. Never bypasses the gate/dry-run. */
  async retryNow(caller: SanitizedUser, targetId: string, input: { confirmNotPosted?: boolean } = {}, meta: RequestMeta = {}) {
    const t = await loadActionable(caller, targetId, ["FAILED", "MISSED", "UNCERTAIN"]);
    if (t.status === "UNCERTAIN" && !input.confirmNotPosted) throw new ValidationError("Confirm that the post is NOT on the network before retrying an uncertain publish (otherwise it may be duplicated).");
    const now = new Date();
    const moved = await prisma.socialPostTarget.updateMany({ where: { id: targetId, status: t.status }, data: { status: "SCHEDULED", scheduledAt: now, nextAttemptAt: null, attempts: 0, publishError: null } });
    if (moved.count !== 1) throw new ConflictError("This target changed; refresh and try again.");
    await prisma.socialPost.updateMany({ where: { id: t.postId, status: { in: ["FAILED", "SCHEDULED"] } }, data: { status: "SCHEDULED", scheduledAt: now } });
    await audit(caller.organizationId, "SOCIAL_PUBLISH_RETRY_REQUESTED", targetId, "SUCCESS", { from: t.status, confirmNotPosted: !!input.confirmNotPosted, postId: t.postId }, caller, meta);
    const result = await publisher.publishTarget(targetId, { manual: { actor: caller, meta } });
    return { result, target: await publishingQueries.getTarget(caller.organizationId, targetId) };
  },

  async reschedule(caller: SanitizedUser, targetId: string, input: { scheduledAt: Date; confirmNotPosted?: boolean }, meta: RequestMeta = {}) {
    const t = await loadActionable(caller, targetId);
    if (t.status === "UNCERTAIN" && !input.confirmNotPosted) throw new ValidationError("Confirm that the post is NOT on the network before rescheduling an uncertain publish.");
    if (input.scheduledAt.getTime() <= Date.now()) throw new ValidationError("Choose a future date and time.");
    const moved = await prisma.socialPostTarget.updateMany({ where: { id: targetId, status: t.status }, data: { status: "SCHEDULED", scheduledAt: input.scheduledAt, nextAttemptAt: null, attempts: 0, publishError: null } });
    if (moved.count !== 1) throw new ConflictError("This target changed; refresh and try again.");
    await prisma.socialPost.updateMany({ where: { id: t.postId, status: { in: ["FAILED", "SCHEDULED"] } }, data: { status: "SCHEDULED", scheduledAt: input.scheduledAt } });
    await audit(caller.organizationId, "SOCIAL_PUBLISH_RESCHEDULED", targetId, "SUCCESS", { from: t.status, scheduledAt: input.scheduledAt, postId: t.postId }, caller, meta);
    return publishingQueries.getTarget(caller.organizationId, targetId);
  },

  async markPublished(caller: SanitizedUser, targetId: string, input: { url: string }, meta: RequestMeta = {}) {
    const t = await loadActionable(caller, targetId);
    const url = input.url.trim();
    try { if (new URL(url).protocol !== "https:") throw new Error("protocol"); } catch { throw new ValidationError("Enter the https:// link to the live post."); }
    const moved = await prisma.socialPostTarget.updateMany({ where: { id: targetId, status: t.status }, data: { status: "PUBLISHED", publishedAt: new Date(), externalUrl: url, manualResolution: true, resolvedById: caller.id, publishError: null, nextAttemptAt: null } });
    if (moved.count !== 1) throw new ConflictError("This target changed; refresh and try again.");
    await prisma.socialPublishAttempt.create({ data: { targetId, attemptNumber: (await prisma.socialPublishAttempt.count({ where: { targetId } })) + 1, finishedAt: new Date(), outcome: "SUCCESS", errorCategory: "manual", errorMessage: "Marked as published manually.", externalUrl: url, actorUserId: caller.id } });
    await syncPostStatus(t.postId);
    await audit(caller.organizationId, "SOCIAL_PUBLISH_MARKED_MANUALLY", targetId, "SUCCESS", { from: t.status, url, postId: t.postId }, caller, meta);
    return publishingQueries.getTarget(caller.organizationId, targetId);
  },

  async cancel(caller: SanitizedUser, targetId: string, meta: RequestMeta = {}) {
    const t = await loadActionable(caller, targetId, ["FAILED", "UNCERTAIN", "MISSED", "SCHEDULED"]);
    const moved = await prisma.socialPostTarget.updateMany({ where: { id: targetId, status: t.status }, data: { status: "CANCELLED", nextAttemptAt: null } });
    if (moved.count !== 1) throw new ConflictError("This target changed (it may have started publishing); refresh and try again.");
    await syncPostStatus(t.postId);
    const remaining = await prisma.socialPostTarget.count({ where: { postId: t.postId, status: { not: "CANCELLED" } } });
    if (remaining === 0) await prisma.socialPost.update({ where: { id: t.postId }, data: { status: "CANCELLED" } });
    await audit(caller.organizationId, "SOCIAL_PUBLISH_CANCELLED", targetId, "SUCCESS", { from: t.status, postId: t.postId }, caller, meta);
    return publishingQueries.getTarget(caller.organizationId, targetId);
  },
};

const ROW_INCLUDE = {
  post: { select: { id: true, title: true, body: true, status: true, scheduledAt: true, timezone: true, linkUrl: true, mediaIds: true } },
  account: { select: { id: true, provider: true, displayName: true, handle: true, avatarUrl: true, accountType: true, status: true } },
} satisfies Prisma.SocialPostTargetInclude;

const project = (t: Prisma.SocialPostTargetGetPayload<{ include: typeof ROW_INCLUDE }>) => ({
  id: t.id, status: t.status, scheduledAt: t.scheduledAt, nextAttemptAt: t.nextAttemptAt, attempts: t.attempts, publishedAt: t.publishedAt, externalPostId: t.externalPostId, externalUrl: t.externalUrl,
  error: t.publishError ? redactSecrets(t.publishError).slice(0, 300) : null, manualResolution: t.manualResolution, post: t.post, account: t.account,
});

export const publishingQueries = {
  async queue(organizationId: string) {
    const rows = await prisma.socialPostTarget.findMany({
      where: { status: { in: ["SCHEDULED", "PUBLISHING"] }, post: { organizationId, deletedAt: null } },
      include: ROW_INCLUDE, orderBy: [{ status: "desc" }, { scheduledAt: "asc" }], take: 200,
    });
    return { items: rows.map(project), now: new Date().toISOString() };
  },

  async failures(organizationId: string, q: { status?: "FAILED" | "UNCERTAIN" | "MISSED" } = {}) {
    const rows = await prisma.socialPostTarget.findMany({
      where: { status: q.status ? q.status : { in: ACTIONABLE }, post: { organizationId, deletedAt: null } },
      include: ROW_INCLUDE, orderBy: { updatedAt: "desc" }, take: 200,
    });
    return { items: rows.map(project) };
  },

  async getTarget(organizationId: string, id: string) {
    const t = await prisma.socialPostTarget.findFirst({ where: { id, post: { organizationId, deletedAt: null } }, include: { ...ROW_INCLUDE, publishAttempts: { orderBy: { startedAt: "asc" }, take: 100 } } });
    if (!t) throw new NotFoundError("Publishing target not found.");
    const { publishAttempts, ...rest } = t;
    return {
      ...project(rest),
      attemptLog: publishAttempts.map((a) => ({
        id: a.id, attemptNumber: a.attemptNumber, startedAt: a.startedAt, finishedAt: a.finishedAt, outcome: a.outcome, errorCategory: a.errorCategory,
        error: a.errorMessage ? redactSecrets(a.errorMessage).slice(0, 300) : null, externalPostId: a.externalPostId, externalUrl: a.externalUrl, httpStatus: a.httpStatus, durationMs: a.durationMs, dryRun: a.dryRun,
      })),
    };
  },

  /** Counters for the Social Overview + the headline "oldest due-but-unpublished" figure. */
  async metrics(organizationId: string, now = new Date()) {
    const since = new Date(now.getTime() - 24 * 3600_000);
    const inOrg = { post: { organizationId, deletedAt: null } };
    const [oldestDue, queued, failures, attempts] = await Promise.all([
      prisma.socialPostTarget.findFirst({ where: { status: "SCHEDULED", scheduledAt: { lte: now }, ...inOrg }, orderBy: { scheduledAt: "asc" }, select: { scheduledAt: true } }),
      prisma.socialPostTarget.count({ where: { status: { in: ["SCHEDULED", "PUBLISHING"] }, ...inOrg } }),
      prisma.socialPostTarget.count({ where: { status: { in: ACTIONABLE }, ...inOrg } }),
      prisma.socialPublishAttempt.groupBy({ by: ["outcome"], where: { startedAt: { gte: since }, target: inOrg }, _count: { _all: true } }),
    ]);
    const count = (o: string) => attempts.find((a) => a.outcome === o)?._count._all ?? 0;
    return {
      queued, needsAttention: failures,
      oldestDueAt: oldestDue?.scheduledAt ?? null,
      oldestDueSeconds: oldestDue?.scheduledAt ? Math.max(0, Math.round((now.getTime() - oldestDue.scheduledAt.getTime()) / 1000)) : null,
      last24h: { published: count("SUCCESS"), failed: count("PERMANENT_FAILURE") + count("AUTH_FAILURE"), retried: count("TRANSIENT_FAILURE"), uncertain: count("UNCERTAIN"), dryRun: count("DRY_RUN") },
    };
  },

  failureCount: (organizationId: string) => prisma.socialPostTarget.count({ where: { status: { in: ACTIONABLE }, post: { organizationId, deletedAt: null } } }),
};

