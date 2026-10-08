/**
 * Facebook Pages (Step 8) end to end through the real API and database with a STUBBED Graph transport (no real network):
 * connect + Page picker, token storage, health, publishing safety layers, webhook handshake/signature/idempotency, inbox replies and the messaging window.
 * Test data tagged QA_TEST_2026_.
 */
import { createHmac } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

vi.mock("../../server/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/config/env")>();
  return { ...actual, config: { ...actual.config, metaAppId: "QA_APP_ID", metaAppSecret: "qa-app-secret-0123456789abcdef", metaWebhookVerifyToken: "qa-verify-token-xyz", metaApiVersion: "v25.0", metaAppMode: "development" } };
});
import { config } from "../../server/config/env";
import { createApp, finalizeApp } from "../../server/app/app";
import { disconnectPrisma, prisma } from "../../server/db/prisma";
import { logger } from "../../server/core/logger";
import { resetDb } from "../helpers/db";
import { metaHttp } from "../../server/services/social/connectors/metaGraph";
import { publisher } from "../../server/services/social/publishing/publisher";
import { socialAccountService } from "../../server/services/social/socialAccountService";
import { tokenVault } from "../../server/services/social/tokenVault";
import { inboxTick } from "../../server/services/social/inbox/inboxPipeline";

const mutable = config as unknown as Record<string, unknown>;
const SECRET = "qa-app-secret-0123456789abcdef";
const PAGE_TOKEN = "QA_PAGE_TOKEN_ONE_aaaaaaaaaaaaaaaaaaaaaaaa";
const PAGE2_TOKEN = "QA_PAGE_TOKEN_TWO_bbbbbbbbbbbbbbbbbbbbbbbb";
const USER_TOKEN = "QA_LONG_USER_TOKEN_cccccccccccccccccccc";
const SHORT_TOKEN = "QA_SHORT_USER_TOKEN_dddddddddddddddddd";
const ROLE_KEY = "QA_TEST_2026_META_AGENT";

interface Call { url: URL; method: string; body: Record<string, unknown> | null }

describe("meta facebook", () => {
  const app = createApp();
  finalizeApp(app);
  let adminToken = "", agentToken = "", otherToken = "", orgId = "";
  let page1 = "", page2 = "";
  let ip = 10, seq = 0;
  const logged: string[] = [];
  const calls: Call[] = [];
  const original = metaHttp.fetch;
  /** Routes by Graph path so tests don't depend on call order. Override `behaviour` per test. */
  let behaviour: (path: string, call: Call) => { status?: number; body: unknown } | Error = () => ({ body: {} });
  const defaultBehaviour: typeof behaviour = (path, call) => {
    if (path.endsWith("/oauth/access_token")) return { body: call.url.searchParams.get("grant_type") === "fb_exchange_token" ? { access_token: USER_TOKEN, expires_in: 5184000 } : { access_token: SHORT_TOKEN } };
    if (path.endsWith("/me/permissions")) return { body: { data: [{ permission: "pages_manage_posts", status: "granted" }, { permission: "pages_manage_engagement", status: "granted" }, { permission: "pages_read_engagement", status: "granted" }, { permission: "pages_messaging", status: "granted" }] } };
    if (path.endsWith("/me/accounts")) return { body: { data: [
      { id: "QA_PAGE_1", name: "QA_TEST_2026_ Page One", category: "Software", access_token: PAGE_TOKEN, tasks: ["CREATE_CONTENT", "MODERATE", "MESSAGING"], picture: { data: { url: "https://img.example/1.png" } } },
      { id: "QA_PAGE_2", name: "QA_TEST_2026_ Page Two", category: "Retail", access_token: PAGE2_TOKEN, tasks: ["ANALYZE"] },
    ] } };
    if (path.endsWith("/me")) return { body: { id: "QA_USER", name: "QA User" } };
    if (path.endsWith("/subscribed_apps")) return { body: { success: true } };
    if (path.endsWith("/debug_token")) return { body: { data: { is_valid: true, expires_at: 0, data_access_expires_at: 0, scopes: ["pages_manage_posts", "pages_manage_engagement", "pages_read_engagement", "pages_messaging"] } } };
    if (path.endsWith("/feed")) return { body: { id: `QA_PAGE_1_POST${++seq}` } };
    if (path.endsWith("/photos")) return { body: { id: "PHOTO1", post_id: `QA_PAGE_1_POST${++seq}` } };
    if (path.endsWith("/comments")) return { body: { id: `REPLY_${++seq}` } };
    if (path.endsWith("/me/messages")) return { body: { recipient_id: "PSID", message_id: `m_out_${++seq}` } };
    return { body: { success: true } };
  };
  const callsTo = (suffix: string) => calls.filter((c) => c.url.pathname.endsWith(suffix));

  const hdr = () => `10.8.${Math.floor(ip / 250)}.${ip++ % 250}`;
  const api = (method: "get" | "post" | "put", path: string, token: string, body?: object) => {
    const r = request(app)[method](`/api/v1${path}`).set("Authorization", `Bearer ${token}`).set("X-Forwarded-For", hdr());
    return method === "get" ? r : r.send(body ?? {});
  };
  async function makeUser(email: string, roleKey: string) {
    await api("post", "/users", adminToken, { email, password: "Str0ng-Passphrase-77", firstName: "QA", lastName: "Meta", roleKey });
    const login = await request(app).post("/api/v1/auth/login").set("X-Forwarded-For", hdr()).send({ email, password: "Str0ng-Passphrase-77" });
    return { token: login.body.data.session.token as string, id: login.body.data.user.id as string };
  }
  const startAndCallback = async (token: string, reconnectAccountId?: string) => {
    const start = await api("post", "/social/accounts/connect/start", token, { provider: "meta_facebook", ...(reconnectAccountId ? { accountId: reconnectAccountId } : {}) });
    expect(start.status).toBe(200);
    const state = new URL(start.body.data.authUrl).searchParams.get("state")!;
    return { start, cb: await api("post", "/social/accounts/callback", token, { state, code: "QA_CODE" }) };
  };
  const signed = (events: object, secret = SECRET) => {
    const raw = JSON.stringify(events);
    return { raw, sig: `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}` };
  };
  const deliver = (payload: object, opts: { sig?: string | null; raw?: string } = {}) => {
    const { raw, sig } = signed(payload);
    const r = request(app).post("/api/v1/social/webhooks/meta_facebook").set("Content-Type", "application/json").set("X-Forwarded-For", hdr());
    if (opts.sig !== null) r.set("X-Hub-Signature-256", opts.sig ?? sig);
    return r.send(opts.raw ?? raw);
  };
  const commentPayload = (id: string, over: Record<string, unknown> = {}) => ({ object: "page", entry: [{ id: "QA_PAGE_1", time: 1, changes: [{ field: "feed", value: { from: { id: "U100", name: "Ada Lovelace" }, item: "comment", comment_id: id, post_id: "QA_PAGE_1_POST1", verb: "add", created_time: Math.floor(Date.now() / 1000), message: `What are your hours? ${id}`, parent_id: "QA_PAGE_1_POST1", ...over } }] }] });
  const dmPayload = (mid: string, psid = "PSID1") => ({ object: "page", entry: [{ id: "QA_PAGE_1", time: Date.now(), messaging: [{ sender: { id: psid }, recipient: { id: "QA_PAGE_1" }, timestamp: Date.now(), message: { mid, text: `Hello there ${mid}` } }] }] });

  const setPublishing = async (g: { enabled?: boolean; dryRun?: boolean; kill?: boolean; wKill?: boolean }) => {
    await prisma.socialPublishingGlobal.upsert({ where: { id: "global" }, create: { id: "global", enabled: g.enabled ?? false, dryRun: g.dryRun ?? false, killSwitch: g.kill ?? false }, update: { enabled: g.enabled ?? false, dryRun: g.dryRun ?? false, killSwitch: g.kill ?? false } });
    const w = { enabled: g.enabled ?? false, dryRun: g.dryRun ?? false, killSwitch: g.wKill ?? false };
    await prisma.socialPublishingSetting.upsert({ where: { organizationId: orgId }, create: { organizationId: orgId, ...w }, update: w });
  };
  async function scheduledPost(body: string, accountIds = [page1]) {
    seq += 1;
    const created = await api("post", "/social/posts", adminToken, { title: `QA_TEST_2026_ fb ${seq}`, body: `${body} (qa-fb-${seq}-${Date.now()})`, accountIds });
    expect(created.status).toBe(201);
    const id = created.body.data.post.id as string;
    expect((await api("post", `/social/posts/${id}/submit`, adminToken)).status).toBe(200);
    if ((await prisma.socialPost.findUniqueOrThrow({ where: { id } })).status === "PENDING_APPROVAL") expect((await api("post", `/social/posts/${id}/approve`, adminToken, {})).status).toBe(200);
    expect((await api("post", `/social/posts/${id}/schedule`, adminToken, { scheduledAt: new Date(Date.now() + 3600_000).toISOString(), timezone: "UTC" })).status).toBe(200);
    const due = new Date(Date.now() - 60_000);
    await prisma.socialPost.update({ where: { id }, data: { scheduledAt: due } });
    await prisma.socialPostTarget.updateMany({ where: { postId: id }, data: { scheduledAt: due } });
    return { postId: id, targetId: (await prisma.socialPostTarget.findFirstOrThrow({ where: { postId: id, socialAccountId: accountIds[0] } })).id };
  }

  beforeAll(async () => {
    await resetDb();
    for (const level of ["info", "warn", "error", "debug"] as const) vi.spyOn(logger, level).mockImplementation(((...args: unknown[]) => { logged.push(JSON.stringify(args)); }) as never);
    metaHttp.fetch = (async (url: string, init: RequestInit) => {
      const u = new URL(url);
      const call: Call = { url: u, method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : null };
      calls.push(call);
      const r = behaviour(u.pathname, call);
      if (r instanceof Error) throw r;
      return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
    }) as typeof fetch;

    const reg = await request(app).post("/api/v1/auth/register").set("X-Forwarded-For", "10.0.6.1").send({ email: "qa-meta-admin@example.com", password: "Str0ng-Passphrase-77", firstName: "QA", lastName: "Admin", organizationName: "QA_TEST_2026_ Meta" });
    adminToken = reg.body.data.session.token;
    orgId = reg.body.data.user.organizationId;
    otherToken = (await request(app).post("/api/v1/auth/register").set("X-Forwarded-For", "10.0.6.2").send({ email: "qa-meta-other@example.com", password: "Str0ng-Passphrase-77", firstName: "QA", lastName: "Other", organizationName: "QA_TEST_2026_ Other Meta" })).body.data.session.token;
    const role = await prisma.role.create({ data: { key: ROLE_KEY, name: ROLE_KEY, isSystem: false } });
    const perms = await prisma.permission.findMany({ where: { key: { in: ["social.read", "social.reply", "social.publish"] } } });
    await prisma.rolePermission.createMany({ data: perms.map((p) => ({ roleId: role.id, permissionId: p.id })) });
    const agent = await makeUser("qa-meta-agent@example.com", ROLE_KEY);
    agentToken = agent.token;
  });
  afterAll(async () => {
    metaHttp.fetch = original;
    await setPublishing({});
    vi.restoreAllMocks();
    const roles = await prisma.role.findMany({ where: { key: ROLE_KEY } });
    for (const r of roles) {
      await prisma.rolePermission.deleteMany({ where: { roleId: r.id } });
      await prisma.organizationMembership.deleteMany({ where: { roleId: r.id } });
      await prisma.user.deleteMany({ where: { roleId: r.id } });
      await prisma.role.delete({ where: { id: r.id } });
    }
    await disconnectPrisma();
  });
  beforeEach(() => { calls.length = 0; behaviour = defaultBehaviour; mutable.socialPublishingDisabled = false; });

  // ---------- Connected Accounts ----------
  it("lists Facebook Pages as configured and available when META_APP_ID and META_APP_SECRET are set", async () => {
    const list = await api("get", "/social/accounts", agentToken);
    expect(list.body.data.providers.find((p: { key: string }) => p.key === "meta_facebook")).toMatchObject({ label: "Facebook Pages", configured: true, available: true });
    mutable.metaAppSecret = "";
    const off = await api("get", "/social/accounts", agentToken);
    expect(off.body.data.providers.find((p: { key: string }) => p.key === "meta_facebook")).toMatchObject({ configured: false, available: false });
    mutable.metaAppSecret = SECRET;
  });

  it("serves setup guidance to administrators only, without secret values", async () => {
    const res = await api("get", "/social/accounts/providers/meta_facebook/setup", adminToken);
    expect(res.status).toBe(200);
    expect(res.body.data.setup).toMatchObject({ configured: true, verifyTokenConfigured: true, appMode: "development", apiVersion: "v25.0", verifyTokenEnvVar: "META_WEBHOOK_VERIFY_TOKEN" });
    expect(res.body.data.setup.webhookCallbackUrl).toMatch(/\/api\/v1\/social\/webhooks\/meta_facebook$/);
    expect(res.body.data.setup.redirectUri).toMatch(/\/social\/accounts$/);
    expect(JSON.stringify(res.body)).not.toContain("qa-verify-token-xyz");
    expect(JSON.stringify(res.body)).not.toContain(SECRET);
    expect((await api("get", "/social/accounts/providers/meta_facebook/setup", agentToken)).status).toBe(403);
    expect((await api("get", "/social/accounts/providers/linkedin/setup", adminToken)).status).toBe(404);
  });

  it("connects: OAuth returns a Page picker (no tokens), then creates one SocialAccount per chosen Page with encrypted Page tokens", async () => {
    const { start, cb } = await startAndCallback(adminToken);
    const authUrl = new URL(start.body.data.authUrl);
    expect(`${authUrl.origin}${authUrl.pathname}`).toBe("https://www.facebook.com/v25.0/dialog/oauth");
    expect(authUrl.searchParams.get("client_id")).toBe("QA_APP_ID");
    expect(cb.status).toBe(200);
    const selection = cb.body.data.selection;
    expect(selection.pages.map((p: { externalId: string }) => p.externalId)).toEqual(["QA_PAGE_1", "QA_PAGE_2"]);
    expect(selection.pages[1].warnings.length).toBe(3);
    const body = JSON.stringify(cb.body);
    for (const secret of [PAGE_TOKEN, PAGE2_TOKEN, USER_TOKEN, SHORT_TOKEN]) expect(body).not.toContain(secret);
    expect(await prisma.socialAccount.count({ where: { organizationId: orgId, provider: "meta_facebook" } })).toBe(0); // nothing is created until the user chooses
    // the pending session is encrypted at rest
    const session = await prisma.socialConnectSession.findUniqueOrThrow({ where: { id: selection.id } });
    for (const secret of [PAGE_TOKEN, PAGE2_TOKEN, USER_TOKEN]) expect(session.ciphertext).not.toContain(secret);

    // another user (or workspace) cannot use it; a bad id is rejected
    expect((await api("post", "/social/accounts/connect/select", otherToken, { selectionId: selection.id, externalIds: ["QA_PAGE_1"] })).status).toBe(401);
    expect((await api("post", "/social/accounts/connect/select", adminToken, { selectionId: selection.id, externalIds: ["NOT_A_PAGE"] })).status).toBe(400);
    // (that failed attempt consumed the single-use session)
    expect((await api("post", "/social/accounts/connect/select", adminToken, { selectionId: selection.id, externalIds: ["QA_PAGE_1"] })).status).toBe(401);

    const again = await startAndCallback(adminToken);
    calls.length = 0;
    const chosen = await api("post", "/social/accounts/connect/select", adminToken, { selectionId: again.cb.body.data.selection.id, externalIds: ["QA_PAGE_1", "QA_PAGE_2"] });
    expect(chosen.status).toBe(200);
    expect(chosen.body.data.accounts).toHaveLength(2);
    expect(chosen.body.data.accounts[0]).toMatchObject({ provider: "meta_facebook", externalAccountId: "QA_PAGE_1", displayName: "QA_TEST_2026_ Page One", accountType: "PAGE", status: "CONNECTED", tokenExpiresAt: null });
    const resBody = JSON.stringify(chosen.body);
    for (const secret of [PAGE_TOKEN, PAGE2_TOKEN, USER_TOKEN]) expect(resBody).not.toContain(secret);
    page1 = chosen.body.data.accounts[0].id; page2 = chosen.body.data.accounts[1].id;

    // Page tokens are stored encrypted, bound to their account; the user token is never stored
    const cred = await prisma.socialAccountCredential.findUniqueOrThrow({ where: { socialAccountId: page1 } });
    expect(cred.ciphertext).not.toContain(PAGE_TOKEN);
    expect(tokenVault.decrypt(cred.ciphertext, cred.keyVersion, page1)).toMatchObject({ accessToken: PAGE_TOKEN, pageId: "QA_PAGE_1" });
    expect(() => tokenVault.decrypt(cred.ciphertext, cred.keyVersion, page2)).toThrow();
    const allCreds = JSON.stringify(await prisma.socialAccountCredential.findMany({ where: { socialAccountId: { in: [page1, page2] } } }));
    for (const secret of [USER_TOKEN, SHORT_TOKEN]) expect(allCreds).not.toContain(secret);
    expect(await prisma.socialConnectSession.count({ where: { organizationId: orgId } })).toBe(0);

    // the app was subscribed to each Page's webhooks using that Page's own token
    const subs = callsTo("/subscribed_apps");
    expect(subs.map((c) => c.url.pathname)).toEqual(["/v25.0/QA_PAGE_1/subscribed_apps", "/v25.0/QA_PAGE_2/subscribed_apps"]);
    expect(subs[0]!.body).toMatchObject({ subscribed_fields: "feed,messages,mention", access_token: PAGE_TOKEN });
    expect(subs[0]!.url.search).not.toContain("access_token"); // never in a POST URL
    expect(await prisma.auditLog.count({ where: { organizationId: orgId, action: "SOCIAL_ACCOUNT_CONNECTED", resourceId: { in: [page1, page2] } } })).toBe(2);
  });

  it("health check validates the token and permissions through /debug_token; missing permissions or an invalid token need re-auth", async () => {
    expect((await api("post", `/social/accounts/${page1}/health`, adminToken)).body.data.account.status).toBe("CONNECTED");
    behaviour = (p) => (p.endsWith("/debug_token") ? { body: { data: { is_valid: true, scopes: ["pages_manage_posts"] } } } : { body: {} });
    const missing = await api("post", `/social/accounts/${page1}/health`, adminToken);
    expect(missing.body.data.account).toMatchObject({ status: "NEEDS_REAUTH" });
    expect(missing.body.data.account.lastError).toMatch(/pages_manage_engagement/);
    behaviour = (p) => (p.endsWith("/debug_token") ? { body: { data: { is_valid: false, error: { message: `expired ${PAGE_TOKEN}` } } } } : { body: {} });
    const invalid = await api("post", `/social/accounts/${page1}/health`, adminToken);
    expect(invalid.body.data.account.status).toBe("NEEDS_REAUTH");
    expect(JSON.stringify(invalid.body)).not.toContain(PAGE_TOKEN);
    // reconnecting that exact Page completes without the picker and restores it
    behaviour = defaultBehaviour;
    const { cb } = await startAndCallback(adminToken, page1);
    expect(cb.body.data.account).toMatchObject({ id: page1, status: "CONNECTED" });
    expect(cb.body.data.selection).toBeUndefined();
    // a different Page than the one being reconnected is refused
    behaviour = (p, c) => (p.endsWith("/me/accounts") ? { body: { data: [{ id: "QA_PAGE_9", name: "Else", access_token: "X".repeat(30), tasks: [] }] } } : defaultBehaviour(p, c));
    const wrong = await startAndCallback(adminToken, page1);
    expect(wrong.cb.status).toBe(400);
  });

  // ---------- publishing ----------
  it("publishes a due post to the Page with the Page token — only when the safety layers allow it", async () => {
    const { targetId, postId } = await scheduledPost("Hello Facebook");
    expect((await publisher.publishTarget(targetId)).detail).toBe("global_off");
    expect(callsTo("/feed")).toHaveLength(0);

    await setPublishing({ enabled: true, dryRun: true });
    expect((await publisher.publishTarget(targetId)).outcome).toBe("dry_run");
    expect(callsTo("/feed")).toHaveLength(0); // dry-run: everything except the final call
    await prisma.socialPostTarget.update({ where: { id: targetId }, data: { status: "SCHEDULED", attempts: 0 } });
    await prisma.socialPost.update({ where: { id: postId }, data: { status: "SCHEDULED" } });

    await setPublishing({ enabled: true, wKill: true });
    expect((await publisher.publishTarget(targetId)).outcome).toBe("blocked");
    expect(callsTo("/feed")).toHaveLength(0);

    await setPublishing({ enabled: true });
    expect((await publisher.publishTarget(targetId)).outcome).toBe("published");
    const feed = callsTo("/feed");
    expect(feed).toHaveLength(1);
    expect(feed[0]!.url.pathname).toBe("/v25.0/QA_PAGE_1/feed");
    expect(feed[0]!.body).toMatchObject({ access_token: PAGE_TOKEN, published: true });
    expect(feed[0]!.body).not.toHaveProperty("scheduled_publish_time");
    const t = await prisma.socialPostTarget.findUniqueOrThrow({ where: { id: targetId } });
    expect(t).toMatchObject({ status: "PUBLISHED" });
    expect(t.externalUrl).toMatch(/^https:\/\/www\.facebook\.com\/QA_PAGE_1\/posts\/POST\d+$/);
    // never twice
    await publisher.tick();
    expect(callsTo("/feed")).toHaveLength(1);
  });

  it("maps Graph failures onto the publisher's retry policy: transient retries, auth → needs re-auth, timeout → uncertain", async () => {
    await setPublishing({ enabled: true });
    behaviour = (p, c) => (p.endsWith("/feed") ? { status: 400, body: { error: { message: "rate", code: 4, type: "OAuthException" } } } : defaultBehaviour(p, c));
    const a = await scheduledPost("Rate limited");
    expect((await publisher.publishTarget(a.targetId, { backoff: { random: () => 0.5 } })).outcome).toBe("retry_scheduled");
    const aT = await prisma.socialPostTarget.findUniqueOrThrow({ where: { id: a.targetId } });
    expect(aT.status).toBe("SCHEDULED");
    expect(aT.nextAttemptAt!.getTime() - Date.now()).toBeGreaterThan(10 * 60_000); // honours the 15-minute rate-limit hint

    const b = await scheduledPost("Token revoked");
    behaviour = (p, c) => (p.endsWith("/feed") ? { status: 400, body: { error: { message: `bad ${PAGE_TOKEN}`, code: 190, type: "OAuthException" } } } : defaultBehaviour(p, c));
    expect((await publisher.publishTarget(b.targetId)).outcome).toBe("reauth");
    expect((await prisma.socialAccount.findUniqueOrThrow({ where: { id: page1 } })).status).toBe("NEEDS_REAUTH");
    const bT = await prisma.socialPostTarget.findUniqueOrThrow({ where: { id: b.targetId } });
    expect(bT.publishError).not.toContain(PAGE_TOKEN);
    await prisma.socialAccount.update({ where: { id: page1 }, data: { status: "CONNECTED", lastError: null } });

    const c = await scheduledPost("Timeout");
    behaviour = (p, call) => (p.endsWith("/feed") ? Object.assign(new Error("aborted"), { name: "AbortError" }) : defaultBehaviour(p, call));
    expect((await publisher.publishTarget(c.targetId)).outcome).toBe("uncertain");
    const timeoutCalls = () => callsTo("/feed").filter((x) => String(x.body?.message).includes("Timeout")).length;
    expect(timeoutCalls()).toBe(1);
    await publisher.tick({ now: new Date(Date.now() + 3 * 3600_000) });
    expect(timeoutCalls()).toBe(1); // an unknown outcome is never retried automatically
    expect((await prisma.socialPostTarget.findUniqueOrThrow({ where: { id: c.targetId } })).status).toBe("UNCERTAIN");
  });

  // ---------- webhooks ----------
  it("answers Meta's GET hub.challenge handshake — and fails closed", async () => {
    const q = (over: Record<string, string> = {}) => ({ "hub.mode": "subscribe", "hub.verify_token": "qa-verify-token-xyz", "hub.challenge": "1158201444", ...over });
    const ok = await request(app).get("/api/v1/social/webhooks/meta_facebook").query(q()).set("X-Forwarded-For", hdr());
    expect(ok.status).toBe(200);
    expect(ok.text).toBe("1158201444");
    expect(ok.headers["content-type"]).toMatch(/text\/plain/);
    expect((await request(app).get("/api/v1/social/webhooks/meta_facebook").query(q({ "hub.verify_token": "wrong" })).set("X-Forwarded-For", hdr())).status).toBe(403);
    expect((await request(app).get("/api/v1/social/webhooks/meta_facebook").query(q({ "hub.mode": "unsubscribe" })).set("X-Forwarded-For", hdr())).status).toBe(403);
    expect((await request(app).get("/api/v1/social/webhooks/meta_facebook").set("X-Forwarded-For", hdr())).status).toBe(403);
    mutable.metaWebhookVerifyToken = "";
    expect((await request(app).get("/api/v1/social/webhooks/meta_facebook").query(q({ "hub.verify_token": "" })).set("X-Forwarded-For", hdr())).status).toBe(403);
    mutable.metaWebhookVerifyToken = "qa-verify-token-xyz";
    expect((await request(app).get("/api/v1/social/webhooks/mock").query(q()).set("X-Forwarded-For", hdr())).status).toBe(404); // providers without a handshake
    expect((await request(app).get("/api/v1/social/webhooks/nope").query(q()).set("X-Forwarded-For", hdr())).status).toBe(404);
  });

  it("verifies X-Hub-Signature-256 over the raw body: bad, missing and re-serialised bodies are rejected and nothing is stored", async () => {
    const before = await prisma.socialMessage.count();
    const payload = commentPayload("QA_C_BAD");
    expect((await deliver(payload, { sig: null })).status).toBe(401);
    expect((await deliver(payload, { sig: "sha256=" + "0".repeat(64) })).status).toBe(401);
    expect((await deliver(payload, { sig: signed(payload, "another-secret").sig })).status).toBe(401);
    const { sig } = signed(payload);
    expect((await deliver(payload, { sig, raw: JSON.stringify(payload, null, 2) })).status).toBe(401); // same JSON, different bytes
    expect(await prisma.socialMessage.count()).toBe(before);
    mutable.metaAppSecret = "";
    expect((await deliver(payload)).status).toBe(404); // not configured → provider unavailable
    mutable.metaAppSecret = SECRET;
  });

  it("ingests signed comment and Messenger events idempotently, ignores unknown Pages and the Page's own messages", async () => {
    const c = commentPayload("QA_C_1");
    const first = await deliver(c);
    expect(first.status).toBe(200);
    expect(first.body.data).toMatchObject({ accepted: 1, duplicates: 0 });
    expect((await deliver(c)).body.data).toMatchObject({ accepted: 0, duplicates: 1 });
    const conv = await prisma.socialConversation.findFirstOrThrow({ where: { socialAccountId: page1, providerThreadId: "c:QA_C_1" } });
    expect(conv).toMatchObject({ type: "COMMENT", participantName: "Ada Lovelace", subjectRef: "QA_PAGE_1_POST1", organizationId: orgId });
    // a reply from another person lands in the same thread
    await deliver(commentPayload("QA_C_2", { from: { id: "U101", name: "Grace" }, parent_id: "QA_C_1" }));
    expect(await prisma.socialMessage.count({ where: { conversationId: conv.id } })).toBe(2);

    const d = dmPayload("m_in_1");
    expect((await deliver(d)).body.data).toMatchObject({ accepted: 1 });
    expect((await deliver(d)).body.data).toMatchObject({ duplicates: 1 });
    expect(await prisma.socialConversation.count({ where: { socialAccountId: page1, providerThreadId: "dm:PSID1" } })).toBe(1);

    const unknown = { ...dmPayload("m_unknown"), entry: [{ ...dmPayload("m_unknown").entry[0]!, id: "SOME_OTHER_PAGE" }] };
    expect((await deliver(unknown)).body.data).toMatchObject({ accepted: 0, ignored: 1 }); // a Page we don't know is acknowledged (200) but ignored
    const echo = { object: "page", entry: [{ id: "QA_PAGE_1", messaging: [{ sender: { id: "QA_PAGE_1" }, recipient: { id: "PSID1" }, timestamp: 1, message: { mid: "m_echo", text: "ours", is_echo: true } }] }] };
    expect((await deliver(echo)).body.data).toMatchObject({ accepted: 0, duplicates: 0 });
    expect(await prisma.socialMessage.count({ where: { providerMessageId: "m_echo" } })).toBe(0);
  });

  // ---------- inbox: replies & window ----------
  it("replies to a comment through Graph (reply to that comment) with the Page token", async () => {
    await deliver(commentPayload("QA_C_REPLY"));
    const conv = await prisma.socialConversation.findFirstOrThrow({ where: { socialAccountId: page1, providerThreadId: "c:QA_C_REPLY" } });
    calls.length = 0;
    const res = await api("post", `/social/inbox/conversations/${conv.id}/reply`, agentToken, { body: "We open at 9, Monday to Friday." });
    expect(res.status).toBe(200);
    expect(res.body.data.message.sendStatus).toBe("SENT");
    const sent = callsTo("/comments");
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url.pathname).toBe("/v25.0/QA_C_REPLY/comments");
    expect(sent[0]!.body).toMatchObject({ message: "We open at 9, Monday to Friday.", access_token: PAGE_TOKEN });
    expect(sent[0]!.url.search).not.toContain(PAGE_TOKEN);
    // comments can also be hidden / unhidden
    const msg = await prisma.socialMessage.findFirstOrThrow({ where: { conversationId: conv.id, direction: "INBOUND" } });
    calls.length = 0;
    expect((await api("post", `/social/inbox/messages/${msg.id}/hide`, agentToken, { hidden: true })).body.data.hidden).toBe(true);
    expect(calls[0]!.url.pathname).toBe("/v25.0/QA_C_REPLY");
    expect(calls[0]!.body).toMatchObject({ is_hidden: true });
  });

  it("replies to Messenger inside the 24-hour window as RESPONSE (no tag), and blocks it with a clear error outside the window", async () => {
    await deliver(dmPayload("m_in_win", "PSID_WIN"));
    const conv = await prisma.socialConversation.findFirstOrThrow({ where: { socialAccountId: page1, providerThreadId: "dm:PSID_WIN" } });
    const detail = (await api("get", `/social/inbox/conversations/${conv.id}`, agentToken)).body.data;
    expect(detail.replyWindow).toMatchObject({ open: true });
    expect(new Date(detail.replyWindow.closesAt).getTime()).toBeGreaterThan(Date.now() + 23 * 3600_000);

    calls.length = 0;
    const ok = await api("post", `/social/inbox/conversations/${conv.id}/reply`, agentToken, { body: "Happy to help!" });
    expect(ok.body.data.message.sendStatus).toBe("SENT");
    const sent = callsTo("/me/messages");
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body).toMatchObject({ recipient: { id: "PSID_WIN" }, messaging_type: "RESPONSE", message: { text: "Happy to help!" }, access_token: PAGE_TOKEN });
    expect(sent[0]!.body).not.toHaveProperty("tag");

    // 25 hours after the person's last message the window is closed
    await prisma.socialConversation.update({ where: { id: conv.id }, data: { lastInboundAt: new Date(Date.now() - 25 * 3600_000) } });
    const closed = (await api("get", `/social/inbox/conversations/${conv.id}`, agentToken)).body.data.replyWindow;
    expect(closed).toMatchObject({ open: false });
    expect(closed.reason).toMatch(/24 hours/);
    calls.length = 0;
    const blocked = await api("post", `/social/inbox/conversations/${conv.id}/reply`, agentToken, { body: "Too late?" });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.message).toMatch(/24 hours/);
    expect(callsTo("/me/messages")).toHaveLength(0);
    expect(await prisma.socialMessage.count({ where: { conversationId: conv.id, body: "Too late?" } })).toBe(0); // nothing was even created
  });

  it("Meta's own outside-the-window error is surfaced as a clear, non-retried failure", async () => {
    await deliver(dmPayload("m_in_meta", "PSID_META"));
    const conv = await prisma.socialConversation.findFirstOrThrow({ where: { socialAccountId: page1, providerThreadId: "dm:PSID_META" } });
    behaviour = (p, c) => (p.endsWith("/me/messages") ? { status: 400, body: { error: { message: "outside window", code: 10, error_subcode: 2018278, type: "OAuthException" } } } : defaultBehaviour(p, c));
    const res = await api("post", `/social/inbox/conversations/${conv.id}/reply`, agentToken, { body: "hello" });
    expect(res.status).toBe(200);
    expect(res.body.data.message).toMatchObject({ sendStatus: "FAILED" });
    expect(res.body.data.message.sendError).toMatch(/24 hours/);
  });

  it("the publishing kill switch blocks replies, and marking a Messenger thread read sends mark_seen", async () => {
    await deliver(dmPayload("m_in_kill", "PSID_KILL"));
    const conv = await prisma.socialConversation.findFirstOrThrow({ where: { socialAccountId: page1, providerThreadId: "dm:PSID_KILL" } });
    await setPublishing({ enabled: true, wKill: true });
    calls.length = 0;
    expect((await api("post", `/social/inbox/conversations/${conv.id}/reply`, agentToken, { body: "x" })).status).toBe(409);
    expect(callsTo("/me/messages")).toHaveLength(0);
    await setPublishing({});
    await api("post", `/social/inbox/conversations/${conv.id}/read`, agentToken, { read: true });
    expect(callsTo("/me/messages")[0]!.body).toMatchObject({ recipient: { id: "PSID_KILL" }, sender_action: "mark_seen" });
  });

  it("polling backfill is off unless META_INBOX_POLLING is set, and picks up missed items when on", async () => {
    calls.length = 0;
    await inboxTick();
    expect(callsTo("/conversations")).toHaveLength(0);
    mutable.metaInboxPolling = true;
    await prisma.socialInboxCursor.deleteMany({});
    behaviour = (p, c) => p.endsWith("/conversations")
      ? { body: { data: [{ updated_time: new Date().toISOString(), messages: { data: [{ id: "m_polled", message: "missed by webhook", from: { id: "PSID_POLL", name: "Poll" }, created_time: new Date().toISOString() }] } }] } }
      : p.endsWith("/feed") ? { body: { data: [] } } : defaultBehaviour(p, c);
    const out = await inboxTick();
    expect(out.polled.events).toBeGreaterThanOrEqual(1);
    expect(await prisma.socialMessage.count({ where: { socialAccountId: page1, providerMessageId: "m_polled" } })).toBe(1);
    mutable.metaInboxPolling = false;
  });

  // ---------- disconnect, scoping, privacy ----------
  it("disconnecting removes the webhook subscription and the stored token", async () => {
    calls.length = 0;
    const res = await api("post", `/social/accounts/${page2}/disconnect`, adminToken);
    expect(res.body.data.account.status).toBe("DISCONNECTED");
    expect(calls.some((c) => c.method === "DELETE" && c.url.pathname === "/v25.0/QA_PAGE_2/subscribed_apps")).toBe(true);
    expect(await prisma.socialAccountCredential.count({ where: { socialAccountId: page2 } })).toBe(0);
    // events for a disconnected Page are ignored
    const ev = { ...commentPayload("QA_C_DISC"), entry: [{ ...commentPayload("QA_C_DISC").entry[0]!, id: "QA_PAGE_2" }] };
    expect((await deliver(ev)).body.data).toMatchObject({ accepted: 0, ignored: 1 });
  });

  it("is workspace scoped: another workspace cannot see, select or reply", async () => {
    const conv = await prisma.socialConversation.findFirstOrThrow({ where: { socialAccountId: page1 } });
    expect((await api("get", `/social/inbox/conversations/${conv.id}`, otherToken)).status).toBe(404);
    expect((await api("post", `/social/inbox/conversations/${conv.id}/reply`, otherToken, { body: "x" })).status).toBe(404);
    expect((await api("get", "/social/accounts", otherToken)).body.data.accounts.map((a: { id: string }) => a.id)).not.toContain(page1);
  });

  it("never writes tokens or message text to logs, and never returns tokens from any API", async () => {
    const blob = logged.join("\n");
    expect(blob.length).toBeGreaterThan(0);
    for (const secret of [PAGE_TOKEN, PAGE2_TOKEN, USER_TOKEN, SHORT_TOKEN, SECRET, "qa-verify-token-xyz", "What are your hours?", "We open at 9"]) expect(blob).not.toContain(secret);
    const accounts = JSON.stringify((await api("get", "/social/accounts", adminToken)).body);
    for (const secret of [PAGE_TOKEN, PAGE2_TOKEN, USER_TOKEN]) expect(accounts).not.toContain(secret);
    expect(await socialAccountService.loadTokens(page1)).toMatchObject({ accessToken: PAGE_TOKEN }); // only the server-internal loader can read it
  });
});
