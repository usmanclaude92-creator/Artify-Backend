/**
 * Social analytics ingestion — a READ-ONLY daily job (no write call to any network).
 *
 *  - Runs inside the existing scheduler tick (/automation/internal/tick, pinged every 5 minutes), self-gated to ONE successful run per account per UTC day.
 *    A backfill that does not fit the time budget simply continues on the next tick.
 *  - Kill switches (same pattern as inbox replies): env SOCIAL_ANALYTICS_DISABLED, plus the publishing global/workspace kill switch. Nothing is read while one is engaged.
 *  - Idempotent and append-only: UNIQUE(account, day, metric). A stored number is never replaced; a stored NULL may be upgraded to a real number, nothing else.
 *  - A metric the network does not provide is a NULL row (status UNAVAILABLE + reason) or a `capabilities` entry — never 0.
 *  - Only COMPLETED UTC days are stored for daily metrics, and "yesterday" only after 06:00 UTC (Meta refreshes most metrics once per 24 h).
 */
import { Prisma } from "@prisma/client";
import { prisma } from "../../../db/prisma";
import { config } from "../../../config/env";
import { logger } from "../../../core/logger";
import { NotFoundError } from "../../../core/errors";
import { auditLogRepository } from "../../../repositories/auditLogRepository";
import { connectorRegistry } from "../connectors/registry";
import { addDays, dayString, parseDay, startOfUtcDay } from "../connectors/metaInsights";
import type { AudienceResult, ConnectorAnalytics, DailySeries, PostMetricValue } from "../connectors/types";
import { SocialPublishError } from "../publishing/publishErrors";
import { publishingSettingsService } from "../publishing/publishingSettingsService";
import { socialAccountService } from "../socialAccountService";
import { redactSecrets } from "../tokenVault";
import type { SanitizedUser } from "../../../types/domain";
import type { RequestMeta } from "../../authService";

const RETRY_BACKOFF_MS = 3 * 3600_000;
const RECHECK_UNAVAILABLE_MS = 7 * 86_400_000;
const AUDIENCE_EVERY_MS = 7 * 86_400_000;
const POST_WINDOW_DAYS = 90;
const POSTS_PER_RUN = 25;
// The function limit is 30 s and the tick runs several jobs side by side, so one pass is short; a backfill continues on the next tick.
const DEFAULT_BUDGET_MS = 10_000;
const REFRESH_BUDGET_MS = 15_000;
const MAX_ACCOUNTS_PER_TICK = 2;
const INSERT_CHUNK = 400;

/** `from`/`through`: the span of days already REQUESTED from the network for this metric (the API returns nothing for days before the data starts, so absence of rows is not "missing"). */
export interface CapabilityEntry { status: "OK" | "UNAVAILABLE"; reason?: string; checkedAt: string; from?: string; through?: string }
export interface Capabilities { daily: Record<string, CapabilityEntry>; audience?: CapabilityEntry; permission?: { status: "MISSING"; reason: string; checkedAt: string } }

export interface AccountRunResult {
  accountId: string;
  outcome: "completed" | "partial" | "skipped" | "error";
  reason?: string;
  daysStored: number;
  postsSnapshotted: number;
  audienceStored: number;
}

interface AccountRow { date: string; metric: string; value: number | null; status: "OK" | "UNAVAILABLE"; note?: string | null }
interface PostRow { targetId: string; metric: string; value: number | null; status: "OK" | "UNAVAILABLE"; note?: string | null }

const safe = (err: unknown): string => redactSecrets(err).replace(/\s+/g, " ").slice(0, 300);
const nowUtc = () => Prisma.sql`(now() at time zone 'utc')`;

/** Inserts rows; an existing real number is never touched, an existing NULL is upgraded when the network now provides a value. */
export async function storeAccountMetrics(organizationId: string, socialAccountId: string, rows: AccountRow[]): Promise<number> {
  let stored = 0;
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    const part = rows.slice(i, i + INSERT_CHUNK);
    stored += await prisma.$executeRaw(Prisma.sql`
      INSERT INTO social_account_metrics (id, organization_id, social_account_id, metric_date, metric, value, status, note, captured_at)
      VALUES ${Prisma.join(part.map((r) => Prisma.sql`(gen_random_uuid()::text, ${organizationId}, ${socialAccountId}, ${r.date}::date, ${r.metric}, ${r.value}::double precision, ${r.status}, ${r.note ?? null}, ${nowUtc()})`))}
      ON CONFLICT (social_account_id, metric_date, metric) DO UPDATE
        SET value = EXCLUDED.value, status = EXCLUDED.status, note = EXCLUDED.note, captured_at = EXCLUDED.captured_at
        WHERE social_account_metrics.value IS NULL AND EXCLUDED.value IS NOT NULL`);
  }
  return stored;
}

export async function storePostMetrics(organizationId: string, socialAccountId: string, capturedOn: string, rows: PostRow[]): Promise<number> {
  let stored = 0;
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    const part = rows.slice(i, i + INSERT_CHUNK);
    stored += await prisma.$executeRaw(Prisma.sql`
      INSERT INTO social_post_metrics (id, organization_id, social_account_id, target_id, captured_on, metric, value, status, note, captured_at)
      VALUES ${Prisma.join(part.map((r) => Prisma.sql`(gen_random_uuid()::text, ${organizationId}, ${socialAccountId}, ${r.targetId}, ${capturedOn}::date, ${r.metric}, ${r.value}::double precision, ${r.status}, ${r.note ?? null}, ${nowUtc()})`))}
      ON CONFLICT (target_id, captured_on, metric) DO UPDATE
        SET value = EXCLUDED.value, status = EXCLUDED.status, note = EXCLUDED.note, captured_at = EXCLUDED.captured_at
        WHERE social_post_metrics.value IS NULL AND EXCLUDED.value IS NOT NULL`);
  }
  return stored;
}

async function storeAudience(organizationId: string, socialAccountId: string, capturedOn: string, results: AudienceResult[]): Promise<number> {
  let stored = 0;
  for (const r of results) {
    stored += await prisma.$executeRaw(Prisma.sql`
      INSERT INTO social_audience_snapshots (id, organization_id, social_account_id, captured_on, dimension, buckets, status, reason, captured_at)
      VALUES (gen_random_uuid()::text, ${organizationId}, ${socialAccountId}, ${capturedOn}::date, ${r.dimension}, ${r.buckets ? JSON.stringify(r.buckets) : null}::jsonb, ${r.status}, ${r.reason ?? null}, ${nowUtc()})
      ON CONFLICT (social_account_id, captured_on, dimension) DO NOTHING`);
  }
  return stored;
}

const toRows = (metric: string, series: DailySeries, window: { from: string; to: string }): AccountRow[] =>
  series.points
    .filter((p) => p.date >= window.from && p.date <= window.to)
    .map((p) => (p.value === null ? { date: p.date, metric, value: null, status: "UNAVAILABLE" as const, note: "The network returned no value for this day." } : { date: p.date, metric, value: p.value, status: "OK" as const }));

async function loadCapabilities(accountId: string): Promise<{ id: string | null; caps: Capabilities }> {
  const row = await prisma.socialAnalyticsState.findUnique({ where: { socialAccountId: accountId } });
  const raw = (row?.capabilities ?? null) as Partial<Capabilities> | null;
  return { id: row?.id ?? null, caps: { daily: raw?.daily ?? {}, audience: raw?.audience, permission: raw?.permission } };
}

export const analyticsIngest = {
  /** Which accounts are due now (exported for tests). */
  async dueAccounts(now: Date, limit = MAX_ACCOUNTS_PER_TICK) {
    const today = startOfUtcDay(now);
    const accounts = await prisma.socialAccount.findMany({ where: { status: "CONNECTED" }, include: { analyticsState: true }, take: 200 });
    return accounts
      .filter((a) => {
        const c = connectorRegistry.getAvailable(a.provider);
        if (!c?.analytics) return false;
        const st = a.analyticsState;
        if (!st) return true;
        if (st.lastRunAt && st.lastRunAt.getTime() > now.getTime() - 90_000) return false; // another pass just ran
        if (st.lastError && st.lastRunAt && st.lastRunAt.getTime() > now.getTime() - RETRY_BACKOFF_MS) return false;
        return !(st.lastSuccessAt && st.lastSuccessAt.getTime() >= today.getTime());
      })
      .sort((a, b) => (a.analyticsState?.lastRunAt?.getTime() ?? 0) - (b.analyticsState?.lastRunAt?.getTime() ?? 0))
      .slice(0, limit);
  },

  /** One scheduler pass. Counts only; never throws (the tick shares a cron entry with other jobs). */
  async tick(now = new Date(), opts: { budgetMs?: number; maxAccounts?: number } = {}) {
    const out = { due: 0, completed: 0, partial: 0, errors: 0, skipped: 0, disabled: config.socialAnalyticsDisabled };
    if (config.socialAnalyticsDisabled) return out;
    const started = Date.now();
    const budget = opts.budgetMs ?? DEFAULT_BUDGET_MS;
    try {
      const due = await this.dueAccounts(now, opts.maxAccounts ?? MAX_ACCOUNTS_PER_TICK);
      out.due = due.length;
      for (const a of due) {
        const left = budget - (Date.now() - started);
        if (left < 2_000) break;
        const r = await this.runAccount(a.id, now, { budgetMs: left }).catch((err): AccountRunResult => ({ accountId: a.id, outcome: "error", reason: safe(err), daysStored: 0, postsSnapshotted: 0, audienceStored: 0 }));
        if (r.outcome === "completed") out.completed += 1;
        else if (r.outcome === "partial") out.partial += 1;
        else if (r.outcome === "skipped") out.skipped += 1;
        else out.errors += 1;
      }
    } catch (err) {
      logger.error({ err: safe(err) }, "[social-analytics] tick failed");
      out.errors += 1;
    }
    return out;
  },

  async runAccount(accountId: string, now = new Date(), opts: { budgetMs?: number } = {}): Promise<AccountRunResult> {
    const started = Date.now();
    const budget = opts.budgetMs ?? DEFAULT_BUDGET_MS;
    const timeLeft = () => budget - (Date.now() - started);
    const result: AccountRunResult = { accountId, outcome: "completed", daysStored: 0, postsSnapshotted: 0, audienceStored: 0 };

    const account = await prisma.socialAccount.findUnique({ where: { id: accountId } });
    if (!account || account.status !== "CONNECTED") return { ...result, outcome: "skipped", reason: "account_unavailable" };
    const connector = connectorRegistry.getAvailable(account.provider);
    const analytics: ConnectorAnalytics | undefined = connector?.analytics;
    if (!analytics) return { ...result, outcome: "skipped", reason: "no_analytics" };
    if (config.socialAnalyticsDisabled) return { ...result, outcome: "skipped", reason: "env_disabled" };
    const killed = await publishingSettingsService.killed(account.organizationId);
    if (killed.killed) return { ...result, outcome: "skipped", reason: killed.reason };

    // Claim: record the run first so an overlapping tick cannot start the same account.
    await prisma.socialAnalyticsState.upsert({ where: { socialAccountId: accountId }, create: { socialAccountId: accountId, firstSyncAt: now, lastRunAt: now, historyLimitDays: analytics.historyDays }, update: { lastRunAt: now, historyLimitDays: analytics.historyDays } });
    const { caps } = await loadCapabilities(accountId);
    const nowIso = now.toISOString();
    let lastError: string | null = null;
    let complete = true;
    let permissionMissing = false;

    let tokens;
    try {
      tokens = await socialAccountService.loadTokens(accountId);
    } catch { tokens = null; }
    if (!tokens) {
      await prisma.socialAnalyticsState.update({ where: { socialAccountId: accountId }, data: { lastError: "Stored credentials could not be read. Reconnect the account." } });
      return { ...result, outcome: "error", reason: "credentials" };
    }

    const today = startOfUtcDay(now);
    const todayStr = dayString(today);
    // "Yesterday" is only final after 06:00 UTC.
    const lastFinalDay = addDays(today, now.getUTCHours() < 6 ? -2 : -1);
    const lastFinalStr = dayString(lastFinalDay);
    const windowFrom = addDays(today, -analytics.historyDays);
    const windowFromStr = dayString(windowFrom);
    const orgId = account.organizationId;
    const ctx = { accountExternalId: account.externalAccountId };

    try {
      // 1) Followers right now (plain field; needs no Insights permission).
      let followers: number | null = null;
      try {
        followers = await analytics.fetchFollowers(tokens, ctx);
        if (followers !== null) result.daysStored += await storeAccountMetrics(orgId, accountId, [{ date: todayStr, metric: "followers", value: followers, status: "OK" }]);
        else await storeAccountMetrics(orgId, accountId, [{ date: todayStr, metric: "followers", value: null, status: "UNAVAILABLE", note: "The network did not return a follower count." }]);
      } catch (err) {
        if (err instanceof SocialPublishError && err.kind === "transient") throw err;
        lastError = safe(err);
      }

      // 2) Daily metrics, only the days we do not have yet.
      if (!permissionMissing && lastFinalStr >= windowFromStr) {
        for (const metric of analytics.dailyMetrics) {
          if (timeLeft() < 2_000) { complete = false; break; }
          const known = caps.daily[metric];
          if (known?.status === "UNAVAILABLE" && Date.now() - Date.parse(known.checkedAt) < RECHECK_UNAVAILABLE_MS && Date.parse(known.checkedAt) >= account.updatedAt.getTime()) continue; // refused recently: re-check weekly, or at once when the account was reconnected since
          // Only ask for days not requested before: the whole window the first time, then just the days since the last request.
          const askedBack = !!known?.from && known.from <= windowFromStr;
          const wantFrom = askedBack && known?.through ? dayString(addDays(parseDay(known.through), 1)) : windowFromStr;
          if (wantFrom > lastFinalStr) continue;
          try {
            const series = await analytics.fetchDailyMetric(tokens, { ...ctx, metric, from: parseDay(wantFrom), to: lastFinalDay });
            caps.daily[metric] = series.status === "OK"
              ? { status: "OK", checkedAt: nowIso, from: askedBack ? known!.from : wantFrom, through: lastFinalStr }
              : { status: "UNAVAILABLE", reason: series.note ?? "Not provided by the network.", checkedAt: nowIso };
            if (series.status === "OK") result.daysStored += await storeAccountMetrics(orgId, accountId, toRows(metric, series, { from: windowFromStr, to: lastFinalStr }));
          } catch (err) {
            if (err instanceof SocialPublishError && err.kind === "auth") {
              permissionMissing = true;
              caps.permission = { status: "MISSING", reason: "The network refused the insights request: the Insights permission is missing or was revoked. Enable it in the Meta app, then reconnect the account.", checkedAt: nowIso };
              break;
            }
            throw err;
          }
        }
        if (!permissionMissing && caps.permission) delete caps.permission;
      }

      // 3) Per-post snapshots for published posts (daily for 30 days, then weekly up to 90).
      if (timeLeft() > 3_000) {
        const since = addDays(today, -POST_WINDOW_DAYS);
        const targets = await prisma.socialPostTarget.findMany({
          where: { socialAccountId: accountId, status: "PUBLISHED", externalPostId: { not: null }, publishedAt: { gte: since } },
          select: { id: true, externalPostId: true, publishedAt: true },
          orderBy: { publishedAt: "desc" }, take: 200,
        });
        const recentSnaps = await prisma.socialPostMetric.groupBy({ by: ["targetId"], where: { socialAccountId: accountId, targetId: { in: targets.map((t) => t.id) } }, _max: { capturedOn: true } });
        const lastSnap = new Map(recentSnaps.map((r) => [r.targetId, r._max.capturedOn ? dayString(r._max.capturedOn) : null]));
        const due = targets.filter((t) => {
          const last = lastSnap.get(t.id) ?? null;
          if (last === todayStr) return false;
          if (!last) return true;
          const ageDays = Math.floor((today.getTime() - startOfUtcDay(t.publishedAt!).getTime()) / 86_400_000);
          return ageDays <= 30 || Math.floor((today.getTime() - parseDay(last).getTime()) / 86_400_000) >= 7;
        }).slice(0, POSTS_PER_RUN);
        for (const t of due) {
          if (timeLeft() < 1_500) { complete = false; break; }
          let metrics: PostMetricValue[];
          try {
            metrics = await analytics.fetchPostMetrics(tokens, { ...ctx, externalPostId: t.externalPostId! });
          } catch (err) {
            if (err instanceof SocialPublishError && err.kind === "transient") throw err;
            // e.g. the post was deleted on the network: record nothing, keep going.
            lastError = lastError ?? safe(err);
            continue;
          }
          result.postsSnapshotted += 1;
          await storePostMetrics(orgId, accountId, todayStr, metrics.map((m) => ({ targetId: t.id, metric: m.metric, value: m.value, status: m.status, note: m.note })));
        }
        if (due.length > POSTS_PER_RUN) complete = false;
      }

      // 4) Audience demographics, at most weekly, only for networks that offer them.
      if (analytics.audienceDimensions.length > 0 && timeLeft() > 3_000) {
        const last = await prisma.socialAudienceSnapshot.findFirst({ where: { socialAccountId: accountId }, orderBy: { capturedAt: "desc" }, select: { capturedAt: true } });
        if (!last || Date.now() - last.capturedAt.getTime() >= AUDIENCE_EVERY_MS) {
          try {
            const aud = await analytics.fetchAudience(tokens, { ...ctx, followers });
            result.audienceStored += await storeAudience(orgId, accountId, todayStr, aud);
            const ok = aud.some((a) => a.status === "OK");
            caps.audience = ok ? { status: "OK", checkedAt: nowIso } : { status: "UNAVAILABLE", reason: aud.find((a) => a.reason)?.reason ?? "No demographic data returned.", checkedAt: nowIso };
          } catch (err) {
            if (err instanceof SocialPublishError && err.kind === "auth") caps.audience = { status: "UNAVAILABLE", reason: "The Insights permission is missing. Reconnect after enabling it.", checkedAt: nowIso };
            else throw err;
          }
        }
      } else if (analytics.audienceDimensions.length > 0) complete = false;
    } catch (err) {
      lastError = safe(err);
      result.outcome = "error";
      result.reason = lastError;
      complete = false;
      logger.warn({ accountId, provider: account.provider, err: lastError }, "[social-analytics] account run failed");
    }

    const first = await prisma.socialAccountMetric.aggregate({ where: { socialAccountId: accountId, metric: { not: "followers" }, value: { not: null } }, _min: { metricDate: true } });
    const finished = result.outcome !== "error" && complete;
    await prisma.socialAnalyticsState.update({
      where: { socialAccountId: accountId },
      data: {
        capabilities: caps as unknown as Prisma.InputJsonValue,
        backfillFrom: first._min.metricDate ?? null,
        lastError: permissionMissing ? "The Insights permission is missing. Reconnect the account after enabling it in the Meta app." : lastError,
        ...(finished ? { lastSuccessAt: now } : {}),
      },
    });
    // An unfinished run must stay due for the next tick even when an earlier run succeeded today (e.g. a manual refresh after a reconnect).
    if (!finished) await prisma.socialAnalyticsState.updateMany({ where: { socialAccountId: accountId, lastSuccessAt: { gte: today } }, data: { lastSuccessAt: new Date(today.getTime() - 1) } });
    if (result.outcome !== "error") result.outcome = finished ? "completed" : "partial";
    return result;
  },

  /** "Refresh now" for one account (social.accounts.manage). Ignores the once-a-day gate but never the kill switches. */
  async refreshNow(caller: SanitizedUser, accountId: string, meta: RequestMeta = {}) {
    const account = await prisma.socialAccount.findFirst({ where: { id: accountId, organizationId: caller.organizationId }, select: { id: true } });
    if (!account) throw new NotFoundError("Social account not found.");
    const result = await this.runAccount(accountId, new Date(), { budgetMs: REFRESH_BUDGET_MS });
    await auditLogRepository.record({
      organizationId: caller.organizationId, actorUserId: caller.id, actorType: "USER", action: "SOCIAL_ANALYTICS_REFRESHED", resourceType: "social_account", resourceId: accountId,
      metadata: { outcome: result.outcome, reason: result.reason ?? null, days: result.daysStored, posts: result.postsSnapshotted }, ipAddress: meta.ip, userAgent: meta.userAgent,
    }).catch(() => undefined);
    return result;
  },
};
