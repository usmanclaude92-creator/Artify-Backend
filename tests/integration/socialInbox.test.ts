/**
 * Social inbox (Step 7): webhook ingestion, triage, rules, drafts, replies, kill switch, CRM hand-off, SLA, retention, privacy.
 * Real database + mock connector; the AI model is mocked (everything else in the AI module is real). Test data tagged QA_TEST_2026_.
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
import { MOCK_SIGNATURE_HEADER, mockInboxLog, mockPollQueue, signMockWebhook } from "../../server/services/social/connectors/mockProvider";
import { inboxTick, purgeExpired, processTriage } from "../../server/services/social/inbox/inboxPipeline";
import { clearNavBadgeCache } from "../../server/services/navBadgeService";
import type { AiModelAdapter, AiModelCallParams } from "../../server/ai/adapters/types";
import type { InboundEvent } from "../../server/services/social/connectors/types";

const ROLE_KEY = "QA_TEST_2026_INBOX_AGENT";
const mutable = config as unknown as Record<string, unknown>;
const SECRET_MARKER = "QA_TEST_2026_PRIVATE_TEXT_9f3a";

describe("social inbox", () => {
  const app = createApp();
  finalizeApp(app);
  let adminToken = "", agentToken = "", viewerToken = "", portalToken = "", otherToken = "";
  let orgId = "", agentId = "", otherOrgAccount = "";
  let account = "", accountExt = "";
  let ip = 10, seq = 0;
  const logged: string[] = [];
  let aiTriage: (text: string) => object | string = () => ({ intent: "question", sentiment: "neutral", priority: "NORMAL", language: "en", spamScore: 0, category: "general", confidence: 0.9 });
  let aiReply: (thread: string) => object | string = () => ({ body: "Thanks for reaching out! We will get back to you shortly.", confidence: 0.9 });
  let aiCalls: AiModelCallParams[] = [];

  const hdr = () => `10.7.${Math.floor(ip / 250)}.${ip++ % 250}`;
  const api = (method: "get" | "post" | "put" | "patch" | "delete", path: string, token: string, body?: object) => {
    const r = request(app)[method](`/api/v1${path}`).set("Authorization", `Bearer ${token}`).set("X-Forwarded-For", hdr());
    return method === "get" || method === "delete" ? r : r.send(body ?? {});
  };
  const inbox = (method: "get" | "post" | "put" | "patch" | "delete", path: string, token: string, body?: object) => api(method, `/social/inbox${path}`, token, body);
  async function makeUser(email: string, roleKey: string) {
    await api("post", "/users", adminToken, { email, password: "Str0ng-Passphrase-77", firstName: "QA", lastName: "Inbox", roleKey });
    const login = await request(app).post("/api/v1/auth/login").set("X-Forwarded-For", hdr()).send({ email, password: "Str0ng-Passphrase-77" });
    return { token: login.body.data.session.token as string, id: login.body.data.user.id as string };
  }
  async function connect(token: string, name: string) {
    const start = await api("post", "/social/accounts/connect/start", token, { provider: "mock" });
    const state = new URL(start.body.data.authUrl).searchParams.get("state")!;
    const cb = await api("post", "/social/accounts/callback", token, { state, code: `mock_${name}` });
    return { id: cb.body.data.account.id as string, ext: cb.body.data.account.externalAccountId as string };
  }
  const ev = (over: Partial<InboundEvent> = {}): InboundEvent => {
    seq += 1;
    return { type: "COMMENT", accountExternalId: accountExt, providerThreadId: `th-${seq}`, providerMessageId: `m-${seq}`, participant: { externalId: `p${seq}`, handle: `@cust${seq}`, name: `Customer ${seq}` }, text: `Hello ${seq}, what are your opening hours?`, ...over };
  };
  const deliver = (events: InboundEvent[], opts: { sign?: boolean; provider?: string; secret?: string } = {}) => {
    const raw = JSON.stringify({ events });
    const r = request(app).post(`/api/v1/social/webhooks/${opts.provider ?? "mock"}`).set("Content-Type", "application/json").set("X-Forwarded-For", hdr());
    if (opts.sign !== false) r.set(MOCK_SIGNATURE_HEADER, signMockWebhook(raw, opts.secret ?? config.webhookSecret));
    return r.send(raw);
  };
  const ingest = async (over: Partial<InboundEvent> = {}) => {
    const e = ev(over);
    const res = await deliver([e]);
    expect(res.status).toBe(200);
    const conv = await prisma.socialConversation.findFirstOrThrow({ where: { socialAccountId: account, providerThreadId: e.providerThreadId } });
    const msg = await prisma.socialMessage.findFirstOrThrow({ where: { conversationId: conv.id, providerMessageId: e.providerMessageId } });
    return { e, conv, msg };
  };
  const convOf = (id: string) => prisma.socialConversation.findUniqueOrThrow({ where: { id } });
  const setPublishing = async (g: { enabled?: boolean; dryRun?: boolean; kill?: boolean; wKill?: boolean }) => {
    await prisma.socialPublishingGlobal.upsert({ where: { id: "global" }, create: { id: "global", enabled: g.enabled ?? false, dryRun: g.dryRun ?? false, killSwitch: g.kill ?? false }, update: { enabled: g.enabled ?? false, dryRun: g.dryRun ?? false, killSwitch: g.kill ?? false } });
    const w = { enabled: g.enabled ?? false, dryRun: g.dryRun ?? false, killSwitch: g.wKill ?? false };
    await prisma.socialPublishingSetting.upsert({ where: { organizationId: orgId }, create: { organizationId: orgId, ...w }, update: w });
  };
  const setInbox = (data: object) => prisma.socialInboxSetting.upsert({ where: { organizationId: orgId }, create: { organizationId: orgId, ...data }, update: data });

  beforeAll(async () => {
    await resetDb();
    for (const level of ["info", "warn", "error", "debug"] as const) vi.spyOn(logger, level).mockImplementation(((...args: unknown[]) => { logged.push(JSON.stringify(args)); }) as never);
    const reg = await request(app).post("/api/v1/auth/register").set("X-Forwarded-For", "10.0.7.1").send({ email: "qa-inbox-admin@example.com", password: "Str0ng-Passphrase-77", firstName: "QA", lastName: "Admin", organizationName: "QA_TEST_2026_ Inbox" });
    adminToken = reg.body.data.session.token;
    orgId = reg.body.data.user.organizationId;
    otherToken = (await request(app).post("/api/v1/auth/register").set("X-Forwarded-For", "10.0.7.2").send({ email: "qa-inbox-other@example.com", password: "Str0ng-Passphrase-77", firstName: "QA", lastName: "Other", organizationName: "QA_TEST_2026_ Other Inbox" })).body.data.session.token;
    portalToken = (await request(app).post("/api/v1/auth/portal/register").set("X-Forwarded-For", "10.0.7.3").send({ email: "qa-inbox-portal@example.com", password: "Str0ng-Passphrase-77", firstName: "QA", lastName: "Portal", organizationName: "QA_TEST_2026_ Inbox Portal" })).body.data.session.token;

    const role = await prisma.role.create({ data: { key: ROLE_KEY, name: ROLE_KEY, isSystem: false } });
    const perms = await prisma.permission.findMany({ where: { key: { in: ["social.read", "social.reply"] } } });
    await prisma.rolePermission.createMany({ data: perms.map((p) => ({ roleId: role.id, permissionId: p.id })) });
    const agent = await makeUser("qa-inbox-agent@example.com", ROLE_KEY);
    agentToken = agent.token; agentId = agent.id;
    viewerToken = (await makeUser("qa-inbox-viewer@example.com", "VIEWER")).token;
    const a = await connect(adminToken, "inbox_a");
    account = a.id; accountExt = a.ext;
    otherOrgAccount = (await connect(otherToken, "inbox_other")).id;

    const fake: AiModelAdapter = {
      providerType: "MOCK",
      async generateText(params) {
        aiCalls.push(params);
        const isTriage = (params.systemInstruction ?? "").includes("intent");
        const out = isTriage ? aiTriage(params.prompt) : aiReply(params.prompt);
        return { text: typeof out === "string" ? out : JSON.stringify(out), inputTokens: 50, outputTokens: 20, totalTokens: 70, durationMs: 3 };
      },
      async generateStructured() { return {} as never; },
    };
    vi.spyOn(AdapterFactory, "getAdapter").mockReturnValue(fake);
  });
  afterAll(async () => {
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
  beforeEach(async () => {
    mutable.socialReplyRatePerMinute = 50;
    mutable.socialPublishingDisabled = false;
    await setPublishing({});
    await prisma.socialInboxSetting.deleteMany({ where: { organizationId: orgId } });
    await prisma.socialInboxRule.deleteMany({ where: { organizationId: orgId } });
    await prisma.socialCannedReply.deleteMany({ where: { organizationId: orgId } });
    await prisma.socialBrandVoice.deleteMany({ where: { organizationId: orgId } });
    await prisma.socialAccount.updateMany({ where: { id: account }, data: { status: "CONNECTED" } });
    // Keep earlier tests' pending triage out of later ones.
    await prisma.socialMessage.updateMany({ where: { organizationId: orgId, triageStatus: "PENDING" }, data: { triageStatus: "SKIPPED" } });
    aiCalls = [];
    aiTriage = () => ({ intent: "question", sentiment: "neutral", priority: "NORMAL", language: "en", spamScore: 0, category: "general", confidence: 0.9 });
    aiReply = () => ({ body: "Thanks for reaching out! We will get back to you shortly.", confidence: 0.9 });
  });

  // ---------- webhook ----------
  it("rejects missing/forged signatures and unknown or unsupported providers, storing nothing", async () => {
    const before = await prisma.socialMessage.count();
    expect((await deliver([ev()], { sign: false })).status).toBe(401);
    expect((await deliver([ev()], { secret: "wrong-secret-0000000000000000" })).status).toBe(401);
    expect((await deliver([ev()], { provider: "nope" })).status).toBe(404);
    expect((await deliver([ev()], { provider: "meta" })).status).toBe(404); // registered, not configured / not supported yet
    expect((await deliver([ev()], { provider: "linkedin" })).status).toBe(404);
    expect(await prisma.socialMessage.count()).toBe(before);
  });

  it("ingests a signed delivery and is idempotent by provider message id (redelivery and concurrent delivery)", async () => {
    const e = ev();
    const first = await deliver([e]);
    expect(first.status).toBe(200);
    expect(first.body.data).toMatchObject({ accepted: 1, duplicates: 0 });
    const again = await deliver([e]);
    expect(again.body.data).toMatchObject({ accepted: 0, duplicates: 1 });
    const e2 = ev();
    await Promise.all([deliver([e2]), deliver([e2]), deliver([e2])]);
    expect(await prisma.socialMessage.count({ where: { socialAccountId: account, providerMessageId: { in: [e.providerMessageId, e2.providerMessageId] } } })).toBe(2);
    expect(await prisma.socialConversation.count({ where: { socialAccountId: account, providerThreadId: { in: [e.providerThreadId, e2.providerThreadId] } } })).toBe(2);
    // A second message in the same thread appends; unknown accounts are ignored.
    const follow = ev({ providerThreadId: e.providerThreadId });
    await deliver([follow]);
    const conv = await prisma.socialConversation.findFirstOrThrow({ where: { socialAccountId: account, providerThreadId: e.providerThreadId } });
    expect(await prisma.socialMessage.count({ where: { conversationId: conv.id } })).toBe(2);
    const stray = await deliver([ev({ accountExternalId: "mock-someone-else" })]);
    expect(stray.body.data).toMatchObject({ accepted: 0, ignored: 1 });
  });

  it("stores spam caught by the deterministic prefilter without calling the model", async () => {
    const { conv, msg } = await ingest({ text: "Buy cheap followers now!! click the link in my bio" });
    expect((await convOf(conv.id)).status).toBe("SPAM");
    expect((await prisma.socialTriage.findUniqueOrThrow({ where: { messageId: msg.id } })).source).toBe("RULE_PREFILTER");
    await inboxTick();
    expect(aiCalls).toHaveLength(0);
  });

  it("the dev inject endpoint feeds the same pipeline, for mock accounts only", async () => {
    const res = await inbox("post", "/dev/inject", adminToken, { accountId: account, type: "DM", text: "Injected demo message", handle: "demo_user" });
    expect(res.status).toBe(201);
    expect((await prisma.socialConversation.findUniqueOrThrow({ where: { id: res.body.data.result.conversationId } })).type).toBe("DM");
    expect((await inbox("post", "/dev/inject", adminToken, { accountId: otherOrgAccount, text: "x" })).status).toBe(400);
    expect((await inbox("post", "/dev/inject", agentToken, { accountId: account, text: "x" })).status).toBe(403);
    mutable.nodeEnv = "production";
    expect((await inbox("post", "/dev/inject", adminToken, { accountId: account, text: "x" })).status).toBe(404);
    mutable.nodeEnv = "test";
  });

  // ---------- triage, rules ----------
  it("triages through the AI module, keeps message text out of AI execution records, and flags complaints for humans", async () => {
    aiTriage = () => ({ intent: "complaint", sentiment: "negative", priority: "NORMAL", language: "en", spamScore: 0, category: "billing", confidence: 0.97 });
    const { conv, msg } = await ingest({ text: `I was charged twice! ${SECRET_MARKER}` });
    await prisma.socialMessage.updateMany({ where: { organizationId: orgId, triageStatus: "PENDING", id: { not: msg.id } }, data: { triageStatus: "SKIPPED" } });
    const r = await processTriage();
    expect(r.triaged).toBe(1);
    const c = await convOf(conv.id);
    expect(c).toMatchObject({ intent: "complaint", sentiment: "negative", priority: "HIGH", needsHuman: true });
    const t = await prisma.socialTriage.findUniqueOrThrow({ where: { messageId: msg.id } });
    expect(t).toMatchObject({ flaggedForHuman: true, source: "AI", suggestedCategory: "billing" });
    const exec = await prisma.aIExecution.findFirstOrThrow({ where: { id: t.aiExecutionId! }, include: { usageRecords: true } });
    expect(exec).toMatchObject({ toolCode: "social_inbox_triage", status: "COMPLETED", userId: null });
    expect(exec.usageRecords).toHaveLength(1);
    expect(JSON.stringify([exec.input, exec.output])).not.toContain(SECRET_MARKER);
    expect(aiCalls[0]!.prompt).toContain(SECRET_MARKER); // the model does receive the data...
    expect(aiCalls[0]!.systemInstruction).toContain("untrusted data"); // ...as untrusted input
  });

  it("falls back to human review after repeated unusable model output", async () => {
    aiTriage = () => "total nonsense";
    const { conv, msg } = await ingest();
    await prisma.socialMessage.updateMany({ where: { organizationId: orgId, triageStatus: "PENDING", id: { not: msg.id } }, data: { triageStatus: "SKIPPED" } });
    await processTriage(); await processTriage(); await processTriage();
    const t = await prisma.socialTriage.findUniqueOrThrow({ where: { messageId: msg.id } });
    expect(t).toMatchObject({ source: "FALLBACK", flaggedForHuman: true });
    expect((await convOf(conv.id)).needsHuman).toBe(true);
    expect((await prisma.socialMessage.findUniqueOrThrow({ where: { id: msg.id } })).triageStatus).toBe("DONE");
  });

  it("applies routing rules (assignee, priority, tags) and notifies the assignee with a short redacted preview only", async () => {
    await prisma.socialInboxRule.create({ data: { organizationId: orgId, name: "Pricing → agent", matchKeywords: ["pricing"], assigneeId: agentId, setPriority: "HIGH", addTags: ["sales"] } });
    aiTriage = () => ({ intent: "lead", sentiment: "positive", priority: "NORMAL", language: "en", spamScore: 0, category: "sales", confidence: 0.9 });
    const text = `Hi, I'd like pricing details. Email me at jane.doe@example.com or +44 7700 900123. ${SECRET_MARKER} and a lot more private text that must never appear in a notification.`;
    const { conv, msg } = await ingest({ text });
    await prisma.socialMessage.updateMany({ where: { organizationId: orgId, triageStatus: "PENDING", id: { not: msg.id } }, data: { triageStatus: "SKIPPED" } });
    await processTriage();
    expect(await convOf(conv.id)).toMatchObject({ assigneeId: agentId, priority: "HIGH", tags: ["sales"], intent: "lead" });
    const notes = await prisma.notification.findMany({ where: { entityId: conv.id, userId: agentId } });
    expect(notes).toHaveLength(1);
    expect(notes[0]!.message.length).toBeLessThanOrEqual(45);
    const blob = JSON.stringify(notes);
    for (const secret of [SECRET_MARKER, "jane.doe@example.com", "7700 900123"]) expect(blob).not.toContain(secret);
    expect(await prisma.auditLog.count({ where: { resourceId: conv.id, action: "SOCIAL_INBOX_RULES_APPLIED" } })).toBe(1);
  });

  it("polling fallback ingests events for providers that need polling", async () => {
    const e = ev();
    mockPollQueue.set(accountExt, [e]);
    await prisma.socialInboxCursor.deleteMany({ where: { socialAccountId: account } });
    const out = await inboxTick();
    expect(out.polled.events).toBe(1);
    expect(await prisma.socialMessage.count({ where: { socialAccountId: account, providerMessageId: e.providerMessageId } })).toBe(1);
    mockPollQueue.set(accountExt, [e]); // within the poll interval and a duplicate anyway
    expect((await inboxTick()).polled.events).toBe(0);
  });

  // ---------- drafts & replies ----------
  it("drafts a reply in the brand voice with confidence and guardrail result — and never sends it", async () => {
    await prisma.socialBrandVoice.create({ data: { organizationId: orgId, toneDescriptors: ["warm"], bannedWords: ["guarantee"] } });
    const { conv } = await ingest();
    const sentBefore = mockInboxLog.replies.length;
    aiReply = () => ({ body: "We guarantee a reply today!", confidence: 0.7 });
    const bad = await inbox("post", `/conversations/${conv.id}/draft`, agentToken);
    expect(bad.status).toBe(200);
    expect(bad.body.data.draft).toMatchObject({ confidence: 0.7 });
    expect(bad.body.data.draft.guardrail.passed).toBe(false);
    expect(bad.body.data.draft.guardrail.issues[0].rule).toBe("banned_word");
    const blocked = await inbox("post", `/conversations/${conv.id}/reply`, agentToken, { messageId: bad.body.data.draft.messageId });
    expect(blocked.status).toBe(400); // guardrails apply at send time as well
    aiReply = () => ({ body: "Our hours are 9-5, Mon-Fri.", confidence: 0.92 });
    const good = await inbox("post", `/conversations/${conv.id}/draft`, agentToken);
    expect(good.body.data.draft.guardrail.passed).toBe(true);
    const msgs = await prisma.socialMessage.findMany({ where: { conversationId: conv.id, authorKind: "AI_DRAFT" } });
    expect(msgs).toHaveLength(1); // regenerating replaces the previous draft
    expect(msgs[0]).toMatchObject({ sendStatus: "DRAFT", aiConfidence: 0.92 });
    expect(mockInboxLog.replies.length).toBe(sentBefore);
    expect((await inbox("post", `/conversations/${conv.id}/draft`, viewerToken)).status).toBe(403);
  });

  it("a human edits and sends a draft: SENT once, conversation PENDING, first response recorded, audit without text", async () => {
    const { conv } = await ingest();
    const d = (await inbox("post", `/conversations/${conv.id}/draft`, agentToken)).body.data.draft;
    expect((await inbox("patch", `/messages/${d.messageId}`, agentToken, { body: "Edited by a human." })).status).toBe(200);
    const before = mockInboxLog.replies.length;
    const sent = await inbox("post", `/conversations/${conv.id}/reply`, agentToken, { messageId: d.messageId });
    expect(sent.status).toBe(200);
    expect(sent.body.data.message.sendStatus).toBe("SENT");
    expect(mockInboxLog.replies).toHaveLength(before + 1);
    expect(mockInboxLog.replies.at(-1)).toMatchObject({ text: "Edited by a human.", providerThreadId: conv.providerThreadId, conversationType: "COMMENT" });
    const c = await convOf(conv.id);
    expect(c).toMatchObject({ status: "PENDING", isRead: true, slaDueAt: null });
    expect(c.firstResponseAt).not.toBeNull();
    const stored = await prisma.socialMessage.findUniqueOrThrow({ where: { id: d.messageId } });
    expect(stored).toMatchObject({ authorKind: "PAGE", sendStatus: "SENT", sentById: agentId, autoSent: false });
    expect(stored.providerMessageId).toMatch(/^mockreply_/);
    // never twice
    expect((await inbox("post", `/conversations/${conv.id}/reply`, agentToken, { messageId: d.messageId })).status).toBe(409);
    expect(mockInboxLog.replies).toHaveLength(before + 1);
    const audits = await prisma.auditLog.findMany({ where: { resourceId: conv.id, action: "SOCIAL_INBOX_REPLY_SENT" } });
    expect(audits).toHaveLength(1);
    expect(JSON.stringify(audits[0]!.metadata)).not.toContain("Edited by a human");
    // a new customer message reopens the thread with a fresh SLA clock
    await deliver([ev({ providerThreadId: conv.providerThreadId })]);
    expect(await convOf(conv.id)).toMatchObject({ status: "OPEN", firstResponseAt: null });
  });

  it("send-and-resolve resolves; a note is internal and never sent", async () => {
    const { conv } = await ingest();
    const before = mockInboxLog.replies.length;
    expect((await inbox("post", `/conversations/${conv.id}/notes`, agentToken, { body: "Internal: VIP customer" })).status).toBe(201);
    expect(mockInboxLog.replies).toHaveLength(before);
    const res = await inbox("post", `/conversations/${conv.id}/reply`, agentToken, { body: "All sorted, thank you!", resolve: true });
    expect(res.body.data.message.sendStatus).toBe("SENT");
    expect((await convOf(conv.id)).status).toBe("RESOLVED");
    const detail = (await inbox("get", `/conversations/${conv.id}`, agentToken)).body.data;
    expect(detail.messages.map((m: { authorKind: string }) => m.authorKind)).toEqual(["CUSTOMER", "NOTE", "PAGE"]);
  });

  it("the publishing kill switch (env, global, workspace) blocks sends before anything leaves", async () => {
    const { conv } = await ingest();
    const before = mockInboxLog.replies.length;
    await setPublishing({ wKill: true });
    expect((await inbox("post", `/conversations/${conv.id}/reply`, agentToken, { body: "hello" })).status).toBe(409);
    await setPublishing({ kill: true });
    expect((await inbox("post", `/conversations/${conv.id}/reply`, agentToken, { body: "hello" })).status).toBe(409);
    await setPublishing({});
    mutable.socialPublishingDisabled = true;
    const blocked = await inbox("post", `/conversations/${conv.id}/reply`, agentToken, { body: "hello" });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.message).toMatch(/paused/i);
    mutable.socialPublishingDisabled = false;
    expect(mockInboxLog.replies).toHaveLength(before);
    expect((await inbox("post", `/conversations/${conv.id}/reply`, agentToken, { body: "hello again" })).status).toBe(200);
  });

  it("shows send failures in the inbox, never auto-retries unknown outcomes, and flags accounts that need re-auth", async () => {
    const t1 = await ingest();
    const fail = await inbox("post", `/conversations/${t1.conv.id}/reply`, agentToken, { body: "Please [[fail-transient]]" });
    expect(fail.body.data.message).toMatchObject({ sendStatus: "FAILED" });
    const list = (await inbox("get", "/conversations?status=OPEN&limit=50", agentToken)).body.data.conversations;
    expect(list.find((c: { id: string }) => c.id === t1.conv.id).failedSend).toBe(true);
    const failedMsg = await prisma.socialMessage.findFirstOrThrow({ where: { conversationId: t1.conv.id, sendStatus: "FAILED" } });
    expect((await inbox("patch", `/messages/${failedMsg.id}`, agentToken, { body: "Fixed wording" })).status).toBe(200);
    expect((await inbox("post", `/conversations/${t1.conv.id}/reply`, agentToken, { messageId: failedMsg.id })).body.data.message.sendStatus).toBe("SENT");

    const t2 = await ingest();
    const unknown = await inbox("post", `/conversations/${t2.conv.id}/reply`, agentToken, { body: "Maybe [[timeout]]" });
    expect(unknown.body.data.message.sendStatus).toBe("UNCERTAIN");
    const uncertain = await prisma.socialMessage.findFirstOrThrow({ where: { conversationId: t2.conv.id, sendStatus: "UNCERTAIN" } });
    const count = mockInboxLog.replies.length;
    expect((await inbox("post", `/conversations/${t2.conv.id}/reply`, agentToken, { messageId: uncertain.id })).status).toBe(400);
    expect(mockInboxLog.replies).toHaveLength(count);

    const t3 = await ingest();
    await inbox("post", `/conversations/${t3.conv.id}/reply`, agentToken, { body: "Revoked [[fail-auth]]" });
    expect((await prisma.socialAccount.findUniqueOrThrow({ where: { id: account } })).status).toBe("NEEDS_REAUTH");
    expect((await inbox("post", `/conversations/${t3.conv.id}/reply`, agentToken, { body: "again" })).status).toBe(409);
  });

  it("enforces a per-account reply rate limit", async () => {
    mutable.socialReplyRatePerMinute = 2;
    const items = [await ingest(), await ingest(), await ingest()];
    const recentSent = await prisma.socialMessage.count({ where: { socialAccountId: account, sendStatus: { in: ["SENDING", "SENT"] }, sentAt: { gte: new Date(Date.now() - 60_000) } } });
    await prisma.socialMessage.updateMany({ where: { socialAccountId: account, sentAt: { gte: new Date(Date.now() - 60_000) } }, data: { sentAt: new Date(Date.now() - 120_000) } });
    void recentSent;
    expect((await inbox("post", `/conversations/${items[0]!.conv.id}/reply`, agentToken, { body: "one" })).status).toBe(200);
    expect((await inbox("post", `/conversations/${items[1]!.conv.id}/reply`, agentToken, { body: "two" })).status).toBe(200);
    const limited = await inbox("post", `/conversations/${items[2]!.conv.id}/reply`, agentToken, { body: "three" });
    expect(limited.status).toBe(429);
  });

  it("hides comments through the connector (comments only)", async () => {
    const c = await ingest({ type: "COMMENT" });
    const hidden = await inbox("post", `/messages/${c.msg.id}/hide`, agentToken, { hidden: true });
    expect(hidden.body.data.hidden).toBe(true);
    expect(mockInboxLog.hidden.at(-1)).toMatchObject({ providerMessageId: c.e.providerMessageId, hidden: true });
    const dm = await ingest({ type: "DM" });
    expect((await inbox("post", `/messages/${dm.msg.id}/hide`, agentToken, { hidden: true })).status).toBe(400);
  });

  it("workflow actions: assign (validated), priority, status, spam, mark read (provider sync), bulk — all audited", async () => {
    const { conv } = await ingest();
    expect((await inbox("post", `/conversations/${conv.id}/assign`, agentToken, { assigneeId: agentId })).body.data.conversation.assigneeId).toBe(agentId);
    const viewerLookup = await prisma.user.findFirstOrThrow({ where: { email: "qa-inbox-viewer@example.com" } });
    expect((await inbox("post", `/conversations/${conv.id}/assign`, agentToken, { assigneeId: viewerLookup.id })).status).toBe(400); // viewers cannot reply
    expect((await inbox("post", `/conversations/${conv.id}/priority`, agentToken, { priority: "URGENT" })).body.data.conversation.priority).toBe("URGENT");
    await inbox("post", `/conversations/${conv.id}/read`, agentToken, { read: true });
    expect(mockInboxLog.read.at(-1)).toEqual({ providerThreadId: conv.providerThreadId });
    expect((await inbox("post", `/conversations/${conv.id}/status`, agentToken, { status: "SPAM" })).body.data.conversation.status).toBe("SPAM");
    const other = await ingest();
    const bulk = await inbox("post", "/bulk", agentToken, { ids: [conv.id, other.conv.id, "00000000-0000-4000-8000-000000000000"], patch: { status: "RESOLVED", priority: "LOW" } });
    expect(bulk.body.data.updated).toBe(2);
    const actions = (await prisma.auditLog.findMany({ where: { organizationId: orgId, actorUserId: agentId, action: { startsWith: "SOCIAL_INBOX_" } } })).map((a) => a.action);
    for (const a of ["SOCIAL_INBOX_ASSIGNED", "SOCIAL_INBOX_PRIORITY_CHANGED", "SOCIAL_INBOX_MARKED_SPAM", "SOCIAL_INBOX_BULK_UPDATE"]) expect(actions).toContain(a);
  });

  it("canned replies: anyone who can reply manages them, only admins approve them for auto-reply", async () => {
    const created = await inbox("post", "/canned", agentToken, { title: "Hours", body: "We open at 9.", matchKeywords: ["hours"] });
    expect(created.status).toBe(201);
    expect((await inbox("post", "/canned", agentToken, { title: "Auto", body: "x", approvedForAuto: true })).status).toBe(403);
    const approved = await inbox("post", "/canned", adminToken, { title: "Auto", body: "We open at 9.", approvedForAuto: true, matchKeywords: ["opening hours"] });
    expect(approved.body.data.reply.approvedForAuto).toBe(true);
    expect((await inbox("put", `/canned/${approved.body.data.reply.id}`, agentToken, { title: "Auto", body: "changed" })).status).toBe(403);
    expect((await inbox("delete", `/canned/${approved.body.data.reply.id}`, agentToken)).status).toBe(403);
    expect((await inbox("get", "/canned", viewerToken)).body.data.replies.length).toBe(2);
    expect((await inbox("delete", `/canned/${created.body.data.reply.id}`, agentToken)).status).toBe(200);
  });

  // ---------- auto-reply ----------
  it("auto-reply is OFF by default: a thank-you only gets a draft", async () => {
    aiTriage = () => ({ intent: "praise", sentiment: "positive", priority: "LOW", language: "en", spamScore: 0, category: "thanks", confidence: 0.95 });
    await setPublishing({ enabled: true });
    await setInbox({ autoDraft: true });
    const { conv, msg } = await ingest({ text: "Thank you, you are great!" });
    await prisma.socialMessage.updateMany({ where: { organizationId: orgId, triageStatus: "PENDING", id: { not: msg.id } }, data: { triageStatus: "SKIPPED" } });
    const before = mockInboxLog.replies.length;
    await processTriage();
    expect(mockInboxLog.replies).toHaveLength(before);
    expect(await prisma.socialMessage.count({ where: { conversationId: conv.id, authorKind: "AI_DRAFT", sendStatus: "DRAFT" } })).toBe(1);
  });

  it("when enabled, auto-reply sends only low-risk categories, live only, with the kill switch and guardrails applied", async () => {
    await setInbox({ autoDraft: true, autoReply: true });
    await prisma.socialCannedReply.create({ data: { organizationId: orgId, title: "Hours", body: "We are open 9-5, Mon-Fri.", approvedForAuto: true, matchKeywords: ["opening hours"] } });
    const settle = async (msgId: string) => { await prisma.socialMessage.updateMany({ where: { organizationId: orgId, triageStatus: "PENDING", id: { not: msgId } }, data: { triageStatus: "SKIPPED" } }); await processTriage(); };

    // thanks → sent (live)
    await setPublishing({ enabled: true });
    aiTriage = () => ({ intent: "praise", sentiment: "positive", priority: "LOW", language: "en", spamScore: 0, category: "thanks", confidence: 0.95 });
    aiReply = () => ({ body: "Thank you so much, that means a lot to us!", confidence: 0.93 });
    const thanks = await ingest({ text: "Love your product, thank you!" });
    let n = mockInboxLog.replies.length;
    await settle(thanks.msg.id);
    expect(mockInboxLog.replies).toHaveLength(n + 1);
    expect(await prisma.socialMessage.findFirstOrThrow({ where: { conversationId: thanks.conv.id, sendStatus: "SENT" } })).toMatchObject({ autoSent: true, authorKind: "PAGE" });
    expect(await prisma.auditLog.count({ where: { resourceId: thanks.conv.id, action: "SOCIAL_INBOX_AUTO_REPLY_SENT" } })).toBe(1);

    // approved FAQ → canned answer sent
    aiTriage = () => ({ intent: "question", sentiment: "neutral", priority: "NORMAL", language: "en", spamScore: 0, category: "faq", confidence: 0.9 });
    const faq = await ingest({ text: "What are your opening hours?" });
    n = mockInboxLog.replies.length;
    await settle(faq.msg.id);
    expect(mockInboxLog.replies.at(-1)!.text).toBe("We are open 9-5, Mon-Fri.");
    expect(mockInboxLog.replies).toHaveLength(n + 1);

    // question without an approved answer → draft only
    const unknown = await ingest({ text: "Do you ship to Iceland?" });
    n = mockInboxLog.replies.length;
    await settle(unknown.msg.id);
    expect(mockInboxLog.replies).toHaveLength(n);
    expect(await prisma.socialMessage.count({ where: { conversationId: unknown.conv.id, authorKind: "AI_DRAFT" } })).toBe(1);

    // complaint / negative → never auto-sent, even with a confident, guardrail-clean draft
    aiTriage = () => ({ intent: "complaint", sentiment: "negative", priority: "HIGH", language: "en", spamScore: 0, category: "billing", confidence: 0.99 });
    const angry = await ingest({ text: "This is unacceptable, I want a refund" });
    n = mockInboxLog.replies.length;
    await settle(angry.msg.id);
    expect(mockInboxLog.replies).toHaveLength(n);

    // dry-run and kill switch stop auto-reply even for thanks
    aiTriage = () => ({ intent: "praise", sentiment: "positive", priority: "LOW", language: "en", spamScore: 0, category: "thanks", confidence: 0.95 });
    await setPublishing({ enabled: true, dryRun: true });
    const dry = await ingest({ text: "Thanks a lot!" });
    n = mockInboxLog.replies.length;
    await settle(dry.msg.id);
    expect(mockInboxLog.replies).toHaveLength(n);
    await setPublishing({ enabled: true, wKill: true });
    const killed = await ingest({ text: "Many thanks!" });
    await settle(killed.msg.id);
    expect(mockInboxLog.replies).toHaveLength(n);

    // a draft that fails guardrails is never auto-sent
    await setPublishing({ enabled: true });
    await prisma.socialBrandVoice.create({ data: { organizationId: orgId, bannedWords: ["amazing"] } });
    aiReply = () => ({ body: "You are amazing, thank you!", confidence: 0.99 });
    const guarded = await ingest({ text: "Cheers, thank you!" });
    await settle(guarded.msg.id);
    expect(mockInboxLog.replies).toHaveLength(n);
  });

  // ---------- CRM ----------
  it("creates a lead from a conversation with prefill, link and audit; dedupes by social handle, email and existing contact", async () => {
    const first = await ingest({ participant: { externalId: "px1", handle: "@Ada_Lovelace", name: "Ada Lovelace" }, text: "Hi, we need a quote for 20 seats. Reach me at ada@analytical.example" });
    const res = await inbox("post", `/conversations/${first.conv.id}/lead`, agentToken, {});
    expect(res.status).toBe(200);
    expect(res.body.data.handoff.outcome).toBe("created");
    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: res.body.data.handoff.leadId } });
    expect(lead).toMatchObject({ organizationId: orgId, contactName: "Ada Lovelace", email: "ada@analytical.example", source: "social:mock:ada_lovelace" });
    expect(lead.notes).toContain(`/social/inbox?conversation=${first.conv.id}`);
    expect((await convOf(first.conv.id)).leadId).toBe(lead.id);
    expect(await prisma.auditLog.count({ where: { resourceId: lead.id, action: "LEAD_CREATED" } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { resourceId: first.conv.id, action: "SOCIAL_INBOX_LEAD_LINKED" } })).toBe(1);
    expect((await inbox("post", `/conversations/${first.conv.id}/lead`, agentToken, {})).status).toBe(409);

    // same person, new thread, no email → deduped by the social source tag
    const again = await ingest({ participant: { externalId: "px1", handle: "ada_lovelace", name: "Ada" }, text: "Following up on my quote" });
    const second = await inbox("post", `/conversations/${again.conv.id}/lead`, agentToken, {});
    expect(second.body.data.handoff).toMatchObject({ outcome: "linked_lead", leadId: lead.id });
    // different handle but the same email → deduped by email via the CRM's own rule
    const byMail = await ingest({ participant: { handle: "@ada_alt" }, text: "Hi it's Ada again — ada@analytical.example" });
    expect((await inbox("post", `/conversations/${byMail.conv.id}/lead`, agentToken, {})).body.data.handoff).toMatchObject({ outcome: "linked_lead", leadId: lead.id });
    expect(await prisma.lead.count({ where: { organizationId: orgId, source: { startsWith: "social:" } } })).toBe(1);

    // existing contact → linked, no lead created
    await prisma.contact.create({ data: { organizationId: orgId, firstName: "QA_TEST_2026_Grace", lastName: "Hopper", email: "grace@navy.example" } });
    const known = await ingest({ participant: { handle: "@grace" }, text: "Hello, grace@navy.example here" });
    const linked = await inbox("post", `/conversations/${known.conv.id}/lead`, agentToken, {});
    expect(linked.body.data.handoff).toMatchObject({ outcome: "linked_contact", leadId: null });
    expect((await convOf(known.conv.id)).contactId).not.toBeNull();
    expect(await prisma.lead.count({ where: { organizationId: orgId, source: { startsWith: "social:" } } })).toBe(1);
    expect((await inbox("post", `/conversations/${known.conv.id}/lead`, viewerToken, {})).status).toBe(403);
  });

  it("auto-lead (when enabled) creates one lead for lead-intent messages, deduplicated", async () => {
    await setInbox({ autoLead: true });
    aiTriage = () => ({ intent: "lead", sentiment: "positive", priority: "NORMAL", language: "en", spamScore: 0, category: "sales", confidence: 0.9 });
    const a = await ingest({ participant: { handle: "@buyer_one" }, text: "How much does the enterprise plan cost?" });
    await prisma.socialMessage.updateMany({ where: { organizationId: orgId, triageStatus: "PENDING", id: { not: a.msg.id } }, data: { triageStatus: "SKIPPED" } });
    await processTriage();
    const linked = await convOf(a.conv.id);
    expect(linked.leadId).not.toBeNull();
    const b = await ingest({ participant: { handle: "buyer_one" }, text: "Any update on pricing?" });
    await prisma.socialMessage.updateMany({ where: { organizationId: orgId, triageStatus: "PENDING", id: { not: b.msg.id } }, data: { triageStatus: "SKIPPED" } });
    await processTriage();
    expect((await convOf(b.conv.id)).leadId).toBe(linked.leadId);
    expect(await prisma.lead.count({ where: { organizationId: orgId, source: "social:mock:buyer_one" } })).toBe(1);
  });

  // ---------- SLA, metrics, badge ----------
  it("highlights overdue items, notifies once, and reports open/overdue/unassigned counts, median first response and the badge", async () => {
    await setInbox({ firstResponseMinutes: 30 });
    const { conv } = await ingest();
    await prisma.socialConversation.update({ where: { id: conv.id }, data: { slaDueAt: new Date(Date.now() - 5 * 60_000) } });
    const first = await inboxTick();
    expect(first.overdueNotified).toBeGreaterThanOrEqual(1);
    expect((await inboxTick()).overdueNotified).toBe(0); // once per item
    expect(await prisma.notification.count({ where: { entityId: conv.id, type: "social_inbox_overdue" } })).toBeGreaterThan(0);
    const overdueList = (await inbox("get", "/conversations?overdue=true&limit=50", agentToken)).body.data.conversations;
    expect(overdueList.find((c: { id: string }) => c.id === conv.id)).toMatchObject({ overdue: true });

    // median first-response time: two answered conversations (1 and 3 minutes); earlier tests' answers fall outside the 30-day window
    await prisma.socialConversation.updateMany({ where: { organizationId: orgId, firstResponseAt: { not: null } }, data: { firstResponseAt: new Date(Date.now() - 90 * 86400_000) } });
    for (const minutes of [1, 3]) {
      const x = await ingest();
      await prisma.socialConversation.update({ where: { id: x.conv.id }, data: { awaitingSince: new Date(Date.now() - minutes * 60_000), status: "RESOLVED", firstResponseAt: new Date() } });
    }
    clearNavBadgeCache();
    const m = (await inbox("get", "/metrics", agentToken)).body.data.metrics;
    expect(m.open).toBeGreaterThanOrEqual(1);
    expect(m.overdue).toBeGreaterThanOrEqual(1);
    expect(m.unassigned).toBeGreaterThanOrEqual(1);
    expect(m.medianFirstResponseMs).toBeGreaterThan(100_000); // median of 1 and 3 minutes = 2 minutes
    expect(m.medianFirstResponseMs).toBeLessThan(140_000);
    const badge = (await api("get", "/nav/badges", agentToken)).body.data.badges;
    expect(badge.socialInbox).toBeGreaterThanOrEqual(1);
    expect((await api("get", "/nav/badges", viewerToken)).body.data.badges.socialInbox).toBeUndefined();
  });

  // ---------- retention ----------
  it("purges messages and empty conversations beyond the retention period (configurable, audited)", async () => {
    const old = await ingest();
    const fresh = await ingest();
    await prisma.socialInboxSetting.upsert({ where: { organizationId: orgId }, create: { organizationId: orgId, retentionDays: 7 }, update: { retentionDays: 7 } });
    const ancient = new Date(Date.now() - 30 * 86400_000);
    await prisma.socialMessage.updateMany({ where: { conversationId: old.conv.id }, data: { createdAt: ancient } });
    await prisma.socialConversation.update({ where: { id: old.conv.id }, data: { lastMessageAt: ancient } });
    const out = await purgeExpired();
    expect(out.conversations).toBeGreaterThanOrEqual(1);
    expect(await prisma.socialConversation.count({ where: { id: old.conv.id } })).toBe(0);
    expect(await prisma.socialTriage.count({ where: { conversationId: old.conv.id } })).toBe(0);
    expect(await prisma.socialConversation.count({ where: { id: fresh.conv.id } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { organizationId: orgId, action: "SOCIAL_INBOX_RETENTION_PURGE" } })).toBeGreaterThanOrEqual(1);
    // default retention is 180 days
    expect((await inbox("get", "/settings", viewerToken)).body.data.settings.retentionDays).toBe(7);
    await prisma.socialInboxSetting.deleteMany({ where: { organizationId: orgId } });
    expect((await inbox("get", "/settings", viewerToken)).body.data.settings).toMatchObject({ retentionDays: 180, autoReply: false, autoDraft: false, autoTriage: true, firstResponseMinutes: 60 });
  });

  // ---------- permissions, scoping, privacy ----------
  it("enforces permissions and workspace scoping", async () => {
    const { conv } = await ingest({ text: "scoping check" });
    expect((await inbox("get", "/conversations", portalToken)).status).toBe(403);
    expect((await inbox("get", "/conversations", viewerToken)).status).toBe(200);
    expect((await inbox("get", `/conversations/${conv.id}`, viewerToken)).status).toBe(200);
    for (const [method, path, body] of [["post", `/conversations/${conv.id}/reply`, { body: "x" }], ["post", `/conversations/${conv.id}/assign`, { assigneeId: null }], ["post", `/conversations/${conv.id}/notes`, { body: "x" }], ["post", `/conversations/${conv.id}/status`, { status: "RESOLVED" }], ["post", "/canned", { title: "t", body: "b" }]] as const) {
      expect((await inbox(method, path, viewerToken, body)).status).toBe(403);
    }
    expect((await inbox("put", "/settings", agentToken, { autoReply: true })).status).toBe(403);
    expect((await inbox("post", "/rules", agentToken, { name: "r", matchKeywords: ["x"] })).status).toBe(403);
    // another workspace sees nothing and cannot touch it
    expect((await inbox("get", `/conversations/${conv.id}`, otherToken)).status).toBe(404);
    expect((await inbox("post", `/conversations/${conv.id}/reply`, otherToken, { body: "x" })).status).toBe(404);
    expect((await inbox("get", "/conversations?limit=50", otherToken)).body.data.conversations.map((c: { id: string }) => c.id)).not.toContain(conv.id);
    expect((await inbox("post", "/bulk", otherToken, { ids: [conv.id], patch: { status: "SPAM" } })).body.data.updated).toBe(0);
    expect((await convOf(conv.id)).status).not.toBe("SPAM");
  });

  it("settings and rules: admin edits are validated and audited", async () => {
    const upd = await inbox("put", "/settings", adminToken, { autoDraft: true, firstResponseMinutes: 45, retentionDays: 90 });
    expect(upd.body.data.settings).toMatchObject({ autoDraft: true, autoReply: false, firstResponseMinutes: 45, retentionDays: 90 });
    expect((await inbox("put", "/settings", adminToken, { retentionDays: 1 })).status).toBe(400);
    expect(await prisma.auditLog.count({ where: { organizationId: orgId, action: "SOCIAL_INBOX_SETTINGS_CHANGED" } })).toBeGreaterThanOrEqual(1);
    expect((await inbox("post", "/rules", adminToken, { name: "empty" })).status).toBe(400);
    const rule = await inbox("post", "/rules", adminToken, { name: "VIP", matchKeywords: ["vip"], assigneeId: agentId, addTags: ["vip"] });
    expect(rule.status).toBe(201);
    expect((await inbox("post", "/rules", adminToken, { name: "bad", matchKeywords: ["x"], assigneeId: (await prisma.user.findFirstOrThrow({ where: { email: "qa-inbox-viewer@example.com" } })).id })).status).toBe(400);
    expect((await inbox("delete", `/rules/${rule.body.data.rule.id}`, adminToken)).status).toBe(200);
  });

  it("never writes message text to logs", () => {
    const blob = logged.join("\n");
    expect(blob.length).toBeGreaterThan(0);
    for (const secret of [SECRET_MARKER, "jane.doe@example.com", "Edited by a human", "I was charged twice", "analytical.example"]) expect(blob).not.toContain(secret);
  });
});
