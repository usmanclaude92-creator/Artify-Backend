/**
 * Social listening & reviews (Step 10): mention ingest + dedupe, id-only mention resolution, the crisis path, grouped alerts, triage alerts, replies and the
 * platform-only fallback, review permission, "auto-reply never", rating snapshots (null not 0), polling flag, retention, permissions, empty states, privacy.
 * Real database + mock connector; the AI model is mocked. Test data tagged QA_TEST_2026_.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

vi.mock("../../server/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/config/env")>();
  return { ...actual, config: { ...actual.config } };
});
import { config } from "../../server/config/env";
import { createApp, finalizeApp } from "../../server/app/app";
import { disconnectPrisma, prisma } from "../../server/db/prisma";
import { logger } from "../../server/core/logger";
import { resetDb } from "../helpers/db";
import { AdapterFactory } from "../../server/ai/adapters/adapterFactory";
import { MOCK_SIGNATURE_HEADER, mockInboxLog, mockMentionContent, mockMentionQueue, mockReviewSummaries, signMockWebhook } from "../../server/services/social/connectors/mockProvider";
import { ingestEvent, processTriage, purgeExpired } from "../../server/services/social/inbox/inboxPipeline";
import { sendReply } from "../../server/services/social/inbox/inboxCore";
import { resolveMentionEvent, UNRESOLVED_TEXT } from "../../server/services/social/listening/listeningIngest";
import { listeningJobs, pollListening, snapshotReviews } from "../../server/services/social/listening/listeningJobs";
import { SocialPublishError } from "../../server/services/social/publishing/publishErrors";
import type { AiModelAdapter, AiModelCallParams } from "../../server/ai/adapters/types";
import type { InboundEvent } from "../../server/services/social/connectors/types";

const mutable = config as unknown as Record<string, unknown>;
const SECRET_MARKER = "QA_TEST_2026_PRIVATE_MENTION_TEXT_5c1d";
const ROLES = { agent: "QA_TEST_2026_LISTEN_AGENT", replyOnly: "QA_TEST_2026_LISTEN_REPLY_ONLY", reader: "QA_TEST_2026_LISTEN_READER" };

describe("social listening & reviews", () => {
  const app = createApp();
  finalizeApp(app);
  let adminToken = "", adminId = "", agentToken = "", agentId = "", replyOnlyToken = "", readerToken = "", viewerToken = "", otherToken = "";
  let orgId = "", account = "", accountExt = "", otherAccount = "", otherExt = "";
  let ip = 10, seq = 0;
  const logged: string[] = [];
  let aiTriage: (text: string) => object = () => ({ intent: "question", sentiment: "neutral", priority: "NORMAL", language: "en", spamScore: 0, category: "general", confidence: 0.9 });
  let aiReply: () => object = () => ({ body: "Thank you for your feedback, we will look into it.", confidence: 0.9 });
  let aiCalls: AiModelCallParams[] = [];

  const hdr = () => `10.9.${Math.floor(ip / 250)}.${ip++ % 250}`;
  const api = (method: "get" | "post" | "put" | "patch" | "delete", path: string, token: string, body?: object) => {
    const r = request(app)[method](`/api/v1${path}`).set("Authorization", `Bearer ${token}`).set("X-Forwarded-For", hdr());
    return method === "get" || method === "delete" ? r : r.send(body ?? {});
  };
  async function makeUser(email: string, roleKey: string) {
    await api("post", "/users", adminToken, { email, password: "Str0ng-Passphrase-77", firstName: "QA", lastName: "Listen", roleKey });
    const login = await request(app).post("/api/v1/auth/login").set("X-Forwarded-For", hdr()).send({ email, password: "Str0ng-Passphrase-77" });
    return { token: login.body.data.session.token as string, id: login.body.data.user.id as string };
  }
  async function role(key: string, perms: string[]) {
    const r = await prisma.role.create({ data: { key, name: key, isSystem: false } });
    const rows = await prisma.permission.findMany({ where: { key: { in: perms } } });
    await prisma.rolePermission.createMany({ data: rows.map((p) => ({ roleId: r.id, permissionId: p.id })) });
  }
  async function connect(token: string, name: string) {
    const start = await api("post", "/social/accounts/connect/start", token, { provider: "mock" });
    const state = new URL(start.body.data.authUrl).searchParams.get("state")!;
    const cb = await api("post", "/social/accounts/callback", token, { state, code: `mock_${name}` });
    return { id: cb.body.data.account.id as string, ext: cb.body.data.account.externalAccountId as string };
  }
  const ev = (over: Partial<InboundEvent> = {}): InboundEvent => {
    seq += 1;
    return { type: "MENTION", accountExternalId: accountExt, providerThreadId: `mc:${seq}`, providerMessageId: `mm-${seq}`, participant: { externalId: `p${seq}`, handle: `fan${seq}`, name: `Fan ${seq}` }, text: `Loving ${seq} @artifysols`, ...over };
  };
  const deliver = (events: InboundEvent[]) => {
    const raw = JSON.stringify({ events });
    return request(app).post("/api/v1/social/webhooks/mock").set("Content-Type", "application/json").set("X-Forwarded-For", hdr()).set(MOCK_SIGNATURE_HEADER, signMockWebhook(raw, config.webhookSecret)).send(raw);
  };
  const ingest = async (over: Partial<InboundEvent> = {}) => {
    const e = ev(over);
    const res = await ingestEvent({ id: account, organizationId: orgId, provider: "mock" }, e);
    const conv = await prisma.socialConversation.findUniqueOrThrow({ where: { id: res.conversationId } });
    return { e, conv, res };
  };
  const alerts = (userId: string) => prisma.notification.findMany({ where: { organizationId: orgId, userId, type: "social_listening_alert" }, orderBy: { createdAt: "asc" } });
  const clearAlerts = () => prisma.notification.deleteMany({ where: { organizationId: orgId, type: "social_listening_alert" } });

  beforeAll(async () => {
    await resetDb();
    for (const level of ["info", "warn", "error", "debug"] as const) vi.spyOn(logger, level).mockImplementation(((...args: unknown[]) => { logged.push(JSON.stringify(args)); }) as never);
    const reg = await request(app).post("/api/v1/auth/register").set("X-Forwarded-For", "10.0.9.1").send({ email: "qa-listen-admin@example.com", password: "Str0ng-Passphrase-77", firstName: "QA", lastName: "Admin", organizationName: "QA_TEST_2026_ Listening" });
    adminToken = reg.body.data.session.token; orgId = reg.body.data.user.organizationId; adminId = reg.body.data.user.id;
    otherToken = (await request(app).post("/api/v1/auth/register").set("X-Forwarded-For", "10.0.9.2").send({ email: "qa-listen-other@example.com", password: "Str0ng-Passphrase-77", firstName: "QA", lastName: "Other", organizationName: "QA_TEST_2026_ Other Listening" })).body.data.session.token;
    await role(ROLES.agent, ["social.read", "social.reply", "social.listening.read", "social.reviews.respond"]);
    await role(ROLES.replyOnly, ["social.read", "social.reply", "social.listening.read"]);
    await role(ROLES.reader, ["social.read"]);
    const agent = await makeUser("qa-listen-agent@example.com", ROLES.agent);
    agentToken = agent.token; agentId = agent.id;
    replyOnlyToken = (await makeUser("qa-listen-replyonly@example.com", ROLES.replyOnly)).token;
    readerToken = (await makeUser("qa-listen-reader@example.com", ROLES.reader)).token;
    viewerToken = (await makeUser("qa-listen-viewer@example.com", "VIEWER")).token;
    const a = await connect(adminToken, "listen_a");
    account = a.id; accountExt = a.ext;
    const b = await connect(otherToken, "listen_other");
    otherAccount = b.id; otherExt = b.ext;

    const fake: AiModelAdapter = {
      providerType: "MOCK",
      async generateText(params) {
        aiCalls.push(params);
        const isTriage = (params.systemInstruction ?? "").includes("intent");
        const out = isTriage ? aiTriage(params.prompt) : aiReply();
        return { text: JSON.stringify(out), inputTokens: 50, outputTokens: 20, totalTokens: 70, durationMs: 3 };
      },
      async generateStructured() { return {} as never; },
    };
    vi.spyOn(AdapterFactory, "getAdapter").mockReturnValue(fake);
  });
  afterAll(async () => {
    // Global switches are shared across test files: leave them as found (off).
    await prisma.socialPublishingGlobal.upsert({ where: { id: "global" }, create: { id: "global", enabled: false, dryRun: false, killSwitch: false }, update: { enabled: false, dryRun: false, killSwitch: false } });
    await prisma.socialPublishingSetting.updateMany({ where: { organizationId: orgId }, data: { enabled: false, dryRun: false, killSwitch: false } });
    vi.restoreAllMocks();
    for (const key of Object.values(ROLES)) {
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
  beforeEach(async () => {
    mutable.socialListeningPolling = false;
    mutable.socialListeningDisabled = false;
    mutable.socialReplyRatePerMinute = 50;
    await prisma.socialInboxSetting.deleteMany({ where: { organizationId: orgId } });
    await prisma.socialMessage.updateMany({ where: { organizationId: orgId, triageStatus: "PENDING" }, data: { triageStatus: "SKIPPED" } });
    await prisma.socialPublishingSetting.upsert({ where: { organizationId: orgId }, create: { organizationId: orgId, enabled: true, dryRun: false, killSwitch: false }, update: { enabled: true, dryRun: false, killSwitch: false } });
    await prisma.socialPublishingGlobal.upsert({ where: { id: "global" }, create: { id: "global", enabled: true, dryRun: false, killSwitch: false }, update: { enabled: true, dryRun: false, killSwitch: false } });
    aiCalls = [];
    aiTriage = () => ({ intent: "question", sentiment: "neutral", priority: "NORMAL", language: "en", spamScore: 0, category: "general", confidence: 0.9 });
    aiReply = () => ({ body: "Thank you for your feedback, we will look into it.", confidence: 0.9 });
    mockInboxLog.replies.length = 0;
  });

  // ---------- permissions ----------
  it("maps the new permissions to the SAME roles as the inbox: listening.read = social.read roles, reviews.respond = social.reply roles, never CLIENT_PORTAL", async () => {
    const grants = async (key: string) => [...new Set((await prisma.rolePermission.findMany({ where: { permission: { key } }, include: { role: { select: { key: true } } } })).map((r) => r.role.key).filter((k) => !k.startsWith("QA_TEST_2026_")))].sort();
    expect(await grants("social.listening.read")).toEqual(await grants("social.read"));
    expect(await grants("social.reviews.respond")).toEqual(await grants("social.reply"));
    expect(await grants("social.listening.read")).toEqual(["ADMIN", "MANAGER", "SUPER_ADMIN", "VIEWER"]);
    expect(await grants("social.reviews.respond")).toEqual(["ADMIN", "SUPER_ADMIN"]);
  });

  it("requires social.listening.read for every listening and reviews read (social.read alone is not enough) and is workspace scoped", async () => {
    for (const path of ["/social/listening", "/social/listening/topics", "/social/listening/summary", "/social/reviews", "/social/reviews/overview"]) {
      expect((await api("get", path, readerToken)).status, path).toBe(403);
      expect((await api("get", path, viewerToken)).status, path).toBe(200);
    }
    const { conv } = await ingest({ text: `scoped ${SECRET_MARKER}` });
    const mine = (await api("get", "/social/listening", agentToken)).body.data;
    expect(mine.items.map((i: { id: string }) => i.id)).toContain(conv.id);
    const theirs = (await api("get", "/social/listening", otherToken)).body.data;
    expect(theirs.items).toEqual([]);
    expect((await api("get", `/social/listening?accountId=${account}`, otherToken)).body.data.items).toEqual([]);
    expect(otherAccount).not.toBe(account);
  });

  // ---------- empty states ----------
  it("shows honest empty states: no mentions, no reviews, and why there is no review source", async () => {
    const o = (await api("get", "/social/listening", otherToken)).body.data;
    expect(o).toMatchObject({ items: [], total: 0 });
    expect((await api("get", "/social/listening/summary", otherToken)).body.data.summary).toEqual({ mentionsOpen: 0, negativeOpen: 0, crisisOpen: 0, unassigned: 0, mentionsLast7d: 0, reviewsOpen: 0 });
    expect((await api("get", "/social/reviews", otherToken)).body.data).toMatchObject({ items: [], total: 0 });
    await prisma.socialAccount.create({ data: { organizationId: orgId, provider: "meta_facebook", externalAccountId: "QA_TEST_2026_PAGE", displayName: "QA_TEST_2026_ FB Page", accountType: "PAGE", status: "CONNECTED" } });
    const ov = (await api("get", "/social/reviews/overview", agentToken)).body.data;
    const fb = ov.accounts.find((a: { provider: string }) => a.provider === "meta_facebook");
    expect(fb).toMatchObject({ reviewsAvailable: false, latest: null, series: [] });
    expect(fb.reviewsReason).toMatch(/v22\.0/);
    expect(ov.google).toMatchObject({ connected: false });
    expect(ov.google.reason).toMatch(/approval/i);
    await prisma.socialAccount.deleteMany({ where: { externalAccountId: "QA_TEST_2026_PAGE" } });
  });

  // ---------- ingest ----------
  it("stores a mention once (dedupe by provider id), shows it in Listening and keeps it out of the Inbox list by default", async () => {
    const e = ev({ text: "Great team @artifysols", permalink: "https://www.instagram.com/p/QA_TEST_9/" });
    const first = await deliver([e]);
    expect(first.body.data).toMatchObject({ accepted: 1, duplicates: 0 });
    const second = await deliver([e]);
    expect(second.body.data).toMatchObject({ accepted: 0, duplicates: 1 });
    expect(await prisma.socialMessage.count({ where: { socialAccountId: account, providerMessageId: e.providerMessageId } })).toBe(1);
    const list = (await api("get", "/social/listening?search=Great%20team", agentToken)).body.data;
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({ type: "MENTION", preview: "Great team @artifysols", permalink: "https://www.instagram.com/p/QA_TEST_9/", replyMode: "api", crisis: false });
    const inboxDefault = (await api("get", "/social/inbox/conversations?search=Great%20team", agentToken)).body.data;
    expect(inboxDefault.conversations).toEqual([]);
    const inboxMentions = (await api("get", "/social/inbox/conversations?type=MENTION&search=Great%20team", agentToken)).body.data;
    expect(inboxMentions.conversations).toHaveLength(1);
    const detail = (await api("get", `/social/inbox/conversations/${list.items[0].id}`, agentToken)).body.data;
    expect(detail).toMatchObject({ permalink: "https://www.instagram.com/p/QA_TEST_9/", reply: { mode: "api" } });
  });

  it("fetches the content behind an id-only webhook, and stores a placeholder (not nothing) when the network refuses", async () => {
    mockMentionContent.set("17800000000000001", { text: "Resolved @artifysols text", participant: { handle: "qa_fan", name: "qa_fan" }, permalink: "https://www.instagram.com/p/QA_TEST_RES/" });
    const resolved = await resolveMentionEvent({ id: account, provider: "mock", externalAccountId: accountExt }, ev({ text: "", lookup: { kind: "ig_comment", id: "17800000000000001" } }));
    expect(resolved).toMatchObject({ text: "Resolved @artifysols text", participant: { handle: "qa_fan" }, permalink: "https://www.instagram.com/p/QA_TEST_RES/" });
    const refused = await resolveMentionEvent({ id: account, provider: "mock", externalAccountId: accountExt }, ev({ text: "", lookup: { kind: "ig_comment", id: "17800000000000099" } }));
    expect(refused.text).toBe(UNRESOLVED_TEXT);
    const { conv } = await ingest({ ...refused });
    expect((await prisma.socialMessage.findFirstOrThrow({ where: { conversationId: conv.id } })).body).toBe(UNRESOLVED_TEXT);
  });

  it("ignores mention webhooks when listening is switched off (comments still arrive)", async () => {
    mutable.socialListeningDisabled = true;
    const m = ev({ text: "should be ignored" });
    expect((await deliver([m])).body.data).toMatchObject({ accepted: 0, ignored: 1 });
    expect(await prisma.socialMessage.count({ where: { providerMessageId: m.providerMessageId } })).toBe(0);
    const c = ev({ type: "COMMENT", providerThreadId: `c-${seq}`, text: "a normal comment" });
    expect((await deliver([c])).body.data).toMatchObject({ accepted: 1 });
  });

  // ---------- crisis path + grouped alerts ----------
  it("flags crisis words at ingest without any AI: URGENT, needs a human, tagged, one alert for each person who can reply, no message text in audit or notification", async () => {
    await clearAlerts();
    const { conv } = await ingest({ text: `This is a SCAM and I will sue you ${SECRET_MARKER}` });
    expect(conv).toMatchObject({ priority: "URGENT", needsHuman: true });
    expect(conv.tags).toContain("crisis");
    expect(aiCalls).toHaveLength(0);
    for (const uid of [adminId, agentId]) {
      const n = await alerts(uid);
      expect(n).toHaveLength(1);
      expect(n[0]).toMatchObject({ title: "Crisis-flagged item in Listening", status: "UNREAD" });
      expect(n[0]!.message.length).toBeLessThanOrEqual(45);
      expect(n[0]!.message).not.toContain(SECRET_MARKER);
    }
    expect(await alerts((await prisma.user.findFirstOrThrow({ where: { email: "qa-listen-viewer@example.com" } })).id)).toHaveLength(0); // viewers cannot act, so they are not alerted
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { organizationId: orgId, action: "SOCIAL_LISTENING_CRISIS_FLAGGED", resourceId: conv.id } });
    expect(JSON.stringify(audit.metadata)).toContain("scam");
    expect(JSON.stringify(audit.metadata)).not.toContain(SECRET_MARKER);
    const crisis = (await api("get", "/social/listening?crisis=true", agentToken)).body.data;
    expect(crisis.items.map((i: { id: string }) => i.id)).toContain(conv.id);
    expect(crisis.items.find((i: { id: string }) => i.id === conv.id)).toMatchObject({ crisis: true, priority: "URGENT" });
    const calm = await ingest({ text: "Lovely service, thank you" });
    expect(calm.conv.tags).not.toContain("crisis");
  });

  it("groups a burst into ONE notification per person and re-surfaces it as unread", async () => {
    await clearAlerts();
    await ingest({ text: "fraud fraud" });
    const [first] = await alerts(agentId);
    await prisma.notification.update({ where: { id: first!.id }, data: { status: "READ", readAt: new Date() } });
    for (let i = 0; i < 3; i++) await ingest({ text: `lawyer incoming ${i}` });
    for (const uid of [adminId, agentId]) {
      const n = await alerts(uid);
      expect(n).toHaveLength(1);
      expect(n[0]).toMatchObject({ title: "4 items need attention (Listening)", status: "UNREAD", readAt: null });
      expect(n[0]!.message).toMatch(/^4 new negative or crisis-flagged items/);
    }
    // outside the window a new alert is a new notification
    await prisma.notification.updateMany({ where: { organizationId: orgId, type: "social_listening_alert" }, data: { createdAt: new Date(Date.now() - 30 * 60_000) } });
    await ingest({ text: "boycott this brand" });
    expect(await alerts(agentId)).toHaveLength(2);
  });

  // ---------- triage ----------
  it("alerts on negative sentiment after AI triage (once, grouped), not on neutral or positive; the inbox 'complaint' ping is not duplicated for mentions", async () => {
    await clearAlerts();
    aiTriage = (t) => (t.includes("awful") ? { intent: "complaint", sentiment: "negative", priority: "HIGH", language: "en", spamScore: 0, category: "service", confidence: 0.9 } : { intent: "praise", sentiment: "positive", priority: "LOW", language: "en", spamScore: 0, category: "service", confidence: 0.9 });
    const bad = await ingest({ text: "awful service @artifysols" });
    const good = await ingest({ text: "wonderful service @artifysols" });
    await prisma.notification.deleteMany({ where: { organizationId: orgId, type: "social_inbox_attention" } });
    await processTriage(20);
    expect((await prisma.socialMessage.findFirstOrThrow({ where: { conversationId: bad.conv.id } })).triageStatus).toBe("DONE");
    expect(await alerts(agentId)).toHaveLength(1);
    expect((await alerts(agentId))[0]).toMatchObject({ title: "Negative mention or review in Listening" });
    expect(await prisma.notification.count({ where: { organizationId: orgId, type: "social_inbox_attention" } })).toBe(0);
    const listed = (await api("get", "/social/listening?sentiment=negative&topic=service", agentToken)).body.data;
    expect(listed.items.map((i: { id: string }) => i.id)).toEqual([bad.conv.id]);
    expect(listed.items[0]).toMatchObject({ topic: "service", sentiment: "negative", intent: "complaint" });
    expect((await api("get", "/social/listening/topics", agentToken)).body.data.topics).toEqual(expect.arrayContaining([{ topic: "service", count: 2 }]));
    expect(good.conv.id).not.toBe(bad.conv.id);
  });

  it("does not alert twice for an item already crisis-flagged at ingest", async () => {
    await clearAlerts();
    aiTriage = () => ({ intent: "complaint", sentiment: "negative", priority: "URGENT", language: "en", spamScore: 0, category: "safety", confidence: 0.9 });
    await ingest({ text: "this product is dangerous" });
    await processTriage(20);
    const n = await alerts(agentId);
    expect(n).toHaveLength(1);
    expect(n[0]!.title).toBe("Crisis-flagged item in Listening");
  });

  // ---------- replies ----------
  it("replies to a mention through the connector only after a person sends it (audited), and tells the user to reply on the platform when the network cannot", async () => {
    const { conv } = await ingest({ text: "Question about pricing @artifysols" });
    const sent = await api("post", `/social/inbox/conversations/${conv.id}/reply`, agentToken, { body: "Thanks for the mention!" });
    expect(sent.status).toBe(200);
    expect(sent.body.data.message.sendStatus).toBe("SENT");
    expect(mockInboxLog.replies).toHaveLength(1);
    expect(mockInboxLog.replies[0]).toMatchObject({ conversationType: "MENTION", text: "Thanks for the mention!", subjectRef: undefined });
    expect(await prisma.auditLog.count({ where: { organizationId: orgId, action: "SOCIAL_INBOX_REPLY_SENT", resourceId: conv.id } })).toBe(1);

    const platform = await ingest({ providerThreadId: "platform:tag-1", text: "tagged you in a photo" });
    const detail = (await api("get", `/social/inbox/conversations/${platform.conv.id}`, agentToken)).body.data;
    expect(detail.reply).toMatchObject({ mode: "platform" });
    expect(detail.reply.reason).toMatch(/Reply on the platform/);
    mockInboxLog.replies.length = 0;
    const refused = await api("post", `/social/inbox/conversations/${platform.conv.id}/reply`, agentToken, { body: "Hello" });
    expect(refused.status).toBe(409);
    expect(mockInboxLog.replies).toHaveLength(0);
    expect(await prisma.socialMessage.count({ where: { conversationId: platform.conv.id, direction: "OUTBOUND" } })).toBe(0); // nothing was created or claimed
    expect((await api("get", "/social/listening?search=tagged%20you", agentToken)).body.data.items[0]).toMatchObject({ replyMode: "platform" });
  });

  it("needs social.reviews.respond to draft or send a review reply (social.reply alone is not enough), on the reviews AND the inbox endpoints", async () => {
    const { conv } = await ingest({ type: "REVIEW", providerThreadId: `r:${seq}`, text: "Decent but slow shipping" });
    expect((await api("get", "/social/reviews?search=slow%20shipping", replyOnlyToken)).body.data.items.map((i: { id: string }) => i.id)).toEqual([conv.id]);
    for (const [method, path] of [["post", `/social/reviews/${conv.id}/reply`], ["post", `/social/reviews/${conv.id}/draft`], ["post", `/social/inbox/conversations/${conv.id}/reply`], ["post", `/social/inbox/conversations/${conv.id}/draft`]] as const) {
      expect((await api(method, path, replyOnlyToken, { body: "Thanks" })).status, path).toBe(403);
    }
    expect(mockInboxLog.replies).toHaveLength(0);
    const draft = await api("post", `/social/reviews/${conv.id}/draft`, agentToken);
    expect(draft.status).toBe(200);
    const sent = await api("post", `/social/reviews/${conv.id}/reply`, agentToken, { body: "Thank you, we are improving our shipping times." });
    expect(sent.status).toBe(200);
    expect(sent.body.data.message.sendStatus).toBe("SENT");
    expect(mockInboxLog.replies[0]).toMatchObject({ conversationType: "REVIEW" });
    // the reviews endpoints only touch reviews
    const mention = await ingest({ text: "a mention, not a review" });
    expect((await api("post", `/social/reviews/${mention.conv.id}/reply`, agentToken, { body: "x" })).status).toBe(404);
    expect((await api("post", `/social/reviews/${conv.id}/reply`, otherToken, { body: "x" })).status).toBe(404); // another workspace's admin cannot see it
  });

  it("never auto-replies to mentions or reviews, even with auto-reply on; a draft may be prepared but nothing is sent", async () => {
    await prisma.socialInboxSetting.create({ data: { organizationId: orgId, autoTriage: true, autoDraft: true, autoReply: true, autoLead: false, firstResponseMinutes: 60, retentionDays: 180 } });
    await prisma.socialCannedReply.create({ data: { organizationId: orgId, title: "Hours", body: "We are open 9-5.", approvedForAuto: true, matchKeywords: ["hours"] } });
    aiTriage = () => ({ intent: "praise", sentiment: "positive", priority: "LOW", language: "en", spamScore: 0, category: "service", confidence: 0.95 });
    const review = await ingest({ type: "REVIEW", providerThreadId: `r:auto${seq}`, text: "Thank you, great opening hours!" });
    const mention = await ingest({ text: "what are your hours? thanks @artifysols" });
    mockInboxLog.replies.length = 0;
    await processTriage(20);
    expect(mockInboxLog.replies).toHaveLength(0);
    expect(await prisma.socialMessage.count({ where: { conversationId: { in: [review.conv.id, mention.conv.id] }, direction: "OUTBOUND", sendStatus: { in: ["SENT", "SENDING"] } } })).toBe(0);
    expect(await prisma.socialMessage.count({ where: { conversationId: review.conv.id, authorKind: "AI_DRAFT", sendStatus: "DRAFT" } })).toBe(1); // drafted for a human
    await expect(sendReply(orgId, review.conv.id, { actor: null, body: "auto", autoSent: true, requireLive: true })).rejects.toThrow(/never answered automatically/);
    await expect(sendReply(orgId, mention.conv.id, { actor: null, body: "auto", autoSent: true })).rejects.toThrow(/never answered automatically/);
  });

  // ---------- work the item ----------
  it("lets the team assign, mark handled and create a CRM lead from a mention through the inbox workflow", async () => {
    const { conv } = await ingest({ text: "Interested in your services! contact me at qa-lead-mention@example.com @artifysols" });
    expect((await api("post", `/social/inbox/conversations/${conv.id}/assign`, adminToken, { assigneeId: agentId })).status).toBe(200);
    expect((await api("get", `/social/listening?assignee=${agentId}`, agentToken)).body.data.items.map((i: { id: string }) => i.id)).toContain(conv.id);
    const lead = await api("post", `/social/inbox/conversations/${conv.id}/lead`, agentToken, {});
    expect(lead.status).toBe(200);
    expect(lead.body.data.handoff.outcome).toBe("created");
    expect((await api("get", "/social/listening", agentToken)).body.data.items.find((i: { id: string }) => i.id === conv.id)).toMatchObject({ leadId: lead.body.data.handoff.leadId });
    expect((await api("post", `/social/inbox/conversations/${conv.id}/status`, agentToken, { status: "RESOLVED" })).status).toBe(200);
    expect((await api("get", "/social/listening?status=RESOLVED", agentToken)).body.data.items.map((i: { id: string }) => i.id)).toContain(conv.id);
    expect((await api("post", `/social/inbox/conversations/${conv.id}/assign`, viewerToken, { assigneeId: agentId })).status).toBe(403); // viewers read only
    await prisma.lead.deleteMany({ where: { id: lead.body.data.handoff.leadId } });
  });

  // ---------- reviews: snapshots ----------
  it("stores one rating snapshot per account per day, never overwrites it, and stores NULL with the reason (not 0) when the network gives none", async () => {
    await prisma.socialReviewSnapshot.deleteMany({ where: { organizationId: { in: [orgId, (await prisma.socialAccount.findUniqueOrThrow({ where: { id: otherAccount } })).organizationId] } } });
    const setSummary = (v: Parameters<typeof mockReviewSummaries.set>[1]) => { mockReviewSummaries.set(accountExt, v); mockReviewSummaries.set(otherExt, v); };
    setSummary({ averageRating: 4.5, reviewCount: 12 });
    expect(await snapshotReviews(new Date("2026-10-01T10:00:00Z"))).toEqual({ stored: 2, skipped: 0 }); // one per connected account
    setSummary({ averageRating: 1, reviewCount: 99 });
    expect(await snapshotReviews(new Date("2026-10-01T18:00:00Z"))).toEqual({ stored: 0, skipped: 2 }); // same UTC day: kept as is
    expect(await prisma.socialReviewSnapshot.findMany({ where: { socialAccountId: account } })).toEqual([expect.objectContaining({ averageRating: 4.5, reviewCount: 12, status: "OK", note: null })]);
    setSummary({ averageRating: null, reviewCount: null, note: "The network returned no rating." });
    expect(await snapshotReviews(new Date("2026-10-02T10:00:00Z"))).toEqual({ stored: 2, skipped: 0 });
    setSummary(new SocialPublishError("transient", "service unavailable"));
    expect(await snapshotReviews(new Date("2026-10-03T10:00:00Z"))).toEqual({ stored: 0, skipped: 0 }); // an outage is not a rating
    const rows = await prisma.socialReviewSnapshot.findMany({ where: { socialAccountId: account }, orderBy: { capturedOn: "asc" } });
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ averageRating: null, reviewCount: null, status: "UNAVAILABLE", note: "The network returned no rating." });
    const ov = (await api("get", "/social/reviews/overview?days=365", agentToken)).body.data;
    const mine = ov.accounts.find((a: { id: string }) => a.id === account);
    expect(mine.series).toEqual([
      { date: "2026-10-01", averageRating: 4.5, reviewCount: 12, status: "OK", note: null },
      { date: "2026-10-02", averageRating: null, reviewCount: null, status: "UNAVAILABLE", note: "The network returned no rating." },
    ]);
    expect(mine.latest).toMatchObject({ date: "2026-10-02", averageRating: null });
    expect(ov.accounts.map((a: { id: string }) => a.id)).not.toContain(otherAccount); // another workspace's account is never shown
    mockReviewSummaries.delete(accountExt); mockReviewSummaries.delete(otherExt);
  });

  it("stops snapshots when listening is switched off", async () => {
    mutable.socialListeningDisabled = true;
    mockReviewSummaries.set(accountExt, { averageRating: 3, reviewCount: 3 });
    expect(await snapshotReviews(new Date("2026-11-01T10:00:00Z"))).toEqual({ stored: 0, skipped: 0 });
    expect((await listeningJobs.tick()).disabled).toBe(true);
    mockReviewSummaries.delete(accountExt);
  });

  // ---------- polling fallback ----------
  it("polls mentions only behind the flag, drops duplicates, remembers its cursor and backs off after an error", async () => {
    const e = ev({ text: "polled mention @artifysols" });
    mockMentionQueue.set(accountExt, [e]);
    await prisma.socialListeningCursor.deleteMany({ where: { socialAccountId: account } });
    expect(await pollListening(new Date())).toEqual({ polled: 0, events: 0 }); // flag off
    expect(await prisma.socialMessage.count({ where: { providerMessageId: e.providerMessageId } })).toBe(0);
    mutable.socialListeningPolling = true;
    expect(await pollListening(new Date())).toMatchObject({ events: 1 });
    expect(await prisma.socialMessage.count({ where: { providerMessageId: e.providerMessageId } })).toBe(1);
    expect(await prisma.socialListeningCursor.findUnique({ where: { socialAccountId: account } })).toMatchObject({ lastError: null });
    expect((await pollListening(new Date())).polled).toBe(0); // polled a moment ago
    await prisma.socialListeningCursor.update({ where: { socialAccountId: account }, data: { polledAt: new Date(Date.now() - 10 * 60_000) } });
    mockMentionQueue.set(accountExt, [e]);
    expect(await pollListening(new Date())).toMatchObject({ polled: 1, events: 0 }); // same provider id: duplicate
    mutable.socialListeningDisabled = true;
    await prisma.socialListeningCursor.update({ where: { socialAccountId: account }, data: { polledAt: new Date(Date.now() - 10 * 60_000) } });
    expect((await pollListening(new Date())).polled).toBe(0);
  });

  // ---------- retention ----------
  it("keeps mentions and reviews for the inbox retention window (180 days) and purges older ones", async () => {
    const old = await ingest({ text: "old mention @artifysols" });
    const recent = await ingest({ text: "recent mention @artifysols" });
    const oldReview = await ingest({ type: "REVIEW", providerThreadId: `r:old${seq}`, text: "old review" });
    const longAgo = new Date(Date.now() - 200 * 86400_000);
    await prisma.socialMessage.updateMany({ where: { conversationId: { in: [old.conv.id, oldReview.conv.id] } }, data: { createdAt: longAgo } });
    await prisma.socialConversation.updateMany({ where: { id: { in: [old.conv.id, oldReview.conv.id] } }, data: { lastMessageAt: longAgo } });
    const r = await purgeExpired(new Date());
    expect(r.messages).toBeGreaterThanOrEqual(2);
    expect(await prisma.socialConversation.count({ where: { id: { in: [old.conv.id, oldReview.conv.id] } } })).toBe(0);
    expect(await prisma.socialConversation.count({ where: { id: recent.conv.id } })).toBe(1);
  });

  // ---------- Google ----------
  it("does not offer Google Business Profile: it cannot be connected and shows as unavailable", async () => {
    const providers = (await api("get", "/social/accounts/providers", agentToken)).body.data?.providers ?? [];
    const g = providers.find((p: { key: string }) => p.key === "google_business");
    if (g) expect(g).toMatchObject({ configured: false, available: false });
    const start = await api("post", "/social/accounts/connect/start", adminToken, { provider: "google_business" });
    expect(start.status).toBeGreaterThanOrEqual(400);
  });

  // ---------- privacy ----------
  it("never logs mention text, and replies/alerts carry no secrets", async () => {
    const joined = logged.join("\n");
    expect(joined).not.toContain(SECRET_MARKER);
    expect(joined).not.toMatch(/IG_PAGE_TOKEN|FB_PAGE_TOKEN|access_token/i);
  });
});
