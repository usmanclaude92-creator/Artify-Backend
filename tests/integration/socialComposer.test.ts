/** Social composer: posts, guardrails, transitions, calendar, brand voice, approvals (4th source), AI drafting via the AI module. Real DB; AI model mocked. Test data tagged QA_TEST_2026_. */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp, finalizeApp } from "../../server/app/app";
import { disconnectPrisma, prisma } from "../../server/db/prisma";
import { resetDb } from "../helpers/db";
import { AdapterFactory } from "../../server/ai/adapters/adapterFactory";
import { aiQuotaService } from "../../server/services/aiQuotaService";
import type { AiModelAdapter, AiModelCallParams } from "../../server/ai/adapters/types";

const ROLE_KEYS = ["QA_TEST_2026_SOCIAL_PUBLISHER", "QA_TEST_2026_SOCIAL_APPROVER"];

describe("social composer", () => {
  const app = createApp();
  finalizeApp(app);
  let adminToken = "";
  let adminId = "";
  let orgId = "";
  let publisherToken = "";
  let approverToken = "";
  let viewerToken = "";
  let portalToken = "";
  let otherToken = "";
  let accountA = "";
  let accountB = "";
  let otherAccount = "";
  let ip = 120;
  const prompts: AiModelCallParams[] = [];
  let nextAiResponse: (p: AiModelCallParams) => string = () => "{}";

  const call = (method: "get" | "post" | "patch" | "put" | "delete", path: string, token: string, body?: object) => {
    const r = request(app)[method](`/api/v1/social${path}`).set("Authorization", `Bearer ${token}`).set("X-Forwarded-For", `10.4.${Math.floor(ip / 250)}.${ip++ % 250}`);
    return method === "get" || method === "delete" ? r : r.send(body ?? {});
  };
  const api = (method: "get" | "post", path: string, token: string, body?: object) => {
    const r = request(app)[method](`/api/v1${path}`).set("Authorization", `Bearer ${token}`).set("X-Forwarded-For", `10.3.${Math.floor(ip / 250)}.${ip++ % 250}`);
    return method === "post" ? r.send(body ?? {}) : r;
  };
  async function makeUser(email: string, roleKey: string) {
    await api("post", "/users", adminToken, { email, password: "Str0ng-Passphrase-77", firstName: "QA", lastName: roleKey.slice(-8), roleKey });
    return (await request(app).post("/api/v1/auth/login").set("X-Forwarded-For", `10.2.0.${ip++ % 250}`).send({ email, password: "Str0ng-Passphrase-77" })).body.data.session.token as string;
  }
  async function connect(token: string, name: string) {
    const start = await request(app).post("/api/v1/social/accounts/connect/start").set("Authorization", `Bearer ${token}`).set("X-Forwarded-For", `10.1.0.${ip++ % 250}`).send({ provider: "mock" });
    const state = new URL(start.body.data.authUrl).searchParams.get("state")!;
    const cb = await request(app).post("/api/v1/social/accounts/callback").set("Authorization", `Bearer ${token}`).set("X-Forwarded-For", `10.1.0.${ip++ % 250}`).send({ state, code: `mock_${name}` });
    return cb.body.data.account.id as string;
  }
  const newPost = (token: string, over: object = {}) => call("post", "/posts", token, { title: "QA_TEST_2026_ post", body: "Hello from the QA suite", accountIds: [accountA], ...over });

  beforeAll(async () => {
    await resetDb();
    const reg = await request(app).post("/api/v1/auth/register").set("X-Forwarded-For", "10.0.9.1").send({ email: "qa-composer-admin@example.com", password: "Str0ng-Passphrase-77", firstName: "QA", lastName: "Admin", organizationName: "QA_TEST_2026_ Composer" });
    adminToken = reg.body.data.session.token;
    orgId = reg.body.data.user.organizationId;
    adminId = reg.body.data.user.id;

    const perms = async (keys: string[]) => (await prisma.permission.findMany({ where: { key: { in: keys } } })).map((p) => ({ permissionId: p.id }));
    const publisher = await prisma.role.create({ data: { key: ROLE_KEYS[0]!, name: ROLE_KEYS[0]!, isSystem: false } });
    await prisma.rolePermission.createMany({ data: (await perms(["social.read", "social.publish", "approvals.read"])).map((p) => ({ roleId: publisher.id, ...p })) });
    const approver = await prisma.role.create({ data: { key: ROLE_KEYS[1]!, name: ROLE_KEYS[1]!, isSystem: false } });
    await prisma.rolePermission.createMany({ data: (await perms(["social.read", "social.approve", "approvals.read"])).map((p) => ({ roleId: approver.id, ...p })) });

    publisherToken = await makeUser("qa-composer-publisher@example.com", ROLE_KEYS[0]!);
    approverToken = await makeUser("qa-composer-approver@example.com", ROLE_KEYS[1]!);
    viewerToken = await makeUser("qa-composer-viewer@example.com", "VIEWER");
    portalToken = (await request(app).post("/api/v1/auth/portal/register").set("X-Forwarded-For", "10.0.9.2").send({ email: "qa-composer-portal@example.com", password: "Str0ng-Passphrase-77", firstName: "QA", lastName: "Portal", organizationName: "QA_TEST_2026_ Portal" })).body.data.session.token;
    otherToken = (await request(app).post("/api/v1/auth/register").set("X-Forwarded-For", "10.0.9.3").send({ email: "qa-composer-other@example.com", password: "Str0ng-Passphrase-77", firstName: "QA", lastName: "Other", organizationName: "QA_TEST_2026_ Other Composer" })).body.data.session.token;

    accountA = await connect(adminToken, "composer_a");
    accountB = await connect(adminToken, "composer_b");
    otherAccount = await connect(otherToken, "other_acct");

    // The model is mocked; everything else (prompt catalog, executions, usage rows, quota) is the real AI module.
    const fake: AiModelAdapter = {
      providerType: "MOCK",
      async generateText(params) {
        prompts.push(params);
        const text = nextAiResponse(params);
        return { text, inputTokens: 100, outputTokens: 50, totalTokens: 150, durationMs: 5 };
      },
      async generateStructured() {
        return {} as never;
      },
    };
    vi.spyOn(AdapterFactory, "getAdapter").mockReturnValue(fake);
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    const roles = await prisma.role.findMany({ where: { key: { in: ROLE_KEYS } } });
    for (const role of roles) {
      await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
      await prisma.organizationMembership.deleteMany({ where: { roleId: role.id } });
      await prisma.user.deleteMany({ where: { roleId: role.id } });
      await prisma.role.delete({ where: { id: role.id } });
    }
    await disconnectPrisma();
  });

  it("enforces permissions per action", async () => {
    expect((await call("get", "/posts", portalToken)).status).toBe(403);
    expect((await call("get", "/posts", viewerToken)).status).toBe(200);
    expect((await newPost(viewerToken)).status).toBe(403);
    expect((await call("get", "/brand-voice", viewerToken)).status).toBe(200);
    expect((await call("put", "/brand-voice", publisherToken, {})).status).toBe(403);
    expect((await call("post", "/ai/draft", viewerToken, { instruction: "hi there", accountIds: [accountA] })).status).toBe(403);
    expect((await newPost(publisherToken)).status).toBe(201);
    expect((await newPost(approverToken)).status).toBe(403);
  });

  it("creates, reads, edits, lists and soft-deletes a post with audit entries", async () => {
    const created = await newPost(publisherToken, { title: "QA_TEST_2026_ crud", body: "First version of the copy", accountIds: [accountA, accountB], bodyOverrides: { [accountB]: "Override for B" } });
    expect(created.status).toBe(201);
    const post = created.body.data.post;
    expect(post).toMatchObject({ status: "DRAFT", aiGenerated: false });
    expect(post.targets.map((t: { accountId: string }) => t.accountId).sort()).toEqual([accountA, accountB].sort());
    expect(post.guardrailResult.passed).toBe(true);

    const patched = await call("patch", `/posts/${post.id}`, publisherToken, { body: "Second version of the copy", accountIds: [accountA] });
    expect(patched.body.data.post.body).toBe("Second version of the copy");
    expect(patched.body.data.post.targets).toHaveLength(1);

    const listed = await call("get", `/posts?search=crud&accountId=${accountA}`, adminToken);
    expect(listed.body.data.posts.map((p: { id: string }) => p.id)).toContain(post.id);
    expect(listed.body.meta.pagination.total).toBeGreaterThanOrEqual(1);
    expect((await call("get", "/posts?status=PUBLISHED", adminToken)).body.data.posts).toEqual([]);

    expect((await call("delete", `/posts/${post.id}`, publisherToken)).status).toBe(200);
    expect((await call("get", `/posts/${post.id}`, adminToken)).status).toBe(404);
    const actions = (await prisma.auditLog.findMany({ where: { organizationId: orgId, resourceId: post.id } })).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["SOCIAL_POST_CREATED", "SOCIAL_POST_UPDATED", "SOCIAL_POST_DELETED"]));
  });

  it("validates accounts, media and timezone", async () => {
    expect((await newPost(adminToken, { accountIds: [otherAccount] })).status).toBe(400); // another workspace's account
    expect((await newPost(adminToken, { mediaIds: ["00000000-0000-0000-0000-000000000000"] })).status).toBe(400);
    expect((await newPost(adminToken, { timezone: "Mars/Olympus" })).status).toBe(400);
  });

  it("guardrails block submit/schedule until fixed: banned words, disclaimers, length, duplicates", async () => {
    await call("put", "/brand-voice", adminToken, { toneDescriptors: ["friendly"], bannedWords: ["guarantee"], requiredDisclaimers: ["Terms apply."], defaultHashtags: ["artify"], languages: ["en"] });
    const bad = (await newPost(adminToken, { title: "QA_TEST_2026_ guard", body: "We guarantee results" })).body.data.post;
    expect(bad.guardrailResult.passed).toBe(false);
    expect(bad.guardrailResult.issues.map((i: { rule: string }) => i.rule)).toEqual(expect.arrayContaining(["banned_word", "missing_disclaimer"]));
    const blocked = await call("post", `/posts/${bad.id}/submit`, adminToken);
    expect(blocked.status).toBe(400);
    expect(blocked.body.error.message).toMatch(/guardrail/i);

    const fixed = await call("patch", `/posts/${bad.id}`, adminToken, { body: "We deliver results. Terms apply." });
    expect(fixed.body.data.post.guardrailResult.passed).toBe(true);
    const long = (await newPost(adminToken, { title: "QA_TEST_2026_ long", body: "x ".repeat(300) + "Terms apply." })).body.data.post;
    expect(long.guardrailResult.issues.map((i: { rule: string }) => i.rule)).toContain("too_long"); // mock network: 500 chars
    const dupe = (await newPost(adminToken, { title: "QA_TEST_2026_ dup", body: "We deliver results. Terms apply." })).body.data.post;
    expect(dupe.guardrailResult.issues.map((i: { rule: string }) => i.rule)).toContain("duplicate_content");
    expect((await call("post", `/posts/${dupe.id}/submit`, adminToken)).status).toBe(400);
  });

  it("runs the approval lifecycle with valid-transition checks, roles, comments and audit", async () => {
    const post = (await newPost(publisherToken, { title: "QA_TEST_2026_ lifecycle", body: "Lifecycle post one. Terms apply." })).body.data.post;
    const id = post.id as string;
    expect((await call("post", `/posts/${id}/approve`, approverToken)).status).toBe(409); // not submitted yet
    expect((await call("post", `/posts/${id}/schedule`, publisherToken, { scheduledAt: new Date(Date.now() + 86400_000).toISOString() })).status).toBe(409); // not approved
    expect((await call("post", `/posts/${id}/submit`, publisherToken)).body.data.post.status).toBe("PENDING_APPROVAL");
    expect((await call("patch", `/posts/${id}`, publisherToken, { body: "sneaky edit" })).status).toBe(409); // locked while pending

    expect((await call("post", `/posts/${id}/approve`, publisherToken)).status).toBe(403); // publisher can't approve
    expect((await call("post", `/posts/${id}/reject`, approverToken, {})).status).toBe(400); // comment required
    const rejected = await call("post", `/posts/${id}/reject`, approverToken, { comment: "Tone is off" });
    expect(rejected.body.data.post).toMatchObject({ status: "REJECTED", rejectionReason: "Tone is off" });
    expect((await call("post", `/posts/${id}/reopen`, publisherToken)).body.data.post.status).toBe("DRAFT");
    await call("post", `/posts/${id}/submit`, publisherToken);
    expect((await call("post", `/posts/${id}/approve`, approverToken, { comment: "ok" })).body.data.post.status).toBe("APPROVED");

    const past = await call("post", `/posts/${id}/schedule`, publisherToken, { scheduledAt: new Date(Date.now() - 1000).toISOString() });
    expect(past.status).toBe(400);
    const when = new Date(Date.now() + 2 * 86400_000);
    const scheduled = await call("post", `/posts/${id}/schedule`, publisherToken, { scheduledAt: when.toISOString(), timezone: "Europe/London" });
    expect(scheduled.body.data.post).toMatchObject({ status: "SCHEDULED", timezone: "Europe/London" });
    expect(scheduled.body.data.post.targets[0].status).toBe("SCHEDULED");
    expect((await call("post", `/posts/${id}/unschedule`, publisherToken)).body.data.post.status).toBe("APPROVED");
    expect((await call("post", `/posts/${id}/cancel`, publisherToken)).body.data.post.status).toBe("CANCELLED");
    expect((await call("post", `/posts/${id}/submit`, publisherToken)).status).toBe(409); // cancelled can't submit

    const actions = (await prisma.auditLog.findMany({ where: { organizationId: orgId, resourceId: id } })).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["SOCIAL_POST_SUBMITTED", "SOCIAL_POST_REJECTED", "SOCIAL_POST_APPROVED", "SOCIAL_POST_SCHEDULED", "SOCIAL_POST_UNSCHEDULED", "SOCIAL_POST_CANCELLED", "SOCIAL_POST_REOPENED"]));
    // approvers were notified of the submission; the creator was told about the decision
    expect(await prisma.notification.count({ where: { organizationId: orgId, entityId: id, type: "approval_requested" } })).toBeGreaterThan(0);
    expect(await prisma.notification.count({ where: { organizationId: orgId, entityId: id, type: "approval_rejected" } })).toBe(1);
  });

  it("auto-approve mode is admin-only and approves posts that pass guardrails", async () => {
    expect((await call("put", "/settings", publisherToken, { approvalMode: "AUTO_IF_GUARDRAILS_PASS" })).status).toBe(403);
    const mgr = await prisma.role.findUnique({ where: { key: "MANAGER" } });
    expect(mgr).toBeTruthy();
    expect((await call("get", "/settings", adminToken)).body.data.settings.approvalMode).toBe("ALWAYS_REQUIRE");
    expect((await call("put", "/settings", adminToken, { approvalMode: "AUTO_IF_GUARDRAILS_PASS" })).body.data.settings.approvalMode).toBe("AUTO_IF_GUARDRAILS_PASS");

    const ok = (await newPost(publisherToken, { title: "QA_TEST_2026_ auto", body: "Auto approved message here. Terms apply." })).body.data.post;
    expect((await call("post", `/posts/${ok.id}/submit`, publisherToken)).body.data.post.status).toBe("APPROVED");
    const failing = (await newPost(publisherToken, { title: "QA_TEST_2026_ auto bad", body: "We guarantee it. Terms apply." })).body.data.post;
    expect((await call("post", `/posts/${failing.id}/submit`, publisherToken)).status).toBe(400); // guardrails still gate it
    expect(await prisma.auditLog.count({ where: { organizationId: orgId, action: "SOCIAL_APPROVAL_MODE_CHANGED" } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { organizationId: orgId, action: "SOCIAL_POST_AUTO_APPROVED", resourceId: ok.id } })).toBe(1);
    await call("put", "/settings", adminToken, { approvalMode: "ALWAYS_REQUIRE" });
  });

  it("calendar groups scheduled posts by day within a range and supports rescheduling", async () => {
    const post = (await newPost(publisherToken, { title: "QA_TEST_2026_ cal", body: "Calendar post body. Terms apply.", scheduledAt: new Date(Date.UTC(2031, 4, 14, 10)).toISOString() })).body.data.post;
    const cal = await call("get", "/calendar?from=2031-05-01T00:00:00Z&to=2031-06-01T00:00:00Z", adminToken);
    expect(Object.keys(cal.body.data.days)).toEqual(["2031-05-14"]);
    expect(cal.body.data.days["2031-05-14"][0].id).toBe(post.id);
    expect((await call("get", "/calendar?from=2031-05-01T00:00:00Z&to=2032-05-01T00:00:00Z", adminToken)).status).toBe(400); // range too long
    const moved = await call("patch", `/posts/${post.id}/schedule`, publisherToken, { scheduledAt: new Date(Date.UTC(2031, 4, 20, 9)).toISOString() });
    expect(moved.status).toBe(200);
    const after = await call("get", "/calendar?from=2031-05-01T00:00:00Z&to=2031-06-01T00:00:00Z", adminToken);
    expect(Object.keys(after.body.data.days)).toEqual(["2031-05-20"]);
    expect((await call("get", "/calendar?from=2031-05-01T00:00:00Z&to=2031-06-01T00:00:00Z", otherToken)).body.data.total).toBe(0); // workspace scoped
  });

  it("brand voice is per workspace, validated and audited", async () => {
    expect((await call("get", "/brand-voice", otherToken)).body.data.brandVoice.bannedWords).toEqual([]);
    expect((await call("get", "/brand-voice", adminToken)).body.data.brandVoice.defaultHashtags).toEqual(["#artify"]);
    expect((await call("put", "/brand-voice", adminToken, { languages: ["not a language"] })).status).toBe(400);
    expect(await prisma.auditLog.count({ where: { organizationId: orgId, action: "SOCIAL_BRAND_VOICE_UPDATED" } })).toBeGreaterThanOrEqual(1);
  });

  it("is workspace scoped for posts", async () => {
    const post = (await newPost(adminToken, { title: "QA_TEST_2026_ scoped", body: "Scoped post text. Terms apply." })).body.data.post;
    expect((await call("get", `/posts/${post.id}`, otherToken)).status).toBe(404);
    expect((await call("patch", `/posts/${post.id}`, otherToken, { title: "hijack" })).status).toBe(404);
    expect((await call("post", `/posts/${post.id}/submit`, otherToken)).status).toBe(404);
    expect((await call("delete", `/posts/${post.id}`, otherToken)).status).toBe(404);
    expect((await call("get", "/posts", otherToken)).body.data.posts).toEqual([]);
    expect((await call("get", "/constraints", otherToken)).body.data.constraints[accountA]).toBeUndefined();
    expect((await call("get", "/constraints", adminToken)).body.data.constraints[accountA]).toMatchObject({ maxChars: 500 });
  });

  it("shares existing blog posts / case studies: title, excerpt, URL and image come from the CMS", async () => {
    const cms = await prisma.post.create({ data: { organizationId: orgId, slug: "qa-test-2026-launch", title: "QA_TEST_2026_ Launch", status: "PUBLISHED", publishedAt: new Date() } });
    const rev = await prisma.contentRevision.create({ data: { postId: cms.id, version: 1, status: "PUBLISHED", title: cms.title, excerpt: "A short summary of the launch.", body: "<p>Body</p>" } });
    await prisma.post.update({ where: { id: cms.id }, data: { currentRevisionId: rev.id } });
    const list = await call("get", "/content-sources?type=post&search=launch", adminToken);
    expect(list.body.data.items[0]).toMatchObject({ id: cms.id, title: "QA_TEST_2026_ Launch", excerpt: "A short summary of the launch.", url: expect.stringContaining("/blog/qa-test-2026-launch") });
    expect((await call("get", "/content-sources?type=post", otherToken)).body.data.items).toEqual([]);
    const post = await newPost(adminToken, { title: "QA_TEST_2026_ share", body: "Read our launch post. Terms apply.", sourceContent: { type: "post", id: cms.id }, linkUrl: list.body.data.items[0].url });
    expect(post.body.data.post).toMatchObject({ sourceContentType: "post", sourceContentId: cms.id });
    expect((await newPost(adminToken, { sourceContent: { type: "post", id: "00000000-0000-0000-0000-000000000000" } })).status).toBe(404);
  });

  it("approvals center: social is the fourth source (list, summary, decision, audit)", async () => {
    const post = (await newPost(publisherToken, { title: "QA_TEST_2026_ via center", body: "Center approval post body. Terms apply." })).body.data.post;
    await call("post", `/posts/${post.id}/submit`, publisherToken);

    const list = await api("get", "/approvals?status=pending&source=social", approverToken);
    expect(list.status).toBe(200);
    expect(list.body.data.sources).toEqual(["social"]); // the approver role only has social.read
    expect(list.body.data.approvals[0]).toMatchObject({ id: post.id, source: "social", title: "QA_TEST_2026_ via center", canDecide: true, link: `/social/compose?post=${post.id}` });
    const summary = (await api("get", "/approvals/summary", approverToken)).body.data;
    expect(summary.counts.social).toBeGreaterThanOrEqual(1);
    const badges = (await api("get", "/nav/badges", approverToken)).body.data.badges;
    expect(badges.socialApprovals).toBeGreaterThanOrEqual(1);
    expect((await api("get", "/nav/badges", publisherToken)).body.data.badges).not.toHaveProperty("socialApprovals"); // only approvers see the count
    // the publisher can see but not decide
    const asPublisher = await api("get", "/approvals?status=pending&source=social", publisherToken);
    expect(asPublisher.body.data.approvals[0].canDecide).toBe(false);
    expect((await api("post", `/approvals/social/${post.id}/decision`, publisherToken, { decision: "approve" })).status).toBe(403);
    expect((await api("post", `/approvals/social/${post.id}/decision`, approverToken, { decision: "reject" })).status).toBe(400); // comment required
    const done = await api("post", `/approvals/social/${post.id}/decision`, approverToken, { decision: "reject", comment: "Not this week" });
    expect(done.status).toBe(200);
    expect((await prisma.socialPost.findUnique({ where: { id: post.id } }))).toMatchObject({ status: "REJECTED", rejectionReason: "Not this week" });
    expect(await prisma.auditLog.count({ where: { organizationId: orgId, action: "APPROVAL_CENTER_DECISION", resourceType: "social_approval", resourceId: post.id } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { organizationId: orgId, action: "SOCIAL_POST_REJECTED", resourceId: post.id } })).toBe(1);
    const rejected = await api("get", "/approvals?status=rejected&source=social", approverToken);
    expect(rejected.body.data.approvals[0]).toMatchObject({ id: post.id, status: "rejected", decisionComment: "Not this week" });
    // another workspace can't touch it
    expect((await api("post", `/approvals/social/${post.id}/decision`, otherToken, { decision: "approve" })).status).toBe(404);
    // a viewer-level user with no social.approve cannot decide through the center either
    expect((await api("post", `/approvals/social/${post.id}/decision`, viewerToken, { decision: "approve" })).status).toBe(403);
  });

  describe("AI drafting (through the AI module, model mocked)", () => {
    it("draft from brief: registers the prompt, records execution + usage, saves a DRAFT per brand voice, never approves", async () => {
      prompts.length = 0;
      nextAiResponse = () => JSON.stringify({ title: "Spring launch", posts: [{ accountId: accountA, body: "Spring is here! Meet the new Artify. Terms apply." }, { accountId: accountB, body: "Artify spring launch — details inside. Terms apply." }] });
      const res = await call("post", "/ai/draft", publisherToken, { instruction: "Announce our spring launch", accountIds: [accountA, accountB] });
      expect(res.status).toBe(201);
      const post = res.body.data.post;
      expect(post).toMatchObject({ status: "DRAFT", aiGenerated: true, title: "Spring launch" });
      expect(post.aiExecutionId).toBe(res.body.data.executionId);
      expect(post.targets.find((t: { accountId: string }) => t.accountId === accountB).bodyOverride).toBe("Artify spring launch — details inside. Terms apply.");

      // the prompt carries the brand voice and treats user text as data
      expect(prompts[0]!.prompt).toContain("Never use these words: guarantee");
      expect(prompts[0]!.prompt).toContain("<instruction>");
      expect(prompts[0]!.systemInstruction).toMatch(/never publish/i);
      expect(prompts[0]!.responseMimeType).toBe("application/json");

      // AI module artefacts
      const template = await prisma.aIPromptTemplate.findUnique({ where: { organizationId_key: { organizationId: orgId, key: "social.draft_from_brief" } }, include: { currentVersion: true } });
      expect(template).toMatchObject({ status: "ACTIVE" });
      const exec = await prisma.aIExecution.findUnique({ where: { id: post.aiExecutionId }, include: { usageRecords: true } });
      expect(exec).toMatchObject({ status: "COMPLETED", toolCode: "social_draft_from_brief", userId: expect.any(String), promptVersionId: template!.currentVersionId });
      expect(exec!.usageRecords[0]).toMatchObject({ inputTokens: 100, outputTokens: 50, totalTokens: 150 });
      expect(await prisma.auditLog.count({ where: { organizationId: orgId, action: "SOCIAL_POST_CREATED_BY_AI", resourceId: post.id } })).toBe(1);

      // AI posts follow the same approval rules: it can't be scheduled or published without approval
      expect((await call("post", `/posts/${post.id}/schedule`, publisherToken, { scheduledAt: new Date(Date.now() + 86400_000).toISOString() })).status).toBe(409);
    });

    it("guardrails still apply to AI output", async () => {
      nextAiResponse = () => JSON.stringify({ posts: [{ accountId: accountA, body: "We guarantee success" }] });
      const res = await call("post", "/ai/draft", publisherToken, { instruction: "Promise big results", accountIds: [accountA] });
      expect(res.body.data.post.guardrailResult.passed).toBe(false);
      expect((await call("post", `/posts/${res.body.data.post.id}/submit`, publisherToken)).status).toBe(400);
    });

    it("draft from source content links the CMS item", async () => {
      const cms = await prisma.post.findFirst({ where: { organizationId: orgId, slug: "qa-test-2026-launch" } });
      nextAiResponse = (p) => JSON.stringify({ posts: [{ accountId: accountA, body: `New on the blog: ${p.prompt.includes("A short summary of the launch.") ? "the launch recap" : "?"}. Terms apply.` }] });
      const res = await call("post", "/ai/draft", publisherToken, { instruction: "Share this post", accountIds: [accountA], sourceContent: { type: "post", id: cms!.id } });
      expect(res.body.data.post).toMatchObject({ sourceContentType: "post", linkUrl: expect.stringContaining("/blog/qa-test-2026-launch") });
      expect(res.body.data.post.body).toContain("the launch recap");
    });

    it("generate plan: creates a plan and DRAFT posts at future slots linked to it", async () => {
      nextAiResponse = (p) => {
        const count = Number(/exactly (\d+) entries/.exec(p.systemInstruction ?? "")?.[1] ?? 0);
        return JSON.stringify({ posts: Array.from({ length: count }, (_, i) => ({ title: `Plan item ${i + 1}`, body: `Planned message number ${i + 1} about spring. Terms apply.` })) });
      };
      const start = new Date(Date.now() + 86400_000);
      const end = new Date(Date.now() + 15 * 86400_000);
      const res = await call("post", "/ai/plan", publisherToken, { brief: "Spring campaign", accountIds: [accountA], cadencePerWeek: 3, startDate: start.toISOString(), endDate: end.toISOString() });
      expect(res.status).toBe(201);
      const { plan, posts } = res.body.data;
      expect(posts.length).toBeGreaterThanOrEqual(4);
      expect(posts.length).toBeLessThanOrEqual(7);
      for (const p of posts) {
        expect(p).toMatchObject({ status: "DRAFT", aiGenerated: true, planId: plan.id });
        expect(new Date(p.scheduledAt).getTime()).toBeGreaterThan(Date.now());
      }
      expect((await call("get", "/plans", publisherToken)).body.data.plans[0]).toMatchObject({ id: plan.id, postCount: posts.length, brief: "Spring campaign" });
      expect((await call("get", "/plans", otherToken)).body.data.plans).toEqual([]);
      expect((await call("post", "/ai/plan", publisherToken, { brief: "x", accountIds: [accountA], cadencePerWeek: 3, startDate: end.toISOString(), endDate: start.toISOString() })).status).toBe(400);
    });

    it("rewrite / shorten / translate edit only editable drafts and return the previous text for undo", async () => {
      const post = (await newPost(publisherToken, { title: "QA_TEST_2026_ rewrite", body: "A fairly long original announcement text. Terms apply." })).body.data.post;
      nextAiResponse = () => JSON.stringify({ body: "Short version. Terms apply." });
      const short = await call("post", `/posts/${post.id}/ai/rewrite`, publisherToken, { action: "shorten" });
      expect(short.status).toBe(200);
      expect(short.body.data).toMatchObject({ previousBody: "A fairly long original announcement text. Terms apply." });
      expect(short.body.data.post).toMatchObject({ body: "Short version. Terms apply.", aiGenerated: true, status: "DRAFT" });
      expect((await call("post", `/posts/${post.id}/ai/rewrite`, publisherToken, { action: "translate" })).status).toBe(400); // language needed
      nextAiResponse = () => JSON.stringify({ body: "Version courte. Terms apply." });
      expect((await call("post", `/posts/${post.id}/ai/rewrite`, publisherToken, { action: "translate", language: "French", accountId: accountA })).body.data.post.targets[0].bodyOverride).toBe("Version courte. Terms apply.");
      await call("post", `/posts/${post.id}/submit`, publisherToken);
      expect((await call("post", `/posts/${post.id}/ai/rewrite`, publisherToken, { action: "rewrite" })).status).toBe(409); // locked while pending
    });

    it("a garbled model response fails cleanly, is recorded as FAILED, and creates nothing", async () => {
      const before = await prisma.socialPost.count({ where: { organizationId: orgId } });
      nextAiResponse = () => "I am sorry, I cannot do that.";
      const res = await call("post", "/ai/draft", publisherToken, { instruction: "Do the thing", accountIds: [accountA] });
      expect(res.status).toBeGreaterThanOrEqual(500);
      expect(await prisma.socialPost.count({ where: { organizationId: orgId } })).toBe(before);
      const failed = await prisma.aIExecution.findFirst({ where: { organizationId: orgId, status: "FAILED", toolCode: "social_draft_from_brief" } });
      expect(failed).toBeTruthy();
    });

    it("respects the organization's daily AI limits", async () => {
      await aiQuotaService.setLimits(orgId, adminId, { dailyRequests: 1, dailyTokens: 0 });
      nextAiResponse = () => JSON.stringify({ posts: [{ accountId: accountA, body: "Quota test. Terms apply." }] });
      const res = await call("post", "/ai/draft", publisherToken, { instruction: "Quota check", accountIds: [accountA] });
      expect(res.status).toBe(429);
      await aiQuotaService.setLimits(orgId, adminId, { dailyRequests: 0, dailyTokens: 0 });
    });

    it("AI cannot reach another workspace's accounts or posts", async () => {
      nextAiResponse = () => JSON.stringify({ posts: [{ accountId: otherAccount, body: "x" }] });
      expect((await call("post", "/ai/draft", publisherToken, { instruction: "Cross workspace", accountIds: [otherAccount] })).status).toBe(400);
      const post = (await newPost(adminToken, { title: "QA_TEST_2026_ mine", body: "Mine alone. Terms apply." })).body.data.post;
      expect((await call("post", `/posts/${post.id}/ai/rewrite`, otherToken, { action: "rewrite" })).status).toBe(404);
    });
  });
});
