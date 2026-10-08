/** Scheduler side of listening: the polling fallback for mentions/tags (behind SOCIAL_LISTENING_POLLING) and the daily review-rating snapshot. Read-only; never throws. */
import { prisma } from "../../../db/prisma";
import { config } from "../../../config/env";
import { logger } from "../../../core/logger";
import { connectorRegistry } from "../connectors/registry";
import { socialAccountService } from "../socialAccountService";
import { SocialPublishError } from "../publishing/publishErrors";
import { ingestEvent } from "../inbox/inboxPipeline";
import { getInboxSettings, safeText } from "../inbox/inboxCore";

const MAX_EVENTS_PER_POLL = 100;
const POLL_EVERY_MS = 4 * 60_000;
const ERROR_BACKOFF_MS = 30 * 60_000;
const dayOf = (d: Date) => d.toISOString().slice(0, 10);

/** Lists mentions/tags for connectors that can (flag-gated). At most one poll per account every 4 minutes, 30 minutes after an error. */
export async function pollListening(now = new Date(), limit = 10): Promise<{ polled: number; events: number }> {
  const out = { polled: 0, events: 0 };
  if (!config.socialListeningPolling || config.socialListeningDisabled) return out;
  const accounts = await prisma.socialAccount.findMany({ where: { status: "CONNECTED" }, include: { listeningCursor: true }, take: 200 });
  for (const account of accounts) {
    if (out.polled >= limit) break;
    const connector = connectorRegistry.getAvailable(account.provider);
    if (!connector?.fetchMentions) continue;
    const c = account.listeningCursor;
    if (c && c.polledAt.getTime() > now.getTime() - (c.lastError ? ERROR_BACKOFF_MS : POLL_EVERY_MS)) continue;
    out.polled += 1;
    try {
      const tokens = await socialAccountService.loadTokens(account.id);
      if (!tokens) continue;
      const res = await connector.fetchMentions(tokens, { accountExternalId: account.externalAccountId, cursor: c?.cursor ?? undefined });
      const settings = await getInboxSettings(account.organizationId);
      for (const ev of res.events.slice(0, MAX_EVENTS_PER_POLL)) {
        if (ev.accountExternalId !== account.externalAccountId) continue;
        if (!(await ingestEvent(account, ev, settings)).duplicate) out.events += 1;
      }
      await prisma.socialListeningCursor.upsert({ where: { socialAccountId: account.id }, create: { socialAccountId: account.id, cursor: res.nextCursor ?? null }, update: { cursor: res.nextCursor ?? null, polledAt: now, lastError: null } });
    } catch (err) {
      const msg = safeText(err);
      logger.warn({ accountId: account.id, err: msg }, "[social-listening] poll failed");
      await prisma.socialListeningCursor.upsert({ where: { socialAccountId: account.id }, create: { socialAccountId: account.id, lastError: msg }, update: { polledAt: now, lastError: msg } }).catch(() => undefined);
    }
  }
  return out;
}

/** One row per account per UTC day, never overwritten. An absent value is stored as NULL with the reason (never 0). */
export async function snapshotReviews(now = new Date(), limit = 5): Promise<{ stored: number; skipped: number }> {
  const out = { stored: 0, skipped: 0 };
  if (config.socialListeningDisabled) return out;
  const today = new Date(`${dayOf(now)}T00:00:00.000Z`);
  const accounts = await prisma.socialAccount.findMany({ where: { status: "CONNECTED" }, take: 200 });
  for (const account of accounts) {
    if (out.stored >= limit) break;
    const connector = connectorRegistry.getAvailable(account.provider);
    if (!connector?.fetchReviewSummary) continue;
    const exists = await prisma.socialReviewSnapshot.findUnique({ where: { socialAccountId_capturedOn: { socialAccountId: account.id, capturedOn: today } }, select: { id: true } });
    if (exists) { out.skipped += 1; continue; }
    try {
      const tokens = await socialAccountService.loadTokens(account.id);
      if (!tokens) continue;
      const s = await connector.fetchReviewSummary(tokens, { accountExternalId: account.externalAccountId });
      const has = s.averageRating !== null || s.reviewCount !== null;
      await prisma.socialReviewSnapshot.createMany({
        data: [{ organizationId: account.organizationId, socialAccountId: account.id, capturedOn: today, averageRating: s.averageRating, reviewCount: s.reviewCount, status: has ? "OK" : "UNAVAILABLE", note: has ? null : s.note ?? "The network returned no rating." }],
        skipDuplicates: true,
      });
      out.stored += 1;
    } catch (err) {
      // transient/auth: nothing stored (an error is not a rating); the next tick tries again.
      if (!(err instanceof SocialPublishError && err.kind === "transient")) logger.warn({ accountId: account.id, err: safeText(err) }, "[social-listening] review snapshot failed");
    }
  }
  return out;
}

export const listeningJobs = {
  /** One scheduler pass (called from the automation tick). */
  async tick(now = new Date()) {
    const out = { polled: { polled: 0, events: 0 }, snapshots: { stored: 0, skipped: 0 }, disabled: config.socialListeningDisabled };
    if (config.socialListeningDisabled) return out;
    out.polled = await pollListening(now).catch((err) => { logger.error({ err: safeText(err) }, "[social-listening] poll step failed"); return out.polled; });
    out.snapshots = await snapshotReviews(now).catch((err) => { logger.error({ err: safeText(err) }, "[social-listening] snapshot step failed"); return out.snapshots; });
    return out;
  },
};
