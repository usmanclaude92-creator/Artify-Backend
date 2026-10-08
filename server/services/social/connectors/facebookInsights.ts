/**
 * Facebook Page analytics (READ-ONLY). Needs `read_insights` + `pages_read_engagement` and a Page token (docs/SOCIAL_ANALYTICS.md §1.1).
 * Metric names follow the CURRENT reference: impressions and page fans were retired (replaced by views), so they are never requested.
 * Every metric is fetched on its own: one the API rejects becomes UNAVAILABLE (null + reason) without hiding the others.
 * Missing permission (auth) and rate limits (transient) are rethrown for the job to record.
 */
import type { SocialTokenSet } from "../tokenVault";
import { graph } from "./metaGraph";
import { addDays, chunkRange, isMetricRefusal, isPermissionFailure, noteFrom, parseSeries, parseSingleValue, unixSeconds } from "./metaInsights";
import type { ConnectorAnalytics, DailyPoint, DailySeries, PostMetricValue } from "./types";

/** canonical key → current Page Insights metric. [ ] `page_views_total` and the June-2026 removals are not confirmed by any current excerpt. */
export const FB_DAILY_METRICS: Record<string, string> = {
  views: "page_media_view",
  reach: "page_total_media_view_unique",
  engagement: "page_post_engagements",
  follows_new: "page_daily_follows_unique",
  unfollows: "page_daily_unfollows_unique",
  profile_views: "page_views_total",
};

const FB_POST_INSIGHTS: Record<string, string> = { views: "post_media_view", reach: "post_total_media_view_unique" };
const MAX_DAYS_PER_REQUEST = 90; // Page insights since/until window limit

export const facebookAnalytics: ConnectorAnalytics = {
  dailyMetrics: Object.keys(FB_DAILY_METRICS),
  historyDays: 90,
  audienceDimensions: [],

  async fetchFollowers(tokens: SocialTokenSet, { accountExternalId }) {
    const r = await graph<{ followers_count?: number; fan_count?: number }>({ method: "GET", path: `/${accountExternalId}`, token: tokens.accessToken, phase: "read", query: { fields: "followers_count,fan_count" } });
    const v = r.json.followers_count ?? r.json.fan_count;
    return typeof v === "number" ? v : null;
  },

  async fetchDailyMetric(tokens: SocialTokenSet, { accountExternalId, metric, from, to }): Promise<DailySeries> {
    const network = FB_DAILY_METRICS[metric];
    if (!network) return { status: "UNAVAILABLE", points: [], note: "This metric is not offered for Facebook Pages." };
    const points = new Map<string, DailyPoint>();
    try {
      for (const chunk of chunkRange(from, to, MAX_DAYS_PER_REQUEST)) {
        const r = await graph({
          method: "GET", path: `/${accountExternalId}/insights`, token: tokens.accessToken, phase: "read",
          query: { metric: network, period: "day", since: String(unixSeconds(chunk.from)), until: String(unixSeconds(addDays(chunk.to, 1))) },
        });
        for (const p of parseSeries(r.json) ?? []) points.set(p.date, p);
      }
    } catch (err) {
      if (isMetricRefusal(err)) return { status: "UNAVAILABLE", points: [], note: noteFrom(err) };
      throw err;
    }
    if (points.size === 0) return { status: "UNAVAILABLE", points: [], note: "Meta returned no data for this metric in the requested period." };
    return { status: "OK", points: [...points.values()].sort((a, b) => a.date.localeCompare(b.date)) };
  },

  async fetchPostMetrics(tokens: SocialTokenSet, { externalPostId }): Promise<PostMetricValue[]> {
    const out: PostMetricValue[] = [];
    // Plain post fields (no Insights permission). `shares` is omitted by Meta when there are none, so absence is null, not 0.
    const post = await graph<{ reactions?: { summary?: { total_count?: number } }; comments?: { summary?: { total_count?: number } }; shares?: { count?: number } }>({
      method: "GET", path: `/${externalPostId}`, token: tokens.accessToken, phase: "read", query: { fields: "reactions.summary(true).limit(0),comments.summary(true).limit(0),shares" },
    });
    const likes = post.json.reactions?.summary?.total_count;
    const comments = post.json.comments?.summary?.total_count;
    const shares = post.json.shares?.count;
    out.push({ metric: "likes", value: typeof likes === "number" ? likes : null, status: typeof likes === "number" ? "OK" : "UNAVAILABLE", ...(typeof likes === "number" ? {} : { note: "Meta did not return reactions." }) });
    out.push({ metric: "comments", value: typeof comments === "number" ? comments : null, status: typeof comments === "number" ? "OK" : "UNAVAILABLE", ...(typeof comments === "number" ? {} : { note: "Meta did not return comments." }) });
    out.push({ metric: "shares", value: typeof shares === "number" ? shares : null, status: typeof shares === "number" ? "OK" : "UNAVAILABLE", ...(typeof shares === "number" ? {} : { note: "Meta omits the share count when it has none to report." }) });
    for (const [key, network] of Object.entries(FB_POST_INSIGHTS)) {
      try {
        const r = await graph({ method: "GET", path: `/${externalPostId}/insights`, token: tokens.accessToken, phase: "read", query: { metric: network } });
        const v = parseSingleValue(r.json);
        out.push(v === null ? { metric: key, value: null, status: "UNAVAILABLE", note: "Meta returned no value." } : { metric: key, value: v, status: "OK" });
      } catch (err) {
        if (!isMetricRefusal(err) && !isPermissionFailure(err)) throw err;
        out.push({ metric: key, value: null, status: "UNAVAILABLE", note: isPermissionFailure(err) ? "Insights permission is missing. Reconnect the account after enabling it." : noteFrom(err) });
      }
    }
    return out;
  },

  // Page demographics were not confirmed in any current Meta excerpt: not read (see docs/SOCIAL_ANALYTICS.md §1.1).
  async fetchAudience() { return []; },
};

