/**
 * Social analytics (Step 9b) end to end through the real API and database with a STUBBED Graph transport (no network):
 * ingestion (idempotent, append-only, null not zero, permission/kill-switch handling), the read API (scoping, permission, KPI maths, empty states),
 * CSV export and the AI summary guard. Fixtures are hand-written (tests/fixtures/insights). Test data tagged QA_TEST_2026_.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import errors from "../fixtures/insights/errors.json";

vi.mock("../../server/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/config/env")>();
  return { ...actual, config: { ...actual.config, metaAppId: "QA_APP_ID", metaAppSecret: "qa-app-secret-0123456789abcdef", metaApiVersion: "v25.0", socialAnalyticsDisabled: false, aiProvider: "gemini", geminiApiKey: "" } };
});
import { config } from "../../server/config/env";
import { createApp, finalizeApp } from "../../server/app/app";
import { disconnectPrisma, prisma } from "../../server/db/prisma";
import { logger } from "../../server/core/logger";
import { resetDb } from "../helpers/db";
import { metaHttp } from "../../server/services/social/connectors/metaGraph";
import { analyticsIngest } from "../../server/services/social/analytics/analyticsIngest";
import { tokenVault } from "../../server/services/social/tokenVault";
import { AdapterFactory } from "../../server/ai/adapters/adapterFactory";

const mutable = config as unknown as Record<string, unknown>;
const NOW = new Date("2026-10-08T12:00:00Z"); // yesterday (the last final day) = 2026-10-07
const TOKEN = "QA_IG_TOKEN_aaaaaaaaaaaaaaaaaaaaaaaa";
const ROLE_ANALYST = "QA_TEST_2026_ANALYST";
const ROLE_READER = "QA_TEST_2026_READER";

interface Call { path: string; query: URLSearchParams }

describe("social analytics", () => {
  const app = createApp();
  finalizeApp(app);
  let adminToken = "", analystToken = "", readerToken = "", otherToken = "", orgId = "", otherOrgId = "";
  let igId = "", fbId = "", liId = "", otherIgId = "";
  let targetId = "", postId = "";
  let ip = 40;
  const logged: string[] = [];
  const calls: Call[] = [];
  const original = metaHttp.fetch;
  let handler: (c: Call) => { status?: number; body: unknown } | Error;

  const ts = (values: Array<[string, number]>, name = "reach") => ({ data: [{ name, period: "day", values: values.map(([end, value]) => ({ value, end_time: `${end}T07:00:00+0000` })) }] });
  const igDefault = (c: Call): { status?: number; body: unknown } => {
    const m = c.query.get("metric");
    if (c.path === "/QA_IG_1" && c.query.get("fields") === "followers_count") return { body: { followers_count: 1234 } };
    if (c.path === "/QA_IG_1/insights") {
      if (m === "reach") return { body: ts([["2026-10-06", 100], ["2026-10-07", 0], ["2026-10-08", 150]]) };
      if (m === "follower_count") return { body: ts([["2026-10-06", 3], ["2026-10-07", 2], ["2026-10-08", 4]], "follower_count") };
      if (m === "views") return { status: 400, body: errors.invalidMetric };
      if (m === "website_clicks") return { body: { data: [] } };
      if (m === "total_interactions" || m === "profile_views") return c.query.get("metric_type") === "total_value" ? { body: { data: [{ name: m, total_value: { value: 7 } }] } } : { status: 400, body: errors.needsTotalValue };
      if (m === "follower_demographics" || String(m).startsWith("audience_")) return { status: 400, body: errors.under100 };
    }
    if (c.path === "/MEDIA1") return { body: { like_count: 25, comments_count: 4 } };
    if (c.path === "/MEDIA1/insights") return m === "shares" ? { status: 400, body: errors.invalidMetric } : { body: { data: [{ name: m, period: "lifetime", values: [{ value: m === "reach" ? 300 : 9 }] }] } };
    return { body: { data: [] } };
  };

  const hdr = () => `10.11.${Math.floor(ip / 250)}.${ip++ % 250}`;
  const api = (method: "get" | "post", path: string, token: string, body?: object) => {
    const r = request(app)[method](`/api/v1${path}`).set("Authorization", `Bearer ${token}`).set("X-Forwarded-For", hdr());
    return method === "get" ? r : r.send(body ?? {});
  };
  async function userWith(email: string, roleKey: string) {
    await api("post", "/users", adminToken, { email, password: "Str0ng-Passphrase-77", firstName: "QA", lastName: "A", roleKey });
    return (await request(app).post("/api/v1/auth/login").set("X-Forwarded-For", hdr()).send({ email, password: "Str0ng-Passphrase-77" })).body.data.session.token as string;
  }
  async function account(organizationId: string, provider: string, externalAccountId: string, displayName: string) {
    const a = await prisma.socialAccount.create({ data: { organizationId, provider, externalAccountId, displayName, accountType: "BUSINESS", status: "CONNECTED", scopes: [] } });
    const enc = tokenVault.encrypt({ accessToken: TOKEN, pageId: "QA_PAGE_1" }, a.id);
    await prisma.socialAccountCredential.create({ data: { socialAccountId: a.id, ciphertext: enc.ciphertext, keyVersion: enc.keyVersion } });
    return a.id;
  }
  const count = (table: "socialAccountMetric" | "socialPostMetric" | "socialAudienceSnapshot", where: object = {}) => (prisma[table] as unknown as { count: (a: object) => Promise<number> }).count({ where });
  const run = (id = igId, now = NOW) => analyticsIngest.runAccount(id, now, { budgetMs: 60_000 });
  const clear = async () => {
    await prisma.socialAccountMetric.deleteMany({ where: { socialAccountId: igId } });
    await prisma.socialPostMetric.deleteMany({ where: { socialAccountId: igId } });
    await prisma.socialAudienceSnapshot.deleteMany({ where: { socialAccountId: igId } });
    await prisma.socialAnalyticsState.deleteMany({ where: { socialAccountId: igId } });
  };
  const setKill = (g: boolean, w: boolean) => Promise.all([
    prisma.socialPublishingGlobal.upsert({ where: { id: "global" }, create: { id: "global", enabled: false, dryRun: true, killSwitch: g }, update: { killSwitch: g } }),
    prisma.socialPublishingSetting.upsert({ where: { organizationId: orgId }, create: { organizationId: orgId, enabled: false, dryRun: true, killSwitch: w }, update: { killSwitch: w } }),
  ]);

  beforeAll(async () => {
    await resetDb();
    for (const level of ["info", "warn", "error", "debug"] as const) vi.spyOn(logger, level).mockImplementation(((...args: unknown[]) => { logged.push(JSON.stringify(args)); }) as never);
    metaHttp.fetch = (async (url: string) => {
      const u = new URL(url);
      const c = { path: u.pathname.replace(/^\/v25\.0/, ""), query: u.searchParams };
      calls.push(c);
      const r = handler(c);
      if (r instanceof Error) throw r;
      return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
    }) as typeof fetch;

    const reg = await request(app).post("/api/v1/auth/register").set("X-Forwarded-For", "10.0.9.1").send({ email: "qa-an-admin@example.com", password: "Str0ng-Passphrase-77", firstName: "QA", lastName: "Admin", organizationName: "QA_TEST_2026_ Analytics" });
    adminToken = reg.body.data.session.token; orgId = reg.body.data.user.organizationId;
    const other = await request(app).post("/api/v1/auth/register").set("X-Forwarded-For", "10.0.9.2").send({ email: "qa-an-other@example.com", password: "Str0ng-Passphrase-77", firstName: "QA", lastName: "Other", organizationName: "QA_TEST_2026_ Other Analytics" });
    otherToken = other.body.data.session.token; otherOrgId = other.body.data.user.organizationId;
    for (const [key, perms] of [[ROLE_ANALYST, ["social.read", "social.analytics.read"]], [ROLE_READER, ["social.read"]]] as const) {
      const role = await prisma.role.create({ data: { key, name: key, isSystem: false } });
      const rows = await prisma.permission.findMany({ where: { key: { in: [...perms] } } });
      await prisma.rolePermission.createMany({ data: rows.map((p) => ({ roleId: role.id, permissionId: p.id })) });
    }
    analystToken = await userWith("qa-an-analyst@example.com", ROLE_ANALYST);
    readerToken = await userWith("qa-an-reader@example.com", ROLE_READER);

    igId = await account(orgId, "meta_instagram", "QA_IG_1", "QA_TEST_2026_ Instagram");
    fbId = await account(orgId, "meta_facebook", "QA_PAGE_1", "QA_TEST_2026_ Page");
    liId = await account(orgId, "linkedin", "QA_LI_1", "QA_TEST_2026_ LinkedIn");
    otherIgId = await account(otherOrgId, "meta_instagram", "QA_IG_OTHER", "QA_TEST_2026_ Other IG");
    const post = await prisma.socialPost.create({ data: { organizationId: orgId, title: "=HYPERLINK(\"http://x\")QA_TEST_2026_ post", body: "Hello", status: "PUBLISHED", timezone: "UTC", createdById: reg.body.data.user.id } });
    postId = post.id;
    targetId = (await prisma.socialPostTarget.create({ data: { postId, socialAccountId: igId, status: "PUBLISHED", publishedAt: new Date("2026-10-06T10:00:00Z"), externalPostId: "MEDIA1", externalUrl: "https://www.instagram.com/p/QA/" } })).id;
  });
  afterAll(async () => {
    metaHttp.fetch = original;
    vi.restoreAllMocks();
    await prisma.socialPublishingSetting.deleteMany({});
    await prisma.socialPublishingGlobal.deleteMany({});
    for (const key of [ROLE_ANALYST, ROLE_READER]) {
      const roles = await prisma.role.findMany({ where: { key } });
      for (const r of roles) {
        await prisma.rolePermission.deleteMany({ where: { roleId: r.id } });
        await prisma.organizationMembership.deleteMany({ where: { roleId: r.id } });
        await prisma.user.deleteMany({ where: { roleId: r.id } });
        await prisma.role.delete({ where: { id: r.id } });
      }
    }
    await disconnectPrisma();
  });
  beforeEach(() => { calls.length = 0; handler = igDefault; mutable.socialAnalyticsDisabled = false; mutable.geminiApiKey = ""; });

  // ---------- permission ----------
  it("seeds social.analytics.read for every role that can read Social (never CLIENT_PORTAL)", async () => {
    const rows = await prisma.rolePermission.findMany({ where: { permission: { key: "social.analytics.read" } }, include: { role: { select: { key: true } } } });
    const keys = rows.map((r) => r.role.key);
    for (const k of ["SUPER_ADMIN", "ADMIN", "MANAGER", "VIEWER"]) expect(keys).toContain(k);
    expect(keys).not.toContain("CLIENT_PORTAL");
  });
  it("requires social.analytics.read (social.read alone is not enough) and is workspace scoped", async () => {
    expect((await api("get", "/social/analytics/summary", readerToken)).status).toBe(403);
    expect((await api("get", `/social/analytics/accounts/${igId}`, readerToken)).status).toBe(403);
    expect((await api("get", "/social/analytics/summary", analystToken)).status).toBe(200);
    expect((await api("get", `/social/analytics/accounts/${otherIgId}`, analystToken)).status).toBe(404); // another workspace's account
    expect((await api("get", `/social/analytics/posts/${targetId}`, otherToken)).status).toBe(404);
    expect((await api("get", `/social/analytics/accounts/${igId}/export`, otherToken)).status).toBe(404);
    expect((await api("post", `/social/analytics/accounts/${igId}/refresh`, analystToken)).status).toBe(403); // refresh needs social.accounts.manage
  });

  // ---------- empty states (before any ingestion) ----------
  it("shows honest empty states before the first sync: null numbers with reasons, never zeros", async () => {
    const d = (await api("get", `/social/analytics/accounts/${igId}?from=2026-10-05&to=2026-10-07`, analystToken)).body.data;
    expect(d.account.analytics).toBe("supported");
    for (const k of d.kpis) { expect(k.current).toBeNull(); expect(k.daysWithData).toBe(0); expect(k.unavailableReason).toBeTruthy(); }
    expect(d.account.sync.lastSuccessAt).toBeNull();
    const aud = (await api("get", `/social/analytics/accounts/${igId}/audience`, analystToken)).body.data;
    expect(aud.followers.series).toEqual([]);
    expect(aud.followers.historyNote).toMatch(/No follower total/);
    expect(aud.demographics.every((x: { status: string }) => x.status === "PENDING")).toBe(true);
    const posts = (await api("get", `/social/analytics/accounts/${igId}/posts?from=2026-10-01&to=2026-10-07`, analystToken)).body.data;
    expect(posts.rows).toHaveLength(1);
    expect(posts.withMetrics).toBe(0);
    expect(posts.rows[0].metrics.reach).toMatchObject({ value: null, status: "UNAVAILABLE" });
  });
  it("LinkedIn and Facebook demographics are 'not available' with the reason, not empty charts", async () => {
    const s = (await api("get", "/social/analytics/summary", analystToken)).body.data;
    const li = s.accounts.find((a: { id: string }) => a.id === liId);
    expect(li).toMatchObject({ analytics: "unsupported", headline: [] });
    expect(li.unsupportedReason).toMatch(/Community Management API/);
    const fbAud = (await api("get", `/social/analytics/accounts/${fbId}/audience`, analystToken)).body.data;
    expect(fbAud).toMatchObject({ demographicsSupported: false, demographics: [] });
    expect(fbAud.demographicsReason).toMatch(/not read in this release/);
    expect((await api("get", `/social/analytics/accounts/${liId}`, analystToken)).body.data.kpis).toEqual([]);
  });

  // ---------- ingestion ----------
  it("stores completed days, today's followers, per-post snapshots and capabilities; unavailable metrics are null/UNAVAILABLE, never 0", async () => {
    const r = await run();
    expect(r.outcome).toBe("completed");
    const reach = await prisma.socialAccountMetric.findMany({ where: { socialAccountId: igId, metric: "reach" }, orderBy: { metricDate: "asc" } });
    expect(reach.map((x) => [x.metricDate.toISOString().slice(0, 10), x.value])).toEqual([["2026-10-05", 100], ["2026-10-06", 0], ["2026-10-07", 150]]); // a real 0 stays 0; the 8th is not final
    expect(await count("socialAccountMetric", { socialAccountId: igId, metric: "views" })).toBe(0); // refused metric: no rows, no zeros
    expect(await count("socialAccountMetric", { socialAccountId: igId, metric: "link_clicks" })).toBe(0); // empty set is not 0
    const followers = await prisma.socialAccountMetric.findMany({ where: { socialAccountId: igId, metric: "followers" } });
    expect(followers).toHaveLength(1);
    expect(followers[0]).toMatchObject({ value: 1234 });
    expect(followers[0]!.metricDate.toISOString().slice(0, 10)).toBe("2026-10-08");
    expect(await count("socialAccountMetric", { socialAccountId: igId, metric: "engagement", value: 7 })).toBeGreaterThan(20); // per-day total_value fallback
    const state = await prisma.socialAnalyticsState.findUniqueOrThrow({ where: { socialAccountId: igId } });
    const caps = state.capabilities as { daily: Record<string, { status: string; reason?: string }> };
    expect(caps.daily.views).toMatchObject({ status: "UNAVAILABLE" });
    expect(caps.daily.link_clicks!.reason).toMatch(/empty set/);
    expect(caps.daily.reach).toMatchObject({ status: "OK" });
    expect(state.lastSuccessAt).not.toBeNull();
    expect(state.lastError).toBeNull();
    expect(state.historyLimitDays).toBe(30);
    // post snapshot
    const pm = await prisma.socialPostMetric.findMany({ where: { targetId } });
    const by = Object.fromEntries(pm.map((x) => [x.metric, x]));
    expect(by.likes).toMatchObject({ value: 25, status: "OK" });
    expect(by.reach).toMatchObject({ value: 300 });
    expect(by.shares).toMatchObject({ value: null, status: "UNAVAILABLE" });
    // audience: Meta refused (account has 1234 followers) → UNAVAILABLE with Meta's own words
    const aud = await prisma.socialAudienceSnapshot.findMany({ where: { socialAccountId: igId } });
    expect(aud).toHaveLength(4);
    expect(aud.every((a) => a.status === "UNAVAILABLE" && a.buckets === null)).toBe(true);
    expect(aud[0]!.reason).toMatch(/fewer than 100 followers/);
  });
  it("is idempotent per account per day: a second run adds nothing and the account is no longer due", async () => {
    const before = [await count("socialAccountMetric", { socialAccountId: igId }), await count("socialPostMetric", { socialAccountId: igId }), await count("socialAudienceSnapshot", { socialAccountId: igId })];
    calls.length = 0;
    await run(igId, new Date("2026-10-08T15:00:00Z"));
    expect([await count("socialAccountMetric", { socialAccountId: igId }), await count("socialPostMetric", { socialAccountId: igId }), await count("socialAudienceSnapshot", { socialAccountId: igId })]).toEqual(before);
    expect(calls.filter((c) => c.path.endsWith("/insights") && c.query.get("metric") === "reach")).toHaveLength(0); // nothing was missing, so nothing was re-read
    const due = await analyticsIngest.dueAccounts(new Date("2026-10-08T18:00:00Z"), 10);
    expect(due.map((a) => a.id)).not.toContain(igId);
    expect((await analyticsIngest.dueAccounts(new Date("2026-10-09T08:00:00Z"), 10)).map((a) => a.id)).toContain(igId); // due again the next UTC day
  });
  it("never overwrites a stored number, but upgrades a stored NULL to a real number", async () => {
    await prisma.socialAccountMetric.deleteMany({ where: { socialAccountId: igId, metric: "reach", metricDate: { in: [new Date("2026-10-05"), new Date("2026-10-06")] } } });
    await prisma.socialAccountMetric.create({ data: { organizationId: orgId, socialAccountId: igId, metric: "reach", metricDate: new Date("2026-10-05"), value: null, status: "UNAVAILABLE", note: "no value" } });
    await prisma.socialAccountMetric.create({ data: { organizationId: orgId, socialAccountId: igId, metric: "reach", metricDate: new Date("2026-10-06"), value: 5, status: "OK" } });
    await prisma.socialAnalyticsState.update({ where: { socialAccountId: igId }, data: { capabilities: {} } });
    handler = (c) => (c.path === "/QA_IG_1/insights" && c.query.get("metric") === "reach" ? { body: ts([["2026-10-06", 999], ["2026-10-07", 888], ["2026-10-08", 777]]) } : igDefault(c));
    await prisma.socialAccountMetric.deleteMany({ where: { socialAccountId: igId, metric: "reach", metricDate: new Date("2026-10-07") } });
    await run(igId, new Date("2026-10-09T09:00:00Z"));
    const rows = Object.fromEntries((await prisma.socialAccountMetric.findMany({ where: { socialAccountId: igId, metric: "reach" } })).map((x) => [x.metricDate.toISOString().slice(0, 10), x.value]));
    expect(rows["2026-10-05"]).toBe(999); // a stored NULL is upgraded to the real number
    expect(rows["2026-10-06"]).toBe(5); // a stored real number is NEVER replaced (the network now says 888)
    expect(rows["2026-10-07"]).toBe(777); // a missing day is filled
  });
  it("a missing Insights permission is recorded with a clear message; followers still work; nothing is stored as 0", async () => {
    await clear();
    handler = (c) => (c.path.endsWith("/insights") ? { status: 403, body: errors.permission } : igDefault(c));
    const r = await run();
    expect(r.outcome).toBe("completed");
    const state = await prisma.socialAnalyticsState.findUniqueOrThrow({ where: { socialAccountId: igId } });
    expect(state.lastError).toMatch(/Insights permission/);
    expect((state.capabilities as { permission?: { status: string } }).permission?.status).toBe("MISSING");
    expect(await count("socialAccountMetric", { socialAccountId: igId, metric: "followers" })).toBe(1);
    expect(await count("socialAccountMetric", { socialAccountId: igId, metric: { not: "followers" } })).toBe(0);
    const pm = await prisma.socialPostMetric.findMany({ where: { targetId } });
    expect(pm.find((x) => x.metric === "likes")!.value).toBe(25); // plain counts survive
    expect(pm.find((x) => x.metric === "reach")).toMatchObject({ value: null, status: "UNAVAILABLE" });
    const d = (await api("get", `/social/analytics/accounts/${igId}?from=2026-10-05&to=2026-10-07`, analystToken)).body.data;
    expect(d.kpis.find((k: { metric: string }) => k.metric === "reach")).toMatchObject({ current: null });
    expect(d.kpis.find((k: { metric: string }) => k.metric === "reach").unavailableReason).toMatch(/Insights permission/);
    expect(d.account.sync.lastError).toMatch(/Insights permission/);
  });
  it("re-checks metrics cached as unavailable right after the account is reconnected, not only weekly", async () => {
    await clear();
    const asked: string[] = [];
    await prisma.$executeRaw`UPDATE social_accounts SET updated_at = ${new Date("2026-10-01T00:00:00Z")} WHERE id = ${igId}`; // the test clock is fixed in the past
    const base = handler;
    handler = (c) => { if (c.path === "/QA_IG_1/insights" && c.query.get("metric") === "views") asked.push("views"); return base(c); };
    await run();
    const firstRound = asked.length;
    expect(firstRound).toBeGreaterThan(0);
    asked.length = 0;
    await run(); // same day, nothing changed: the refused metric is not asked again
    expect(asked.length).toBe(0);
    const same = await prisma.socialAccount.findUniqueOrThrow({ where: { id: igId }, select: { displayName: true } });
    await prisma.socialAccount.update({ where: { id: igId }, data: { displayName: same.displayName } }); // bumps updated_at like a reconnect
    asked.length = 0;
    await run();
    expect(asked.length).toBeGreaterThan(0);
    handler = base;
  });
  it("a rate limit stops the run with an error and a 3-hour back-off (no partial zeros)", async () => {
    await clear();
    handler = (c) => (c.path === "/QA_IG_1/insights" ? { status: 400, body: errors.rateLimit } : igDefault(c));
    const r = await run();
    expect(r.outcome).toBe("error");
    expect(await count("socialAccountMetric", { socialAccountId: igId, metric: { not: "followers" } })).toBe(0);
    expect((await analyticsIngest.dueAccounts(new Date(NOW.getTime() + 60 * 60_000), 10)).map((a) => a.id)).not.toContain(igId); // backing off
    expect((await analyticsIngest.dueAccounts(new Date(NOW.getTime() + 4 * 3600_000), 10)).map((a) => a.id)).toContain(igId);
  });
  it("kill switches (env, global, workspace) stop all reads", async () => {
    await clear();
    mutable.socialAnalyticsDisabled = true;
    expect((await analyticsIngest.tick(NOW)).disabled).toBe(true);
    expect((await run()).reason).toBe("env_disabled");
    mutable.socialAnalyticsDisabled = false;
    await setKill(true, false);
    expect((await run()).reason).toBe("global_kill_switch");
    await setKill(false, true);
    expect((await run()).reason).toBe("workspace_kill_switch");
    expect(calls).toHaveLength(0);
    await setKill(false, false);
  });
  it("reads only: every Graph call is a GET", async () => {
    await clear();
    calls.length = 0;
    await run();
    expect(calls.length).toBeGreaterThan(10);
    const seen = new Set<string>();
    const orig = metaHttp.fetch;
    metaHttp.fetch = (async (url: string, init?: RequestInit) => { seen.add(init?.method ?? "GET"); return (orig as typeof fetch)(url, init); }) as typeof fetch;
    await clear();
    await run();
    metaHttp.fetch = orig;
    expect([...seen]).toEqual(["GET"]);
  });

  // ---------- read API ----------
  it("computes KPIs from stored numbers: sums only days with data, shows coverage, and compares only fully covered periods", async () => {
    await clear();
    await run();
    const d = (await api("get", `/social/analytics/accounts/${igId}?from=2026-10-05&to=2026-10-07`, analystToken)).body.data;
    const k = (m: string) => d.kpis.find((x: { metric: string }) => x.metric === m);
    expect(k("reach")).toMatchObject({ current: 250, daysWithData: 3, daysInRange: 3, previous: null, changePct: null });
    expect(k("reach").compareNote).toMatch(/Not compared: 3 of 3 days have data this period and 0 of 3/);
    expect(k("engagement")).toMatchObject({ current: 21, previous: 21, changePct: 0 }); // both periods fully covered
    expect(k("views")).toMatchObject({ current: null, daysWithData: 0 });
    expect(k("views").unavailableReason).toMatch(/code 100/);
    expect(k("followers")).toMatchObject({ current: null }); // the only snapshot is dated after the period (2026-10-08)
    const later = (await api("get", `/social/analytics/accounts/${igId}?from=2026-10-05&to=2026-10-08`, analystToken)).body.data.kpis.find((x: { metric: string }) => x.metric === "followers");
    expect(later).toMatchObject({ current: 1234, netChange: null }); // one snapshot: no invented net change
    expect(d.coverage.firstDataDate).toBe("2026-09-08");
    expect(d.account.historyDays).toBe(30);
    expect((await api("get", "/social/analytics/accounts/" + igId + "?from=2026-10-09&to=2026-10-01", analystToken)).status).toBe(400);
  });
  it("audience: follower series and honest net change; demographics carry the reason", async () => {
    const day = (s: string) => new Date(`${s}T00:00:00Z`);
    await prisma.socialAccountMetric.createMany({ data: [{ organizationId: orgId, socialAccountId: igId, metric: "followers", metricDate: day("2026-10-01"), value: 1200, status: "OK" }, { organizationId: orgId, socialAccountId: igId, metric: "follows_new", metricDate: day("2026-10-02"), value: 5, status: "OK" }], skipDuplicates: true });
    const a = (await api("get", `/social/analytics/accounts/${igId}/audience?from=2026-10-01&to=2026-10-08`, analystToken)).body.data;
    expect(a.followers.first).toEqual({ date: "2026-10-01", value: 1200 });
    expect(a.followers.current).toEqual({ date: "2026-10-08", value: 1234 });
    expect(a.followers.netChange).toEqual({ value: 34, fromDate: "2026-10-01", toDate: "2026-10-08" });
    expect(a.followers.historyNote).toMatch(/does not provide earlier follower totals/);
    expect(a.demographicsSupported).toBe(true);
    expect(a.demographics.every((x: { status: string; reason: string }) => x.status === "UNAVAILABLE" && /fewer than 100/.test(x.reason))).toBe(true);
  });
  it("top posts and the drill-down link back to the Composer post", async () => {
    const t = (await api("get", `/social/analytics/accounts/${igId}/posts?from=2026-10-01&to=2026-10-08&sort=reach`, analystToken)).body.data;
    expect(t.rows[0]).toMatchObject({ targetId, postId, externalUrl: "https://www.instagram.com/p/QA/" });
    expect(t.rows[0].metrics.reach.value).toBe(300);
    expect(t.rows[0].metrics.shares).toMatchObject({ value: null, status: "UNAVAILABLE" });
    const p = (await api("get", `/social/analytics/posts/${targetId}`, analystToken)).body.data;
    expect(p.composerPostId).toBe(postId);
    expect(p.history.length).toBeGreaterThan(0);
    expect(p.latest.metrics.likes.value).toBe(25);
  });
  it("best posting times need enough of our own data and say why not", async () => {
    const b = (await api("get", `/social/analytics/accounts/${igId}/best-times?metric=interactions&tz=Not/AZone`, analystToken)).body.data;
    expect(b).toMatchObject({ enough: false, slots: [], timeZone: "UTC", postsWithData: 1, minPosts: 10 });
    expect(b.reason).toMatch(/Needs at least 10 published posts with numbers; there is 1 so far/);
    // 12 more posts, all at Tuesday 09:00 UTC with likes+comments → a ranked slot with its sample size
    for (let i = 0; i < 12; i++) {
      const p = await prisma.socialPost.create({ data: { organizationId: orgId, title: `QA_TEST_2026_ bt ${i}`, body: "x", status: "PUBLISHED", timezone: "UTC" } });
      const t = await prisma.socialPostTarget.create({ data: { postId: p.id, socialAccountId: igId, status: "PUBLISHED", publishedAt: new Date(Date.UTC(2026, 8, 1 + 7 * (i % 3) + 0, 9, 0)), externalPostId: `BT${i}` } });
      await prisma.socialPostMetric.createMany({ data: [{ organizationId: orgId, socialAccountId: igId, targetId: t.id, capturedOn: new Date("2026-10-08"), metric: "likes", value: 10 + i, status: "OK" }, { organizationId: orgId, socialAccountId: igId, targetId: t.id, capturedOn: new Date("2026-10-08"), metric: "comments", value: 2, status: "OK" }] });
    }
    const ok = (await api("get", `/social/analytics/accounts/${igId}/best-times?metric=interactions`, analystToken)).body.data;
    expect(ok.enough).toBe(true);
    expect(ok.slots[0]).toMatchObject({ weekday: "Tue", hour: 9 });
    expect(ok.slots[0].posts).toBeGreaterThanOrEqual(2);
    expect(ok.note).toMatch(/likes \+ comments/);
  });

  // ---------- export ----------
  it("exports CSV: empty cells for unavailable values, formulas neutralised, workspace scoped", async () => {
    const acc = await api("get", `/social/analytics/accounts/${igId}/export?kind=account&from=2026-10-05&to=2026-10-07`, analystToken);
    expect(acc.status).toBe(200);
    expect(acc.headers["content-type"]).toMatch(/text\/csv/);
    expect(acc.headers["content-disposition"]).toMatch(/attachment; filename="social-account_QA-TEST-2026-Instagram_2026-10-05_2026-10-07\.csv"/);
    const lines = acc.text.trim().split("\r\n");
    expect(lines[0]).toBe("date,followers,follows_new,unfollows,reach,views,engagement,profile_views,link_clicks");
    expect(lines).toHaveLength(4);
    expect(lines[1]!.split(",")[5]).toBe(""); // views: not available → empty, never 0
    expect(lines[1]!.split(",")[4]).toBe("100");
    const posts = await api("get", `/social/analytics/accounts/${igId}/export?kind=posts&from=2026-10-01&to=2026-10-08`, analystToken);
    expect(posts.text).toContain("'=HYPERLINK"); // formula injection neutralised
    expect(posts.text).not.toMatch(/(^|,)=HYPERLINK/m);
    expect(posts.text.split("\r\n")[0]).toBe("published_at,title,post_url,snapshot_date,reach,views,likes,comments,shares,saves,interactions");
  });

  // ---------- AI summary ----------
  it("hides the AI summary when no provider is configured and never calls a model without data", async () => {
    expect((await api("get", "/social/analytics/summary", analystToken)).body.data.aiAvailable).toBe(false);
    const r = await api("post", `/social/analytics/accounts/${igId}/summary`, analystToken, { from: "2026-10-05", to: "2026-10-07" });
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(r.body.error.message).toMatch(/no AI provider is configured/);
  });
  it("accepts an AI summary only if every figure exists in the stored data (retries once, then discards)", async () => {
    mutable.geminiApiKey = "test-key";
    expect((await api("get", "/social/analytics/summary", analystToken)).body.data.aiAvailable).toBe(true);
    const prompts: string[] = [];
    const replies = [
      JSON.stringify({ headline: "Reach grew 73% to 4,321", bullets: ["Reach was 250 over 3 days."] }), // invented figures
      JSON.stringify({ headline: "Reach was 250 over the period", bullets: ["Engagement was 21.", "Views are not available."] }),
    ];
    let i = 0;
    const spy = vi.spyOn(AdapterFactory, "getAdapter").mockReturnValue({ generateText: async (p: { prompt: string }) => { prompts.push(p.prompt); return { text: replies[Math.min(i++, replies.length - 1)]!, inputTokens: 10, outputTokens: 10, totalTokens: 20 }; } } as never);
    const ok = await api("post", `/social/analytics/accounts/${igId}/summary`, analystToken, { from: "2026-10-05", to: "2026-10-07" });
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({ aiGenerated: true, headline: "Reach was 250 over the period" });
    expect(i).toBe(2);
    expect(prompts[0]).toContain('"current": 250');
    expect(prompts[0]).not.toContain("views\",\n      \"current\": 0");
    expect(await prisma.auditLog.count({ where: { organizationId: orgId, action: "SOCIAL_ANALYTICS_AI_SUMMARY" } })).toBe(1);
    i = 0; replies.splice(0, 2, JSON.stringify({ headline: "Reach hit 999", bullets: ["Up 12%."] }));
    const bad = await api("post", `/social/analytics/accounts/${igId}/summary`, analystToken, { from: "2026-10-05", to: "2026-10-07" });
    expect(bad.status).toBe(400);
    expect(bad.body.error.message).toMatch(/not in your stored data/);
    spy.mockRestore();
  });

  it("never logs or returns tokens", async () => {
    const text = logged.join("\n");
    expect(text).not.toContain(TOKEN);
    const s = JSON.stringify((await api("get", "/social/analytics/summary", analystToken)).body);
    expect(s).not.toContain(TOKEN);
  });
});
