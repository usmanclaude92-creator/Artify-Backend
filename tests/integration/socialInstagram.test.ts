/**
 * Instagram (Step 9a) end to end through the real API and database with a STUBBED Graph transport (no real network):
 * connect + picker, text-only rejection, dry-run, container → poll → publish across several attempts, the UNCERTAIN path, the daily limit,
 * webhooks (signature, idempotency), comment / DM replies and the 24-hour window. Test data tagged QA_TEST_2026_.
 */
import { createHmac } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

vi.mock("../../server/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/config/env")>();
  return { ...actual, config: { ...actual.config, metaAppId: "QA_APP_ID", metaAppSecret: "qa-app-secret-0123456789abcdef", metaWebhookVerifyToken: "qa-verify-token-xyz", metaApiVersion: "v25.0", metaAppMode: "development", instagramDailyPublishLimit: 3, metaInstagramLoginScopes: "" } };
});
import { config } from "../../server/config/env";
import { createApp, finalizeApp } from "../../server/app/app";
import { disconnectPrisma, prisma } from "../../server/db/prisma";
import { logger } from "../../server/core/logger";
import { resetDb } from "../helpers/db";
import { metaHttp } from "../../server/services/social/connectors/metaGraph";
import { publisher } from "../../server/services/social/publishing/publisher";
import { tokenVault } from "../../server/services/social/tokenVault";

const mutable = config as unknown as Record<string, unknown>;
const SECRET = "qa-app-secret-0123456789abcdef";
const PAGE_TOKEN = "QA_IG_PAGE_TOKEN_aaaaaaaaaaaaaaaaaaaaaaaa";
const USER_TOKEN = "QA_IG_LONG_USER_TOKEN_cccccccccccccccccc";
const ROLE_KEY = "QA_TEST_2026_IG_AGENT";

interface Call { url: URL; method: string; body: Record<string, unknown> | null }

describe("meta instagram", () => {
  const app = createApp();
  finalizeApp(app);
  let adminToken = "", agentToken = "", orgId = "", ig = "", mediaId = "", pngId = "";
  let ip = 20, seq = 0;
  const logged: string[] = [];
  const calls: Call[] = [];
  const original = metaHttp.fetch;
  let behaviour: (path: string, call: Call) => { status?: number; body: unknown } | Error = () => ({ body: {} });
  let containerStatus = "FINISHED";
  const defaultBehaviour: typeof behaviour = (path, call) => {
    if (path.endsWith("/oauth/access_token")) return { body: { access_token: call.url.searchParams.get("grant_type") === "fb_exchange_token" ? USER_TOKEN : "QA_SHORT" } };
    if (path.endsWith("/me/permissions")) return { body: { data: ["instagram_basic", "instagram_content_publish", "instagram_manage_comments", "instagram_manage_messages", "pages_show_list", "pages_read_engagement"].map((permission) => ({ permission, status: "granted" })) } };
    if (path.endsWith("/me/accounts")) return { body: { data: [
      { id: "QA_PAGE_1", name: "QA_TEST_2026_ Page", access_token: PAGE_TOKEN, tasks: ["CREATE_CONTENT", "MODERATE", "MESSAGING"], instagram_business_account: { id: "QA_IG_1", username: "qa_artify", name: "QA_TEST_2026_ Artify" } },
      { id: "QA_PAGE_2", name: "Page without Instagram", access_token: "QA_OTHER_TOKEN_bbbbbbbbbbbbbbbbbbbb" },
    ] } };
    if (path.endsWith("/me")) return { body: { id: "QA_USER", name: "QA User" } };
    if (path.endsWith("/subscribed_apps")) return { body: call.method === "GET" ? { data: [{ id: "QA_APP_ID", subscribed_fields: ["feed"] }] } : { success: true } };
    if (path.endsWith("/debug_token")) return { body: { data: { is_valid: true, expires_at: 0, data_access_expires_at: 0, scopes: ["instagram_basic", "instagram_content_publish", "instagram_manage_comments", "instagram_manage_messages"] } } };
    if (path.endsWith("/content_publishing_limit")) return { body: { data: [{ quota_usage: 0, config: { quota_total: 100 } }] } };
    if (path === "/v25.0/QA_IG_1/media") return { body: { id: `QA_CONT_${++seq}` } };
    if (path.includes("/QA_CONT_")) return { body: { status_code: containerStatus } };
    if (path.endsWith("/media_publish")) return { body: { id: `QA_MEDIA_${++seq}` } };
    if (path.includes("/QA_MEDIA_")) return { body: { permalink: `https://www.instagram.com/p/QA${seq}/` } };
    if (path.endsWith("/replies")) return { body: { id: `QA_REPLY_${++seq}` } };
    if (path.endsWith("/messages")) return { body: { recipient_id: "IGSID", message_id: `mid_out_${++seq}` } };
    return { body: { success: true } };
  };
  const callsTo = (suffix: string) => calls.filter((c) => c.url.pathname.endsWith(suffix));

  const hdr = () => `10.9.${Math.floor(ip / 250)}.${ip++ % 250}`;
  const api = (method: "get" | "post" | "put", path: string, token: string, body?: object) => {
    const r = request(app)[method](`/api/v1${path}`).set("Authorization", `Bearer ${token}`).set("X-Forwarded-For", hdr());
    return method === "get" ? r : r.send(body ?? {});
  };
  const signed = (events: object) => {
    const raw = JSON.stringify(events);
    return { raw, sig: `sha256=${createHmac("sha256", SECRET).update(raw).digest("hex")}` };
  };
  const deliver = (payload: object, opts: { sig?: string | null } = {}) => {
    const { raw, sig } = signed(payload);
    const r = request(app).post("/api/v1/social/webhooks/meta_instagram").set("Content-Type", "application/json").set("X-Forwarded-For", hdr());
    if (opts.sig !== null) r.set("X-Hub-Signature-256", opts.sig ?? sig);
    return r.send(raw);
  };
  const commentPayload = (id: string) => ({ object: "instagram", entry: [{ id: "QA_IG_1", time: Math.floor(Date.now() / 1000), changes: [{ field: "comments", value: { from: { id: "U100", username: "ada" }, media: { id: "QA_IG_MEDIA1" }, id, text: `Is this available? ${id}` } }] }] });
  const dmPayload = (mid: string, igsid = "IGSID1") => ({ object: "instagram", entry: [{ id: "QA_IG_1", time: Date.now(), messaging: [{ sender: { id: igsid }, recipient: { id: "QA_IG_1" }, timestamp: Date.now(), message: { mid, text: `Hello ${mid}` } }] }] });

  const setPublishing = async (g: { enabled?: boolean; dryRun?: boolean }) => {
    await prisma.socialPublishingGlobal.upsert({ where: { id: "global" }, create: { id: "global", enabled: g.enabled ?? false, dryRun: g.dryRun ?? false, killSwitch: false }, update: { enabled: g.enabled ?? false, dryRun: g.dryRun ?? false, killSwitch: false } });
    const w = { enabled: g.enabled ?? false, dryRun: g.dryRun ?? false, killSwitch: false };
    await prisma.socialPublishingSetting.upsert({ where: { organizationId: orgId }, create: { organizationId: orgId, ...w }, update: w });
  };
  async function scheduledPost(label: string, mediaIds = [mediaId]) {
    seq += 1;
    const created = await api("post", "/social/posts", adminToken, { title: `QA_TEST_2026_ ig ${seq}`, body: `${label} (qa-ig-${seq}-${Date.now()})`, accountIds: [ig], mediaIds });
    expect(created.status).toBe(201);
    const id = created.body.data.post.id as string;
    expect((await api("post", `/social/posts/${id}/submit`, adminToken)).status).toBe(200);
    if ((await prisma.socialPost.findUniqueOrThrow({ where: { id } })).status === "PENDING_APPROVAL") expect((await api("post", `/social/posts/${id}/approve`, adminToken, {})).status).toBe(200);
    expect((await api("post", `/social/posts/${id}/schedule`, adminToken, { scheduledAt: new Date(Date.now() + 3600_000).toISOString(), timezone: "UTC" })).status).toBe(200);
    const due = new Date(Date.now() - 60_000);
    await prisma.socialPost.update({ where: { id }, data: { scheduledAt: due } });
    await prisma.socialPostTarget.updateMany({ where: { postId: id }, data: { scheduledAt: due } });
    return { postId: id, targetId: (await prisma.socialPostTarget.findFirstOrThrow({ where: { postId: id } })).id };
  }
  const media = (name: string, mimeType: string) => prisma.mediaAsset.create({ data: { organizationId: orgId, originalFilename: name, storageProvider: "test", storageBucket: "test", storageKey: `qa-ig/${Date.now()}-${name}`, mimeType, sizeBytes: 500_000, width: 1080, height: 1350, status: "ACTIVE" } });

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

    const reg = await request(app).post("/api/v1/auth/register").set("X-Forwarded-For", "10.0.7.1").send({ email: "qa-ig-admin@example.com", password: "Str0ng-Passphrase-77", firstName: "QA", lastName: "Admin", organizationName: "QA_TEST_2026_ Instagram" });
    adminToken = reg.body.data.session.token;
    orgId = reg.body.data.user.organizationId;
    const role = await prisma.role.create({ data: { key: ROLE_KEY, name: ROLE_KEY, isSystem: false } });
    const perms = await prisma.permission.findMany({ where: { key: { in: ["social.read", "social.reply", "social.publish"] } } });
    await prisma.rolePermission.createMany({ data: perms.map((p) => ({ roleId: role.id, permissionId: p.id })) });
    await api("post", "/users", adminToken, { email: "qa-ig-agent@example.com", password: "Str0ng-Passphrase-77", firstName: "QA", lastName: "Agent", roleKey: ROLE_KEY });
    agentToken = (await request(app).post("/api/v1/auth/login").set("X-Forwarded-For", hdr()).send({ email: "qa-ig-agent@example.com", password: "Str0ng-Passphrase-77" })).body.data.session.token;
    mediaId = (await media("qa.jpg", "image/jpeg")).id;
    pngId = (await media("qa.png", "image/png")).id;
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
  beforeEach(() => { calls.length = 0; behaviour = defaultBehaviour; containerStatus = "FINISHED"; mutable.socialPublishingDisabled = false; });

  it("is listed as available and has an administrator-only setup guide", async () => {
    const list = await api("get", "/social/accounts", agentToken);
    expect(list.body.data.providers.find((p: { key: string }) => p.key === "meta_instagram")).toMatchObject({ label: "Instagram", configured: true, available: true });
    const setup = await api("get", "/social/accounts/providers/meta_instagram/setup", adminToken);
    expect(setup.status).toBe(200);
    expect(setup.body.data.setup).toMatchObject({ webhookObject: "instagram", webhookFields: ["comments", "messages"], dailyPublishLimit: 3 });
    expect(JSON.stringify(setup.body)).not.toContain(SECRET);
    expect((await api("get", "/social/accounts/providers/meta_instagram/setup", agentToken)).status).toBe(403);
  });

  it("connects through the Facebook Login flow, offers only Pages with a linked Instagram account, and stores the encrypted Page token", async () => {
    const start = await api("post", "/social/accounts/connect/start", adminToken, { provider: "meta_instagram" });
    expect(start.status).toBe(200);
    const authUrl = new URL(start.body.data.authUrl);
    expect(`${authUrl.origin}${authUrl.pathname}`).toBe("https://www.facebook.com/v25.0/dialog/oauth");
    expect(authUrl.searchParams.get("scope")).toBe("instagram_basic,instagram_content_publish,instagram_manage_comments,instagram_manage_messages,pages_show_list,pages_read_engagement,business_management");
    const state = authUrl.searchParams.get("state")!;
    const cb = await api("post", "/social/accounts/callback", adminToken, { state, code: "QA_CODE" });
    expect(cb.status).toBe(200);
    expect(cb.body.data.selection.pages.map((p: { externalId: string }) => p.externalId)).toEqual(["QA_IG_1"]);
    expect(JSON.stringify(cb.body)).not.toContain(PAGE_TOKEN);
    const chosen = await api("post", "/social/accounts/connect/select", adminToken, { selectionId: cb.body.data.selection.id, externalIds: ["QA_IG_1"] });
    expect(chosen.status).toBe(200);
    expect(chosen.body.data.accounts[0]).toMatchObject({ provider: "meta_instagram", externalAccountId: "QA_IG_1", status: "CONNECTED", handle: "qa_artify" });
    ig = chosen.body.data.accounts[0].id;
    const cred = await prisma.socialAccountCredential.findUniqueOrThrow({ where: { socialAccountId: ig } });
    expect(cred.ciphertext).not.toContain(PAGE_TOKEN);
    expect(tokenVault.decrypt(cred.ciphertext, cred.keyVersion, ig)).toMatchObject({ accessToken: PAGE_TOKEN, pageId: "QA_PAGE_1", igId: "QA_IG_1" });
    expect(JSON.stringify(cred)).not.toContain(USER_TOKEN);
    // webhook subscription merged with what the Page already had
    const post = calls.find((c) => c.url.pathname.endsWith("/subscribed_apps") && c.method === "POST")!;
    expect(post.url.pathname).toBe("/v25.0/QA_PAGE_1/subscribed_apps");
    expect(post.body).toMatchObject({ subscribed_fields: "feed,messages" });
  });

  it("shows a clear error when no Page has an Instagram account linked", async () => {
    behaviour = (p, c) => (p.endsWith("/me/accounts") ? { body: { data: [{ id: "QA_PAGE_2", name: "No IG", access_token: "QA_OTHER_TOKEN_bbbbbbbbbbbbbbbbbbbb" }] } } : defaultBehaviour(p, c));
    const start = await api("post", "/social/accounts/connect/start", adminToken, { provider: "meta_instagram" });
    const state = new URL(start.body.data.authUrl).searchParams.get("state")!;
    const cb = await api("post", "/social/accounts/callback", adminToken, { state, code: "QA_CODE" });
    expect(cb.status).toBe(400);
    expect(cb.body.error.message).toMatch(/Business or Creator/);
  });

  it("health check validates permissions", async () => {
    expect((await api("post", `/social/accounts/${ig}/health`, adminToken)).body.data.account.status).toBe("CONNECTED");
    behaviour = (p) => (p.endsWith("/debug_token") ? { body: { data: { is_valid: true, scopes: ["instagram_basic"] } } } : { body: {} });
    const missing = await api("post", `/social/accounts/${ig}/health`, adminToken);
    expect(missing.body.data.account.status).toBe("NEEDS_REAUTH");
    expect(missing.body.data.account.lastError).toMatch(/instagram_content_publish/);
    await prisma.socialAccount.update({ where: { id: ig }, data: { status: "CONNECTED", lastError: null } });
  });

  // ---------- publishing ----------
  it("rejects a text-only post and a PNG with clear guardrail messages", async () => {
    const textOnly = await api("post", "/social/posts", adminToken, { title: "QA_TEST_2026_ ig text", body: `Text only ${Date.now()}`, accountIds: [ig] });
    expect(textOnly.status).toBe(201);
    const submit = await api("post", `/social/posts/${textOnly.body.data.post.id}/submit`, adminToken);
    expect(submit.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(submit.body)).toMatch(/requires an image/);
    const png = await api("post", "/social/posts", adminToken, { title: "QA_TEST_2026_ ig png", body: `PNG ${Date.now()}`, accountIds: [ig], mediaIds: [pngId] });
    const submitPng = await api("post", `/social/posts/${png.body.data.post.id}/submit`, adminToken);
    expect(submitPng.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(submitPng.body)).toMatch(/image\/png/);
    expect(callsTo("/media")).toHaveLength(0);
  });

  it("dry-run does everything except the Instagram calls; the safety layers hold", async () => {
    const { targetId } = await scheduledPost("Dry run");
    expect((await publisher.publishTarget(targetId)).detail).toBe("global_off");
    await setPublishing({ enabled: true, dryRun: true });
    expect((await publisher.publishTarget(targetId)).outcome).toBe("dry_run");
    expect(calls.filter((c) => c.url.pathname.endsWith("/media") || c.url.pathname.endsWith("/media_publish"))).toHaveLength(0);
    await setPublishing({});
  });

  it("publishes across attempts: the container is still processing (pending, no attempt used), then FINISHED → media_publish exactly once", async () => {
    await setPublishing({ enabled: true });
    const { targetId } = await scheduledPost("Slow container");
    containerStatus = "IN_PROGRESS";
    const first = await publisher.publishTarget(targetId);
    expect(first).toMatchObject({ outcome: "retry_scheduled", detail: "pending" });
    let t = await prisma.socialPostTarget.findUniqueOrThrow({ where: { id: targetId } });
    expect(t).toMatchObject({ status: "SCHEDULED", attempts: 0 });
    expect(t.providerState).toMatchObject({ phase: "container" });
    expect(t.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now() + 30_000);
    expect(callsTo("/media_publish")).toHaveLength(0);

    containerStatus = "FINISHED";
    await prisma.socialPostTarget.update({ where: { id: targetId }, data: { nextAttemptAt: null } });
    const created = callsTo("/QA_IG_1/media").length;
    expect((await publisher.publishTarget(targetId)).outcome).toBe("published");
    expect(callsTo("/QA_IG_1/media")).toHaveLength(created); // the saved container was reused
    expect(callsTo("/media_publish")).toHaveLength(1);
    t = await prisma.socialPostTarget.findUniqueOrThrow({ where: { id: targetId } });
    expect(t).toMatchObject({ status: "PUBLISHED", attempts: 1 });
    expect(t.providerState).toBeNull();
    expect(t.externalUrl).toMatch(/^https:\/\/www\.instagram\.com\/p\//);
    expect(callsTo("/media_publish")[0]!.body).toMatchObject({ access_token: PAGE_TOKEN });
    await publisher.tick();
    expect(callsTo("/media_publish")).toHaveLength(1); // never twice
  });

  it("container error → permanent failure with Instagram's reason", async () => {
    await setPublishing({ enabled: true });
    const { targetId } = await scheduledPost("Bad media");
    behaviour = (p, c) => (p.includes("/QA_CONT_") ? { body: { status_code: "ERROR", status: "Error: Media upload has failed with error code 2207026" } } : defaultBehaviour(p, c));
    expect((await publisher.publishTarget(targetId)).outcome).toBe("failed");
    const t = await prisma.socialPostTarget.findUniqueOrThrow({ where: { id: targetId } });
    expect(t.status).toBe("FAILED");
    expect(t.publishError).toMatch(/2207026/);
    expect(t.providerState).toBeNull();
  });

  it("media_publish with no answer → UNCERTAIN; never retried automatically; a manual retry starts clean", async () => {
    await setPublishing({ enabled: true });
    const { targetId } = await scheduledPost("Timeout on publish");
    behaviour = (p, c) => (p.endsWith("/media_publish") ? Object.assign(new Error("aborted"), { name: "AbortError" }) : defaultBehaviour(p, c));
    expect((await publisher.publishTarget(targetId)).outcome).toBe("uncertain");
    expect(callsTo("/media_publish")).toHaveLength(1);
    await publisher.tick({ now: new Date(Date.now() + 3 * 3600_000) });
    expect(callsTo("/media_publish")).toHaveLength(1);
    const t = await prisma.socialPostTarget.findUniqueOrThrow({ where: { id: targetId } });
    expect(t.status).toBe("UNCERTAIN");
    expect(t.providerState).toMatchObject({ phase: "publishing" });
    // the operator confirms nothing was posted and retries: state is reset so a fresh container is made
    behaviour = defaultBehaviour;
    const retry = await api("post", `/social/publishing/targets/${targetId}/retry`, adminToken, { confirmNotPosted: true });
    expect(retry.status).toBe(200);
    expect((await prisma.socialPostTarget.findUniqueOrThrow({ where: { id: targetId } })).status).toBe("PUBLISHED");
  });

  it("enforces the daily publish limit per account (published and uncertain posts in the last 24 hours count)", async () => {
    await setPublishing({ enabled: true });
    const used = await prisma.socialPostTarget.count({ where: { socialAccountId: ig, OR: [{ status: "PUBLISHED" }, { status: "UNCERTAIN" }] } });
    expect(used).toBeGreaterThanOrEqual(2);
    // fill the allowance (limit 3 in this suite)
    const filler = await scheduledPost("Filler");
    await prisma.socialPostTarget.update({ where: { id: filler.targetId }, data: { status: "PUBLISHED", publishedAt: new Date() } });
    const extra = await scheduledPost("Over the limit");
    calls.length = 0;
    const r = await publisher.publishTarget(extra.targetId);
    expect(r).toMatchObject({ outcome: "failed", detail: "daily_limit" });
    expect(callsTo("/QA_IG_1/media")).toHaveLength(0);
    expect((await prisma.socialPostTarget.findUniqueOrThrow({ where: { id: extra.targetId } })).publishError).toMatch(/daily_limit/);
  });

  // ---------- webhooks & inbox ----------
  it("answers the hub.challenge handshake and fails closed", async () => {
    const q = (over: Record<string, string> = {}) => ({ "hub.mode": "subscribe", "hub.verify_token": "qa-verify-token-xyz", "hub.challenge": "777", ...over });
    const ok = await request(app).get("/api/v1/social/webhooks/meta_instagram").query(q()).set("X-Forwarded-For", hdr());
    expect(ok.status).toBe(200);
    expect(ok.text).toBe("777");
    expect((await request(app).get("/api/v1/social/webhooks/meta_instagram").query(q({ "hub.verify_token": "wrong" })).set("X-Forwarded-For", hdr())).status).toBe(403);
  });

  it("rejects unsigned and badly signed deliveries and stores nothing", async () => {
    const before = await prisma.socialMessage.count();
    expect((await deliver(commentPayload("QA_IGC_BAD"), { sig: null })).status).toBe(401);
    expect((await deliver(commentPayload("QA_IGC_BAD"), { sig: "sha256=" + "0".repeat(64) })).status).toBe(401);
    expect(await prisma.socialMessage.count()).toBe(before);
  });

  it("ingests signed comments and DMs idempotently", async () => {
    const c = commentPayload("QA_IGC_1");
    expect((await deliver(c)).body.data).toMatchObject({ accepted: 1, duplicates: 0 });
    expect((await deliver(c)).body.data).toMatchObject({ accepted: 0, duplicates: 1 });
    expect(await prisma.socialConversation.findFirstOrThrow({ where: { socialAccountId: ig, providerThreadId: "c:QA_IGC_1" } })).toMatchObject({ type: "COMMENT", organizationId: orgId, subjectRef: "QA_IG_MEDIA1" });
    const d = dmPayload("mid_in_1");
    expect((await deliver(d)).body.data).toMatchObject({ accepted: 1 });
    expect((await deliver(d)).body.data).toMatchObject({ duplicates: 1 });
    const unknown = { ...dmPayload("mid_unknown"), entry: [{ ...dmPayload("mid_unknown").entry[0]!, id: "SOME_OTHER_IG" }] };
    expect((await deliver(unknown)).body.data).toMatchObject({ accepted: 0, ignored: 1 });
  });

  it("replies to a comment (/replies) and hides it", async () => {
    await deliver(commentPayload("QA_IGC_REPLY"));
    const conv = await prisma.socialConversation.findFirstOrThrow({ where: { socialAccountId: ig, providerThreadId: "c:QA_IGC_REPLY" } });
    calls.length = 0;
    const res = await api("post", `/social/inbox/conversations/${conv.id}/reply`, agentToken, { body: "Yes, it is in stock!" });
    expect(res.status).toBe(200);
    expect(res.body.data.message.sendStatus).toBe("SENT");
    const sent = callsTo("/replies");
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url.pathname).toBe("/v25.0/QA_IGC_REPLY/replies");
    expect(sent[0]!.body).toMatchObject({ message: "Yes, it is in stock!", access_token: PAGE_TOKEN });
    const msg = await prisma.socialMessage.findFirstOrThrow({ where: { conversationId: conv.id, direction: "INBOUND" } });
    calls.length = 0;
    expect((await api("post", `/social/inbox/messages/${msg.id}/hide`, agentToken, { hidden: true })).body.data.hidden).toBe(true);
    expect(calls[0]!.body).toMatchObject({ hide: true });
  });

  it("replies to a DM inside the 24-hour window as RESPONSE (no tag) and blocks it outside", async () => {
    await deliver(dmPayload("mid_in_win", "IGSID_WIN"));
    const conv = await prisma.socialConversation.findFirstOrThrow({ where: { socialAccountId: ig, providerThreadId: "dm:IGSID_WIN" } });
    calls.length = 0;
    const ok = await api("post", `/social/inbox/conversations/${conv.id}/reply`, agentToken, { body: "Happy to help!" });
    expect(ok.body.data.message.sendStatus).toBe("SENT");
    const sent = callsTo("/QA_PAGE_1/messages");
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body).toMatchObject({ recipient: { id: "IGSID_WIN" }, messaging_type: "RESPONSE", message: { text: "Happy to help!" } });
    expect(sent[0]!.body).not.toHaveProperty("tag");
    await prisma.socialConversation.update({ where: { id: conv.id }, data: { lastInboundAt: new Date(Date.now() - 25 * 3600_000) } });
    calls.length = 0;
    const blocked = await api("post", `/social/inbox/conversations/${conv.id}/reply`, agentToken, { body: "Too late?" });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.message).toMatch(/24 hours/);
    expect(callsTo("/messages")).toHaveLength(0);
  });

  it("never logs or returns tokens", () => {
    const text = logged.join("\n");
    for (const secret of [PAGE_TOKEN, USER_TOKEN, SECRET]) expect(text).not.toContain(secret);
  });
});
