/**
 * Insights contract tests: parsers and the Facebook/Instagram analytics connectors against hand-written fixtures (tests/fixtures/insights/README.md).
 * The rule under test: anything Meta does not give us is null/UNAVAILABLE with a reason — never 0 — and failures are classified, not swallowed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import series from "../fixtures/insights/series.json";
import errors from "../fixtures/insights/errors.json";

vi.mock("../../server/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/config/env")>();
  return { ...actual, config: { ...actual.config, metaAppId: "APPID", metaAppSecret: "app-secret-0123456789abcdef", metaApiVersion: "v25.0", socialAnalyticsScopes: false, metaLoginScopes: "", metaInstagramLoginScopes: "" } };
});
import { config } from "../../server/config/env";
import { metaHttp } from "../../server/services/social/connectors/metaGraph";
import { chunkRange, endTimeToDay, parseBreakdown, parseLifetimeMap, parseSeries, parseSingleValue, parseTotalValue } from "../../server/services/social/connectors/metaInsights";
import { facebookAnalytics } from "../../server/services/social/connectors/facebookInsights";
import { instagramAnalytics } from "../../server/services/social/connectors/instagramInsights";
import { facebookScopes } from "../../server/services/social/connectors/facebookPageProvider";
import { instagramScopes } from "../../server/services/social/connectors/instagramProvider";
import { SocialPublishError } from "../../server/services/social/publishing/publishErrors";

const TOKEN = "PAGE_TOKEN_SECRET_VALUE";
const tokens = { accessToken: TOKEN };
const mutable = config as unknown as Record<string, unknown>;

interface Call { path: string; query: URLSearchParams }
const calls: Call[] = [];
let respond: (c: Call) => { status?: number; body: unknown };
const original = metaHttp.fetch;
beforeEach(() => {
  calls.length = 0;
  respond = () => ({ body: { data: [] } });
  metaHttp.fetch = (async (url: string) => {
    const u = new URL(url);
    const c = { path: u.pathname.replace(/^\/v25\.0/, ""), query: u.searchParams };
    calls.push(c);
    const r = respond(c);
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
  }) as typeof fetch;
});
afterEach(() => { metaHttp.fetch = original; mutable.socialAnalyticsScopes = false; });
const rejection = async (p: Promise<unknown>) => p.then(() => { throw new Error("expected rejection"); }, (e: unknown) => e);

describe("parsers", () => {
  it("maps end_time to the day the value describes (the window ends 24 h later) and keeps true zeros", () => {
    expect(endTimeToDay("2026-10-05T07:00:00+0000")).toBe("2026-10-04");
    expect(endTimeToDay("2026-10-05T00:00:00+0000")).toBe("2026-10-04");
    expect(parseSeries(series.igReachTimeSeries)).toEqual([{ date: "2026-10-04", value: 120 }, { date: "2026-10-05", value: 0 }, { date: "2026-10-06", value: 98 }]);
  });
  it("treats a missing or non-numeric value as null, never 0, and an empty data set as no series", () => {
    expect(parseSeries(series.valueMissingOrObject)).toEqual([{ date: "2026-10-04", value: 5 }, { date: "2026-10-05", value: null }, { date: "2026-10-06", value: null }]);
    expect(parseSeries(series.emptyData)).toBeNull();
    expect(parseTotalValue(series.emptyData)).toBeNull();
    expect(parseSeries(null)).toBeNull();
    expect(parseSeries({ data: [{ name: "x" }] })).toBeNull();
  });
  it("reads total_value and lifetime single values", () => {
    expect(parseTotalValue(series.igProfileViewsTotal)).toBe(14);
    expect(parseSingleValue(series.singleLifetime)).toBe(77);
    expect(parseSingleValue(series.igProfileViewsTotal)).toBe(14);
  });
  it("reads both demographics shapes, sorted, skipping junk", () => {
    expect(parseBreakdown(series.demographicsBreakdown)).toEqual([{ key: "US", value: 90 }, { key: "GB", value: 40 }, { key: "PK", value: 12 }]);
    expect(parseLifetimeMap(series.demographicsLegacy)).toEqual([{ key: "US", value: 90 }, { key: "GB", value: 40 }]);
    expect(parseBreakdown(series.emptyData)).toBeNull();
  });
  it("chunks ranges to the API window", () => {
    const c = chunkRange(new Date("2026-01-01T00:00:00Z"), new Date("2026-04-10T00:00:00Z"), 90);
    expect(c.map((x) => [x.from.toISOString().slice(0, 10), x.to.toISOString().slice(0, 10)])).toEqual([["2026-01-01", "2026-03-31"], ["2026-04-01", "2026-04-10"]]);
  });
});

describe("login scopes", () => {
  it("add the insights permissions only when SOCIAL_ANALYTICS_SCOPES is on (so login cannot break before they are enabled)", () => {
    expect(facebookScopes()).not.toContain("read_insights");
    expect(instagramScopes()).not.toContain("instagram_manage_insights");
    mutable.socialAnalyticsScopes = true;
    expect(facebookScopes()).toContain("read_insights");
    expect(instagramScopes()).toContain("instagram_manage_insights");
    expect(facebookScopes().filter((s) => s === "read_insights")).toHaveLength(1);
  });
});

describe("Facebook Page analytics", () => {
  const ctx = { accountExternalId: "PAGE1" };
  it("never requests retired metrics (impressions / fans) and reads followers from a plain field", async () => {
    expect(facebookAnalytics.dailyMetrics).toEqual(["views", "reach", "engagement", "follows_new", "unfollows", "profile_views"]);
    respond = () => ({ body: { followers_count: 1520, fan_count: 1500 } });
    expect(await facebookAnalytics.fetchFollowers(tokens, ctx)).toBe(1520);
    expect(calls[0]!.query.get("fields")).toBe("followers_count,fan_count");
    respond = () => ({ body: {} });
    expect(await facebookAnalytics.fetchFollowers(tokens, ctx)).toBeNull();
  });
  it("fetches one metric per request with a day period, chunked to 90 days", async () => {
    respond = () => ({ body: series.fbPageMediaView });
    const out = await facebookAnalytics.fetchDailyMetric(tokens, { ...ctx, metric: "views", from: new Date("2026-01-01T00:00:00Z"), to: new Date("2026-04-10T00:00:00Z") });
    expect(calls).toHaveLength(2);
    for (const c of calls) { expect(c.path).toBe("/PAGE1/insights"); expect(c.query.get("metric")).toBe("page_media_view"); expect(c.query.get("period")).toBe("day"); }
    expect(out.status).toBe("OK");
    expect(out.points).toEqual([{ date: "2026-10-04", value: 310 }, { date: "2026-10-05", value: 280 }]);
  });
  it("a rejected/retired metric is UNAVAILABLE with Meta's reason; empty data is UNAVAILABLE, not zero", async () => {
    respond = () => ({ status: 400, body: errors.invalidMetric });
    const bad = await facebookAnalytics.fetchDailyMetric(tokens, { ...ctx, metric: "profile_views", from: new Date("2026-10-01T00:00:00Z"), to: new Date("2026-10-05T00:00:00Z") });
    expect(bad).toMatchObject({ status: "UNAVAILABLE", points: [] });
    expect(bad.note).toMatch(/code 100/);
    respond = () => ({ body: series.emptyData });
    const empty = await facebookAnalytics.fetchDailyMetric(tokens, { ...ctx, metric: "reach", from: new Date("2026-10-01T00:00:00Z"), to: new Date("2026-10-05T00:00:00Z") });
    expect(empty).toMatchObject({ status: "UNAVAILABLE", points: [] });
    expect(empty.note).toMatch(/no data/i);
  });
  it("rethrows a missing permission (auth) and rate limits (transient) so the job can record them", async () => {
    respond = () => ({ status: 403, body: errors.permission });
    const e1 = await rejection(facebookAnalytics.fetchDailyMetric(tokens, { ...ctx, metric: "views", from: new Date("2026-10-01T00:00:00Z"), to: new Date("2026-10-02T00:00:00Z") }));
    expect(e1).toBeInstanceOf(SocialPublishError);
    expect((e1 as SocialPublishError).kind).toBe("auth");
    respond = () => ({ status: 400, body: errors.rateLimit });
    expect(((await rejection(facebookAnalytics.fetchDailyMetric(tokens, { ...ctx, metric: "views", from: new Date("2026-10-01T00:00:00Z"), to: new Date("2026-10-02T00:00:00Z") }))) as SocialPublishError).kind).toBe("transient");
  });
  it("post metrics: plain fields first (shares omitted → null, not 0); an Insights permission failure keeps the plain counts", async () => {
    respond = (c) => c.path.endsWith("/insights") ? { status: 403, body: errors.permission } : { body: { reactions: { summary: { total_count: 12 } }, comments: { summary: { total_count: 3 } } } };
    const m = await facebookAnalytics.fetchPostMetrics(tokens, { ...ctx, externalPostId: "PAGE1_P1" });
    const by = Object.fromEntries(m.map((x) => [x.metric, x]));
    expect(by.likes).toMatchObject({ value: 12, status: "OK" });
    expect(by.comments).toMatchObject({ value: 3, status: "OK" });
    expect(by.shares).toMatchObject({ value: null, status: "UNAVAILABLE" });
    expect(by.reach).toMatchObject({ value: null, status: "UNAVAILABLE" });
    expect(by.views!.note).toMatch(/permission/i);
  });
  it("has no demographics in this release", async () => {
    expect(facebookAnalytics.audienceDimensions).toEqual([]);
    expect(await facebookAnalytics.fetchAudience(tokens, { ...ctx, followers: 5 })).toEqual([]);
  });
});

describe("Instagram analytics", () => {
  const ctx = { accountExternalId: "IG1" };
  const from = new Date("2026-10-01T00:00:00Z");
  const to = new Date("2026-10-05T00:00:00Z");
  it("never requests impressions or plays", () => {
    const requested = [...instagramAnalytics.dailyMetrics];
    expect(requested).toEqual(["views", "reach", "engagement", "profile_views", "link_clicks", "follows_new"]);
  });
  it("time-series first; when Meta demands metric_type=total_value it asks once per day", async () => {
    respond = (c) => c.query.get("metric_type") === "total_value" ? { body: series.igProfileViewsTotal } : { status: 400, body: errors.needsTotalValue };
    const out = await instagramAnalytics.fetchDailyMetric(tokens, { ...ctx, metric: "profile_views", from, to });
    expect(out.status).toBe("OK");
    expect(out.points.map((p) => [p.date, p.value])).toEqual([["2026-10-01", 14], ["2026-10-02", 14], ["2026-10-03", 14], ["2026-10-04", 14], ["2026-10-05", 14]]);
    expect(calls.filter((c) => c.query.get("metric_type") === "total_value")).toHaveLength(5);
  });
  it("uses the time series directly when Meta provides it", async () => {
    respond = () => ({ body: series.igReachTimeSeries });
    const out = await instagramAnalytics.fetchDailyMetric(tokens, { ...ctx, metric: "reach", from, to });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.query.get("metric")).toBe("reach");
    expect(out.points).toHaveLength(3);
    expect(out.points[1]).toEqual({ date: "2026-10-05", value: 0 }); // a real zero stays a zero
  });
  it("a retired metric (impressions-style error) or an empty set is UNAVAILABLE with the reason, never zero", async () => {
    respond = () => ({ status: 400, body: errors.deprecatedImpressions });
    const dep = await instagramAnalytics.fetchDailyMetric(tokens, { ...ctx, metric: "views", from, to });
    expect(dep).toMatchObject({ status: "UNAVAILABLE", points: [] });
    expect(dep.note).toMatch(/no longer supported/);
    respond = () => ({ body: series.emptyData });
    const empty = await instagramAnalytics.fetchDailyMetric(tokens, { ...ctx, metric: "reach", from, to });
    expect(empty).toMatchObject({ status: "UNAVAILABLE", points: [] });
    expect(empty.note).toMatch(/empty set, not zero/);
  });
  it("missing permission is rethrown as auth", async () => {
    respond = () => ({ status: 403, body: errors.permission });
    expect(((await rejection(instagramAnalytics.fetchDailyMetric(tokens, { ...ctx, metric: "reach", from, to }))) as SocialPublishError).kind).toBe("auth");
  });
  it("post metrics combine plain counts with per-metric insights; a refused metric is UNAVAILABLE", async () => {
    respond = (c) => {
      if (!c.path.endsWith("/insights")) return { body: { like_count: 25, comments_count: 4 } };
      const m = c.query.get("metric");
      if (m === "shares") return { status: 400, body: errors.invalidMetric };
      return { body: { data: [{ name: m, period: "lifetime", values: [{ value: m === "reach" ? 300 : 9 }] }] } };
    };
    const m = await instagramAnalytics.fetchPostMetrics(tokens, { ...ctx, externalPostId: "MEDIA1" });
    const by = Object.fromEntries(m.map((x) => [x.metric, x]));
    expect(by.likes!.value).toBe(25);
    expect(by.reach!.value).toBe(300);
    expect(by.saves!.value).toBe(9);
    expect(by.shares).toMatchObject({ value: null, status: "UNAVAILABLE" });
  });
  it("demographics: new breakdown shape first, legacy fallback, and the under-100-followers reason (only when Meta gives nothing)", async () => {
    respond = (c) => c.query.get("metric") === "follower_demographics" ? { body: series.demographicsBreakdown } : { body: series.demographicsLegacy };
    const ok = await instagramAnalytics.fetchAudience(tokens, { ...ctx, followers: 5000 });
    expect(ok).toHaveLength(4);
    expect(ok[1]).toMatchObject({ dimension: "country", status: "OK", buckets: [{ key: "US", value: 90 }, { key: "GB", value: 40 }, { key: "PK", value: 12 }] });

    respond = (c) => c.query.get("metric") === "follower_demographics" ? { status: 400, body: errors.under100 } : { body: series.demographicsLegacy };
    const legacy = await instagramAnalytics.fetchAudience(tokens, { ...ctx, followers: 5000 });
    expect(legacy[1]).toMatchObject({ status: "OK", buckets: [{ key: "US", value: 90 }, { key: "GB", value: 40 }] });

    respond = () => ({ status: 400, body: errors.under100 });
    const small = await instagramAnalytics.fetchAudience(tokens, { ...ctx, followers: 42 });
    expect(small.every((r) => r.status === "UNAVAILABLE")).toBe(true);
    expect(small[0]!.reason).toMatch(/fewer than 100 followers \(this account has 42\)/);
    const big = await instagramAnalytics.fetchAudience(tokens, { ...ctx, followers: 900 });
    expect(big[0]!.reason).toMatch(/not available for accounts with fewer than 100 followers/); // Meta's own words, not ours
    respond = () => ({ body: series.emptyData });
    expect((await instagramAnalytics.fetchAudience(tokens, { ...ctx, followers: 900 }))[0]!.reason).toMatch(/no demographic data/i);
  });
});
