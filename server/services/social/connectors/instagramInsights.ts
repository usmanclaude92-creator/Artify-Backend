/**
 * Instagram analytics (READ-ONLY), Instagram API with Facebook Login. Needs `instagram_manage_insights` (+ instagram_basic, pages_read_engagement).
 * `impressions`/`plays` are retired (replaced by `views`), so they are never requested. Several current names/modes could not be confirmed from
 * Meta's excerpts (docs/SOCIAL_ANALYTICS.md §1.2 [ ]), so each metric is probed defensively: time-series first; if Meta asks for
 * `metric_type=total_value`, one request per day; if it refuses, the metric is UNAVAILABLE (null + Meta's reason), never 0.
 */
import type { SocialTokenSet } from "../tokenVault";
import { graph } from "./metaGraph";
import { addDays, chunkRange, dayString, isMetricRefusal, isPermissionFailure, noteFrom, parseBreakdown, parseLifetimeMap, parseSeries, parseSingleValue, parseTotalValue, unixSeconds } from "./metaInsights";
import type { AudienceBucket, AudienceDimension, AudienceResult, ConnectorAnalytics, DailyPoint, DailySeries, PostMetricValue } from "./types";

/** canonical key → current Instagram user-insights metric. */
export const IG_DAILY_METRICS: Record<string, string> = {
  views: "views",
  reach: "reach",
  engagement: "total_interactions",
  profile_views: "profile_views",
  link_clicks: "website_clicks",
  follows_new: "follower_count",
};

const IG_POST_INSIGHTS: Record<string, string> = { reach: "reach", views: "views", saves: "saved", shares: "shares", interactions: "total_interactions" };
const MAX_DAYS_PER_REQUEST = 30;
const FOLLOWER_THRESHOLD = 100;
/** New demographics breakdown names first, legacy lifetime metrics as fallback. [ ] neither confirmed from current excerpts. */
const DEMOGRAPHICS: Array<{ dimension: AudienceDimension; breakdown: string; legacy: string }> = [
  { dimension: "age_gender", breakdown: "age,gender", legacy: "audience_gender_age" },
  { dimension: "country", breakdown: "country", legacy: "audience_country" },
  { dimension: "city", breakdown: "city", legacy: "audience_city" },
  { dimension: "locale", breakdown: "locale", legacy: "audience_locale" },
];

const wantsTotalValue = (err: unknown): boolean => err instanceof Error && /metric_type|total_value/i.test(err.message);

/** One request per day (Meta only offers `total_value` for some metrics). Six at a time so 30 days fit the job's time budget; results keep day order. */
const PER_DAY_PARALLEL = 6;
async function perDayTotals(token: string, ig: string, metric: string, from: Date, to: Date): Promise<DailyPoint[]> {
  const days: Date[] = [];
  for (let d = from; d.getTime() <= to.getTime(); d = addDays(d, 1)) days.push(d);
  const out: DailyPoint[] = [];
  for (let i = 0; i < days.length; i += PER_DAY_PARALLEL) {
    const batch = await Promise.all(days.slice(i, i + PER_DAY_PARALLEL).map(async (d): Promise<DailyPoint> => {
      const r = await graph({ method: "GET", path: `/${ig}/insights`, token, phase: "read", query: { metric, metric_type: "total_value", period: "day", since: String(unixSeconds(d)), until: String(unixSeconds(addDays(d, 1))) } });
      return { date: dayString(d), value: parseTotalValue(r.json) };
    }));
    out.push(...batch);
  }
  return out;
}

export const instagramAnalytics: ConnectorAnalytics = {
  dailyMetrics: Object.keys(IG_DAILY_METRICS),
  historyDays: 30,
  audienceDimensions: ["age_gender", "country", "city", "locale"],

  async fetchFollowers(tokens: SocialTokenSet, { accountExternalId }) {
    const r = await graph<{ followers_count?: number }>({ method: "GET", path: `/${accountExternalId}`, token: tokens.accessToken, phase: "read", query: { fields: "followers_count" } });
    return typeof r.json.followers_count === "number" ? r.json.followers_count : null;
  },

  async fetchDailyMetric(tokens: SocialTokenSet, { accountExternalId, metric, from, to }): Promise<DailySeries> {
    const network = IG_DAILY_METRICS[metric];
    if (!network) return { status: "UNAVAILABLE", points: [], note: "This metric is not offered for Instagram." };
    const token = tokens.accessToken;
    const points = new Map<string, DailyPoint>();
    try {
      for (const chunk of chunkRange(from, to, MAX_DAYS_PER_REQUEST)) {
        let got: DailyPoint[] | null = null;
        try {
          const r = await graph({ method: "GET", path: `/${accountExternalId}/insights`, token, phase: "read", query: { metric: network, period: "day", since: String(unixSeconds(chunk.from)), until: String(unixSeconds(addDays(chunk.to, 1))) } });
          got = parseSeries(r.json);
        } catch (err) {
          if (!(isMetricRefusal(err) && wantsTotalValue(err))) throw err;
          got = await perDayTotals(token, accountExternalId, network, chunk.from, chunk.to);
        }
        for (const p of got ?? []) points.set(p.date, p);
      }
    } catch (err) {
      if (isMetricRefusal(err)) return { status: "UNAVAILABLE", points: [], note: noteFrom(err) };
      throw err;
    }
    if (points.size === 0) return { status: "UNAVAILABLE", points: [], note: "Meta returned no data (an empty set, not zero) for this metric in the requested period." };
    return { status: "OK", points: [...points.values()].sort((a, b) => a.date.localeCompare(b.date)) };
  },

  async fetchPostMetrics(tokens: SocialTokenSet, { externalPostId }): Promise<PostMetricValue[]> {
    const token = tokens.accessToken;
    const out: PostMetricValue[] = [];
    const media = await graph<{ like_count?: number; comments_count?: number }>({ method: "GET", path: `/${externalPostId}`, token, phase: "read", query: { fields: "like_count,comments_count" } });
    for (const [key, field] of [["likes", "like_count"], ["comments", "comments_count"]] as const) {
      const v = media.json[field];
      out.push(typeof v === "number" ? { metric: key, value: v, status: "OK" } : { metric: key, value: null, status: "UNAVAILABLE", note: "Instagram did not return this count (it can be hidden)." });
    }
    for (const [key, network] of Object.entries(IG_POST_INSIGHTS)) {
      try {
        const r = await graph({ method: "GET", path: `/${externalPostId}/insights`, token, phase: "read", query: { metric: network } });
        const v = parseSingleValue(r.json);
        out.push(v === null ? { metric: key, value: null, status: "UNAVAILABLE", note: "Instagram returned no value for this post." } : { metric: key, value: v, status: "OK" });
      } catch (err) {
        if (!isMetricRefusal(err) && !isPermissionFailure(err)) throw err;
        out.push({ metric: key, value: null, status: "UNAVAILABLE", note: isPermissionFailure(err) ? "Insights permission is missing. Reconnect the account after enabling it." : noteFrom(err) });
      }
    }
    return out;
  },

  async fetchAudience(tokens: SocialTokenSet, { accountExternalId, followers }): Promise<AudienceResult[]> {
    const token = tokens.accessToken;
    const results: AudienceResult[] = [];
    const underThreshold = followers !== null && followers < FOLLOWER_THRESHOLD;
    for (const d of DEMOGRAPHICS) {
      let buckets: AudienceBucket[] | null = null;
      let refusal: string | null = null;
      for (const attempt of [
        { metric: "follower_demographics", query: { metric_type: "total_value", period: "lifetime", breakdown: d.breakdown }, parse: parseBreakdown },
        { metric: d.legacy, query: { period: "lifetime" }, parse: parseLifetimeMap },
      ]) {
        try {
          const r = await graph({ method: "GET", path: `/${accountExternalId}/insights`, token, phase: "read", query: { metric: attempt.metric, ...attempt.query } });
          buckets = attempt.parse(r.json);
          if (buckets) break;
        } catch (err) {
          if (!isMetricRefusal(err)) throw err;
          refusal = noteFrom(err);
        }
      }
      if (buckets) results.push({ dimension: d.dimension, status: "OK", buckets });
      else if (underThreshold) results.push({ dimension: d.dimension, status: "UNAVAILABLE", reason: `Instagram does not provide audience demographics for accounts with fewer than ${FOLLOWER_THRESHOLD} followers (this account has ${followers}).` });
      else results.push({ dimension: d.dimension, status: "UNAVAILABLE", reason: refusal ?? "Instagram returned no demographic data for this account yet." });
    }
    return results;
  },
};
