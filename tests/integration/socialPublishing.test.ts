/**
 * Social publishing (Step 6): scheduler, publisher, safety switches, idempotency, retries, operator actions, routes.
 * Real database, mock connector only — no real network. Test data tagged QA_TEST_2026_.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

vi.mock("../../server/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/config/env")>();
  return { ...actual, config: { ...actual.config, cronSecret: "qa-test-cron-secret-0123456789" } };
});
import { config } from "../../server/config/env";
import { createApp, finalizeApp } from "../../server/app/app";
import { disconnectPrisma, prisma } from "../../server/db/prisma";
import { resetDb } from "../helpers/db";
import { publisher, publishingActions } from "../../server/services/social/publishing/publisher";
import { mockPublishLog } from "../../server/services/social/connectors/mockProvider";
import { publishingSettingsService } from "../../server/services/social/publishing/publishingSettingsService";
import { socialAccountService } from "../../server/services/social/socialAccountService";
import { clearNavBadgeCache } from "../../server/services/navBadgeService";
import type { SanitizedUser } from "../../server/types/domain";

const ROLE_KEY = "QA_TEST_2026_SOCIAL_PUB_OPERATOR";
const NO_JITTER = { random: () => 0.5 };
const mutable = config as unknown as Record<string, unknown>;

describe("social publishing", () => {
  const app = createApp();
  finalizeApp(app);
  let adminToken = "";
  let adminId = "";
  let orgId = "";
  let operatorToken = "";
  let viewerToken = "";
  let otherToken = "";
  let account = "";
  let account2 = "";
  let ip = 10;
  let seq = 0;
  let admin: SanitizedUser;

  const hdr = () => `10.6.${Math.floor(ip / 250)}.${ip++ % 250}`;
  const api = (method: "get" | "post" | "put", path: string, token: string, body?: object) => {
    const r = request(app)[method](`/api/v1${path}`).set("Authorization", `Bearer ${token}`).set("X-Forwarded-For", hdr());
    return method === "get" ? r : r.send(body ?? {});
  };
  async function makeUser(email: string, roleKey: string) {
    await api("post", "/users", adminToken, { email, password: "Str0ng-Passphrase-77", firstName: "QA", lastName: "Pub", roleKey });
    return (await request(app).post("/api/v1/auth/login").set("X-Forwarded-For", hdr()).send({ email, password: "Str0ng-Passphrase-77" })).body.data.session.token as string;
  }
  async function connect(token: string, name: string) {
    const start = await api("post", "/social/accounts/connect/start", token, { provider: "mock" });
    const state = new URL(start.body.data.authUrl).searchParams.get("state")!;
    const cb = await api("post", "/social/accounts/callback", token, { state, code: `mock_${name}` });
    return cb.body.data.account.id as string;
  }
  const setGate = async (g: Partial<{ gEnabled: boolean; gDry: boolean; gKill: boolean; wEnabled: boolean; wDry: boolean; wKill: boolean; grace: number; maxAttempts: number }>) => {
    await prisma.socialPublishingGlobal.upsert({ where: { id: "global" }, create: { id: "global", enabled: g.gEnabled ?? false, dryRun: g.gDry ?? false, killSwitch: g.gKill ?? false }, update: { enabled: g.gEnabled ?? false, dryRun: g.gDry ?? false, killSwitch: g.gKill ?? false } });
    const w = { enabled: g.wEnabled ?? false, dryRun: g.wDry ?? false, killSwitch: g.wKill ?? false, graceMinutes: g.grace ?? 60, maxAttempts: g.maxAttempts ?? 5 };
    await prisma.socialPublishingSetting.upsert({ where: { organizationId: orgId }, create: { organizationId: orgId, ...w }, update: w });
  };
  const live = (extra: Parameters<typeof setGate>[0] = {}) => setGate({ gEnabled: true, wEnabled: true, ...extra });

  /** Creates an APPROVED+SCHEDULED post through the real API, then moves its slot into the past so it is due. */
  async function scheduled(body: string, opts: { accountIds?: string[]; minutesAgo?: number } = {}) {
    seq += 1;
    const created = await api("post", "/social/posts", adminToken, { title: `QA_TEST_2026_ publish ${seq}`, body: `${body} (qa-run-${seq}-${Date.now()})`, accountIds: opts.accountIds ?? [account] });
    expect(created.status).toBe(201);
    const id = created.body.data.post.id as string;
    expect((await api("post", `/social/posts/${id}/submit`, adminToken)).status).toBe(200);
    let st = (await prisma.socialPost.findUnique({ where: { id } }))!.status;
    if (st === "PENDING_APPROVAL") expect((await api("post", `/social/posts/${id}/approve`, adminToken, {})).status).toBe(200);
    const sched = await api("post", `/social/posts/${id}/schedule`, adminToken, { scheduledAt: new Date(Date.now() + 3600_000).toISOString(), timezone: "UTC" });
    expect(sched.status).toBe(200);
    const due = new Date(Date.now() - (opts.minutesAgo ?? 1) * 60_000);
    await prisma.socialPost.update({ where: { id }, data: { scheduledAt: due } });
    await prisma.socialPostTarget.updateMany({ where: { postId: id }, data: { scheduledAt: due } });
    const target = (await prisma.socialPostTarget.findFirst({ where: { postId: id, socialAccountId: opts.accountIds?.[0] ?? account } }))!;
    return { postId: id, targetId: target.id };
  }
  const targetOf = (id: string) => prisma.socialPostTarget.findUniqueOrThrow({ where: { id } });
  const postOf = (id: string) => prisma.socialPost.findUniqueOrThrow({ where: { id } });
  const attemptsOf = (id: string) => prisma.socialPublishAttempt.findMany({ where: { targetId: id }, orderBy: { attemptNumber: "asc" } });
  const sentCount = (key: string | null) => mockPublishLog.filter((l) => l.idempotencyKey === key).length;

  beforeAll(async () => {
    await resetDb();
    const reg = await request(app).post("/api/v1/auth/register").set("X-Forwarded-For", "10.0.8.1").send({ email: "qa-pub-admin@example.com", password: "Str0ng-Passphrase-77", firstName: "QA", lastName: "Admin", organizationName: "QA_TEST_2026_ Publishing" });
    adminToken = reg.body.data.session.token;
    orgId = reg.body.data.user.organizationId;
    adminId = reg.body.data.user.id;
    admin = (await request(app).get("/api/v1/auth/me").set("Authorization", `Bearer ${adminToken}`).set("X-Forwarded-For", "10.0.8.9")).body.data.user as SanitizedUser;
    otherToken = (await request(app).post("/api/v1/auth/register").set("X-Forwarded-For", "10.0.8.2").send({ email: "qa-pub-other@example.com", password: "Str0ng-Passphrase-77", firstName: "QA", lastName: "Other", organizationName: "QA_TEST_2026_ Other Publishing" })).body.data.session.token;

    const role = await prisma.role.create({ data: { key: ROLE_KEY, name: ROLE_KEY, isSystem: false } });
    const perms = await prisma.permission.findMany({ where: { key: { in: ["social.read", "social.publish"] } } });
    await prisma.rolePermission.createMany({ data: perms.map((p) => ({ roleId: role.id, permissionId: p.id })) });
    operatorToken = await makeUser("qa-pub-operator@example.com", ROLE_KEY);
    viewerToken = await makeUser("qa-pub-viewer@example.com", "VIEWER");
    account = await connect(adminToken, "pub_a");
    account2 = await connect(adminToken, "pub_b");
  });
  afterAll(async () => {
    await setGate({});
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
    mutable.socialPublishingDisabled = false;
    await setGate({});
    // Leftovers from earlier tests must not occupy scheduler slots in later ones.
    await prisma.socialPostTarget.updateMany({ where: { status: "SCHEDULED", post: { organizationId: orgId } }, data: { status: "CANCELLED" } });
    await prisma.socialAccount.updateMany({ where: { id: { in: [account, account2] } }, data: { status: "CONNECTED", lastError: null, tokenExpiresAt: new Date(Date.now() + 40 * 86400_000) } });
  });

  // ---------- safety switches ----------
  it("publishes nothing by default (global and workspace OFF)", async () => {
    const { targetId } = await scheduled("Default off");
    const key = (await targetOf(targetId)).idempotencyKey;
    const res = await publisher.tick();
    expect(res.outcomes.published).toBe(0);
    expect(res.gate).toBe("global_off");
    expect(await targetOf(targetId)).toMatchObject({ status: "SCHEDULED", attempts: 0 });
    expect(sentCount(key)).toBe(0);
    expect(await attemptsOf(targetId)).toHaveLength(0);
  });

  it("every layer must be on: workspace off, global off, env disabled", async () => {
    const { targetId } = await scheduled("Layers");
    await setGate({ gEnabled: true, wEnabled: false });
    expect((await publisher.publishTarget(targetId)).detail).toBe("workspace_off");
    await setGate({ gEnabled: false, wEnabled: true });
    expect((await publisher.publishTarget(targetId)).detail).toBe("global_off");
    await live();
    mutable.socialPublishingDisabled = true;
    expect((await publisher.publishTarget(targetId)).detail).toBe("env_disabled");
    expect(await targetOf(targetId)).toMatchObject({ status: "SCHEDULED", attempts: 0 });
  });

  it("kill switches (workspace and global) stop publishing before the next attempt", async () => {
    const { targetId } = await scheduled("Kill");
    await live({ wKill: true });
    expect((await publisher.publishTarget(targetId)).detail).toBe("workspace_kill_switch");
    await live({ gKill: true });
    expect((await publisher.publishTarget(targetId)).detail).toBe("global_kill_switch");
    expect(await targetOf(targetId)).toMatchObject({ status: "SCHEDULED", attempts: 0 });
    expect(await attemptsOf(targetId)).toHaveLength(0);
    await live(); // released → publishes
    expect((await publisher.publishTarget(targetId)).outcome).toBe("published");
  });

  it("dry-run does everything except the final network call", async () => {
    const { targetId, postId } = await scheduled("Dry run");
    await live({ wDry: true });
    const before = mockPublishLog.length;
    expect((await publisher.publishTarget(targetId)).outcome).toBe("dry_run");
    expect(mockPublishLog.length).toBe(before); // connector.publish never called
    const attempts = await attemptsOf(targetId);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({ outcome: "DRY_RUN", dryRun: true });
    expect(await targetOf(targetId)).toMatchObject({ status: "FAILED", externalPostId: null });
    expect((await postOf(postId)).status).toBe("FAILED");
    expect(await prisma.auditLog.count({ where: { resourceId: targetId, action: "SOCIAL_PUBLISH_DRY_RUN" } })).toBe(1);
    // Global dry-run alone is enough too.
    const second = await scheduled("Dry run global");
    await live({ gDry: true });
    expect((await publisher.publishTarget(second.targetId)).outcome).toBe("dry_run");
  });

  // ---------- happy path & eligibility ----------
  it("publishes a due approved post once, recording id, url, attempt, audit and post status", async () => {
    const { targetId, postId } = await scheduled("Happy path");
    await live();
    const res = await publisher.tick();
    expect(res.outcomes.published).toBeGreaterThanOrEqual(1);
    const t = await targetOf(targetId);
    expect(t).toMatchObject({ status: "PUBLISHED", attempts: 1, lockedAt: null });
    expect(t.externalPostId).toMatch(/^mockpost_/);
    expect(t.externalUrl).toMatch(/^https:\/\/mock\.example\/posts\//);
    expect((await postOf(postId)).status).toBe("PUBLISHED");
    const [a] = await attemptsOf(targetId);
    expect(a).toMatchObject({ outcome: "SUCCESS", dryRun: false, externalPostId: t.externalPostId });
    expect(await prisma.auditLog.count({ where: { resourceId: targetId, action: "SOCIAL_PUBLISHED" } })).toBe(1);
    // A second tick never re-sends it.
    await publisher.tick();
    expect(sentCount(t.idempotencyKey)).toBe(1);
  });

  it("does not publish a future post, a draft, or an approved-but-unscheduled post", async () => {
    await live();
    const future = await scheduled("Future");
    const when = new Date(Date.now() + 2 * 3600_000);
    await prisma.socialPostTarget.update({ where: { id: future.targetId }, data: { scheduledAt: when } });
    const draft = await api("post", "/social/posts", adminToken, { title: "QA_TEST_2026_ draft", body: `Draft only ${Date.now()}`, accountIds: [account] });
    const draftTarget = (await prisma.socialPostTarget.findFirst({ where: { postId: draft.body.data.post.id } }))!;
    // Even a target forced to SCHEDULED must not publish while its post is not SCHEDULED.
    await prisma.socialPostTarget.update({ where: { id: draftTarget.id }, data: { status: "SCHEDULED", scheduledAt: new Date(Date.now() - 60_000) } });
    const res = await publisher.tick();
    expect(res.outcomes.published).toBe(0);
    expect(await targetOf(future.targetId)).toMatchObject({ status: "SCHEDULED", attempts: 0 });
    expect(await targetOf(draftTarget.id)).toMatchObject({ status: "SCHEDULED", attempts: 0 });
    await prisma.socialPostTarget.update({ where: { id: draftTarget.id }, data: { status: "PENDING" } });
  });

  it("re-checks guardrails at publish time", async () => {
    const { targetId } = await scheduled("Totally fine text");
    await prisma.socialBrandVoice.upsert({ where: { organizationId: orgId }, create: { organizationId: orgId, bannedWords: ["totally"] }, update: { bannedWords: ["totally"] } });
    await live();
    try {
      expect((await publisher.publishTarget(targetId)).outcome).toBe("failed");
      const t = await targetOf(targetId);
      expect(t.status).toBe("FAILED");
      expect(t.publishError).toMatch(/Guardrails no longer pass/);
      expect(sentCount(t.idempotencyKey)).toBe(0);
    } finally {
      await prisma.socialBrandVoice.update({ where: { organizationId: orgId }, data: { bannedWords: [] } });
    }
  });

  // ---------- retries & failures ----------
  it("retries a transient failure with backoff, then succeeds", async () => {
    const { targetId } = await scheduled("Flaky [[transient-once]]");
    await live();
    const now = new Date();
    const first = await publisher.publishTarget(targetId, { now, backoff: NO_JITTER });
    expect(first.outcome).toBe("retry_scheduled");
    const t1 = await targetOf(targetId);
    expect(t1).toMatchObject({ status: "SCHEDULED", attempts: 1 });
    expect(t1.nextAttemptAt!.getTime()).toBeGreaterThan(now.getTime() + 60_000);
    expect((await postOf(t1.postId)).status).toBe("SCHEDULED");
    // Not due yet → not claimed.
    expect((await publisher.publishTarget(targetId, { now: new Date(now.getTime() + 30_000) })).outcome).toBe("not_claimed");
    const later = new Date(now.getTime() + 5 * 60_000);
    expect((await publisher.publishTarget(targetId, { now: later })).outcome).toBe("published");
    const attempts = await attemptsOf(targetId);
    expect(attempts.map((a) => a.outcome)).toEqual(["TRANSIENT_FAILURE", "SUCCESS"]);
    expect(await targetOf(targetId)).toMatchObject({ status: "PUBLISHED", attempts: 2 });
  });

  it("dead-letters a transient failure after max attempts", async () => {
    const { targetId, postId } = await scheduled("Always down [[fail-transient]]");
    await live({ maxAttempts: 2 });
    let now = new Date();
    expect((await publisher.publishTarget(targetId, { now, backoff: NO_JITTER })).outcome).toBe("retry_scheduled");
    now = new Date(now.getTime() + 10 * 60_000);
    expect((await publisher.publishTarget(targetId, { now, backoff: NO_JITTER })).outcome).toBe("failed");
    const t = await targetOf(targetId);
    expect(t).toMatchObject({ status: "FAILED", attempts: 2 });
    expect(t.publishError).toMatch(/^max_attempts:/);
    expect((await postOf(postId)).status).toBe("FAILED");
    expect((await attemptsOf(targetId)).map((a) => a.outcome)).toEqual(["TRANSIENT_FAILURE", "PERMANENT_FAILURE"]);
    expect(await prisma.notification.count({ where: { entityId: postId, type: "social_publish_failed" } })).toBeGreaterThan(0);
  });

  it("fails permanent errors immediately without retrying", async () => {
    const { targetId } = await scheduled("Rejected [[fail-permanent]]");
    await live();
    expect((await publisher.publishTarget(targetId)).outcome).toBe("failed");
    expect(await targetOf(targetId)).toMatchObject({ status: "FAILED", attempts: 1, nextAttemptAt: null });
    expect(await attemptsOf(targetId)).toHaveLength(1);
  });

  it("moves the account to NEEDS_REAUTH on an auth failure and notifies", async () => {
    const { targetId, postId } = await scheduled("Revoked [[fail-auth]]");
    await live();
    expect((await publisher.publishTarget(targetId)).outcome).toBe("reauth");
    expect(await targetOf(targetId)).toMatchObject({ status: "FAILED" });
    expect((await prisma.socialAccount.findUniqueOrThrow({ where: { id: account } })).status).toBe("NEEDS_REAUTH");
    expect((await attemptsOf(targetId))[0]!.outcome).toBe("AUTH_FAILURE");
    expect(await prisma.notification.count({ where: { entityId: postId, type: "social_publish_failed" } })).toBeGreaterThan(0);
    // While the account needs re-auth, nothing is sent for it.
    const next = await scheduled("After revoke");
    expect((await publisher.publishTarget(next.targetId)).outcome).toBe("failed");
    expect(sentCount((await targetOf(next.targetId)).idempotencyKey)).toBe(0);
  });

  it("marks an unknown outcome UNCERTAIN, never retries it automatically, and requires confirmation to retry", async () => {
    const { targetId, postId } = await scheduled("Timeout [[timeout]]");
    await live();
    expect((await publisher.publishTarget(targetId)).outcome).toBe("uncertain");
    const t = await targetOf(targetId);
    expect(t.status).toBe("UNCERTAIN");
    expect((await postOf(postId)).status).toBe("FAILED");
    for (let i = 0; i < 3; i++) await publisher.tick({ now: new Date(Date.now() + (i + 1) * 3600_000) });
    expect(sentCount(t.idempotencyKey)).toBe(1); // never blindly retried
    expect((await attemptsOf(targetId)).map((a) => a.outcome)).toEqual(["UNCERTAIN"]);
    await expect(publishingActions.retryNow(admin, targetId, {})).rejects.toThrow(/NOT on the network/);
    expect(await targetOf(targetId)).toMatchObject({ status: "UNCERTAIN" });
  });

  // ---------- idempotency ----------
  it("concurrent workers publish a target at most once", async () => {
    const { targetId } = await scheduled("Race condition");
    await live();
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => publisher.publishTarget(targetId, { workerId: `w${i}` })));
    expect(results.filter((r) => r.outcome === "published")).toHaveLength(1);
    expect(results.filter((r) => r.outcome === "not_claimed")).toHaveLength(7);
    const t = await targetOf(targetId);
    expect(sentCount(t.idempotencyKey)).toBe(1);
    expect(t).toMatchObject({ status: "PUBLISHED", attempts: 1 });
    expect(await attemptsOf(targetId)).toHaveLength(1);
  });

  it("two parallel ticks never double-send", async () => {
    const a = await scheduled("Parallel tick A");
    const b = await scheduled("Parallel tick B");
    await live();
    await Promise.all([publisher.tick(), publisher.tick(), publisher.tick()]);
    for (const { targetId } of [a, b]) {
      const t = await targetOf(targetId);
      expect(t.status).toBe("PUBLISHED");
      expect(sentCount(t.idempotencyKey)).toBe(1);
    }
  });

  it("recovers a crashed worker's PUBLISHING target as UNCERTAIN (never re-sent)", async () => {
    const { targetId, postId } = await scheduled("Crashed worker");
    await live();
    await prisma.socialPostTarget.update({ where: { id: targetId }, data: { status: "PUBLISHING", lockedAt: new Date(Date.now() - 30 * 60_000), lockedBy: "dead", attempts: 1, idempotencyKey: "art_crashed_key" } });
    await prisma.socialPost.update({ where: { id: postId }, data: { status: "PUBLISHING" } });
    await prisma.socialPublishAttempt.create({ data: { targetId, attemptNumber: 1 } });
    expect(await publisher.recoverStale()).toBeGreaterThanOrEqual(1);
    expect(await targetOf(targetId)).toMatchObject({ status: "UNCERTAIN", lockedAt: null });
    expect((await attemptsOf(targetId))[0]).toMatchObject({ outcome: "UNCERTAIN", errorCategory: "stale" });
    await publisher.tick();
    expect(sentCount("art_crashed_key")).toBe(0);
  });

  it("a fresh PUBLISHING lock is left alone", async () => {
    const { targetId } = await scheduled("Fresh lock");
    await prisma.socialPostTarget.update({ where: { id: targetId }, data: { status: "PUBLISHING", lockedAt: new Date(), lockedBy: "alive" } });
    await publisher.recoverStale();
    expect((await targetOf(targetId)).status).toBe("PUBLISHING");
    await prisma.socialPostTarget.update({ where: { id: targetId }, data: { status: "CANCELLED", lockedAt: null } });
  });

  // ---------- grace window / scheduling ----------
  it("marks late never-attempted targets MISSED instead of publishing them", async () => {
    const late = await scheduled("Way too late", { minutesAgo: 180 });
    const ok = await scheduled("Slightly late", { minutesAgo: 20 });
    await live({ grace: 60 });
    const res = await publisher.tick();
    expect(res.missed).toBeGreaterThanOrEqual(1);
    expect(await targetOf(late.targetId)).toMatchObject({ status: "MISSED", attempts: 0 });
    expect(sentCount((await targetOf(late.targetId)).idempotencyKey)).toBe(0);
    expect((await postOf(late.postId)).status).toBe("FAILED");
    expect((await targetOf(ok.targetId)).status).toBe("PUBLISHED");
  });

  it("respects the per-account limit and batch size within one tick", async () => {
    await live();
    const items = [];
    for (let i = 0; i < 4; i++) items.push(await scheduled(`Fair share ${i}`));
    const res = await publisher.tick({ perAccountLimit: 2, batchSize: 10 });
    expect(res.considered).toBe(2);
    const published = (await prisma.socialPostTarget.count({ where: { id: { in: items.map((i) => i.targetId) }, status: "PUBLISHED" } }));
    expect(published).toBe(2);
    await publisher.tick({ perAccountLimit: 2, batchSize: 10 });
    expect(await prisma.socialPostTarget.count({ where: { id: { in: items.map((i) => i.targetId) }, status: "PUBLISHED" } })).toBe(4);
  });

  it("a multi-account post derives its status from its targets", async () => {
    const { postId } = await scheduled("Two accounts [[x]]", { accountIds: [account, account2] });
    await live();
    await publisher.tick();
    expect((await postOf(postId)).status).toBe("PUBLISHED");
    expect(await prisma.socialPostTarget.count({ where: { postId, status: "PUBLISHED" } })).toBe(2);
  });

  // ---------- post transitions cannot cause a re-send ----------
  it("protects in-flight, uncertain and published targets from user transitions", async () => {
    const { postId, targetId } = await scheduled("Transition guard");
    await prisma.socialPostTarget.update({ where: { id: targetId }, data: { status: "PUBLISHING", lockedAt: new Date() } });
    expect((await api("post", `/social/posts/${postId}/cancel`, adminToken, {})).status).toBe(409);
    await prisma.socialPostTarget.update({ where: { id: targetId }, data: { status: "UNCERTAIN", lockedAt: null } });
    expect((await api("post", `/social/posts/${postId}/cancel`, adminToken, {})).status).toBe(409);
    await prisma.socialPostTarget.update({ where: { id: targetId }, data: { status: "PUBLISHED" } });
    await prisma.socialPost.update({ where: { id: postId }, data: { status: "FAILED" } });
    expect((await api("post", `/social/posts/${postId}/reopen`, adminToken, {})).status).toBe(409);
  });

  // ---------- operator actions ----------
  it("Retry now republishes a failed target and is audited", async () => {
    const { targetId } = await scheduled("Retry me [[fail-permanent]]");
    await live();
    await publisher.publishTarget(targetId);
    expect((await targetOf(targetId)).status).toBe("FAILED");
    await prisma.socialPost.update({ where: { id: (await targetOf(targetId)).postId }, data: { body: `Fixed copy ${Date.now()}` } });
    const out = await publishingActions.retryNow(admin, targetId, {});
    expect(out.result.outcome).toBe("published");
    expect(await targetOf(targetId)).toMatchObject({ status: "PUBLISHED", attempts: 1 });
    expect((await attemptsOf(targetId)).map((a) => a.attemptNumber)).toEqual([1, 2]);
    expect(await prisma.auditLog.count({ where: { resourceId: targetId, action: "SOCIAL_PUBLISH_RETRY_REQUESTED", actorUserId: adminId } })).toBe(1);
  });

  it("Retry now cannot bypass the safety gate", async () => {
    const { targetId } = await scheduled("Gate holds [[fail-permanent]]");
    await live();
    await publisher.publishTarget(targetId);
    await live({ wKill: true });
    const out = await publishingActions.retryNow(admin, targetId, {});
    expect(out.result.outcome).toBe("blocked");
    expect(sentCount((await targetOf(targetId)).idempotencyKey)).toBe(1);
  });

  it("Retry/Reschedule of an UNCERTAIN target needs explicit confirmation", async () => {
    const { targetId } = await scheduled("Maybe posted [[timeout]]");
    await live();
    await publisher.publishTarget(targetId);
    await expect(publishingActions.reschedule(admin, targetId, { scheduledAt: new Date(Date.now() + 3600_000) })).rejects.toThrow(/NOT on the network/);
    await expect(publishingActions.reschedule(admin, targetId, { scheduledAt: new Date(Date.now() - 1000), confirmNotPosted: true })).rejects.toThrow(/future/);
    const moved = await publishingActions.reschedule(admin, targetId, { scheduledAt: new Date(Date.now() + 3600_000), confirmNotPosted: true });
    expect(moved).toMatchObject({ status: "SCHEDULED", attempts: 0 });
  });

  it("Mark as published manually requires an https URL and settles the post", async () => {
    const { targetId, postId } = await scheduled("Manual fix [[timeout]]");
    await live();
    await publisher.publishTarget(targetId);
    await expect(publishingActions.markPublished(admin, targetId, { url: "http://insecure.example" })).rejects.toThrow(/https/);
    const done = await publishingActions.markPublished(admin, targetId, { url: "https://www.linkedin.com/feed/update/urn:li:share:42/" });
    expect(done).toMatchObject({ status: "PUBLISHED", manualResolution: true, externalUrl: "https://www.linkedin.com/feed/update/urn:li:share:42/" });
    expect((await postOf(postId)).status).toBe("PUBLISHED");
    expect(await prisma.auditLog.count({ where: { resourceId: targetId, action: "SOCIAL_PUBLISH_MARKED_MANUALLY" } })).toBe(1);
    await expect(publishingActions.markPublished(admin, targetId, { url: "https://x.example" })).rejects.toThrow(/not available/);
  });

  it("Cancel stops a failed target; cancelling the last one cancels the post", async () => {
    const { targetId, postId } = await scheduled("Cancel me [[fail-permanent]]");
    await live();
    await publisher.publishTarget(targetId);
    await publishingActions.cancel(admin, targetId);
    expect((await targetOf(targetId)).status).toBe("CANCELLED");
    expect((await postOf(postId)).status).toBe("CANCELLED");
  });

  // ---------- routes ----------
  it("exposes queue, failures, target timeline, metrics with permission checks and workspace isolation", async () => {
    await live();
    const fail = await scheduled("Route failure [[fail-permanent]]");
    await publisher.publishTarget(fail.targetId);
    const waiting = await scheduled("Route queue");
    await prisma.socialPostTarget.update({ where: { id: waiting.targetId }, data: { scheduledAt: new Date(Date.now() + 3 * 3600_000) } });

    const queue = await api("get", "/social/publishing/queue", viewerToken);
    expect(queue.status).toBe(200);
    expect(queue.body.data.items.map((i: { id: string }) => i.id)).toContain(waiting.targetId);
    const failures = await api("get", "/social/publishing/failures", viewerToken);
    expect(failures.body.data.items.map((i: { id: string }) => i.id)).toContain(fail.targetId);
    const detail = await api("get", `/social/publishing/targets/${fail.targetId}`, viewerToken);
    expect(detail.body.data.target.attemptLog[0]).toMatchObject({ outcome: "PERMANENT_FAILURE", attemptNumber: 1 });
    expect(JSON.stringify(detail.body)).not.toMatch(/mock_at_|accessToken|refreshToken|ciphertext/);

    const metrics = (await api("get", "/social/publishing/metrics", viewerToken)).body.data.metrics;
    expect(metrics.needsAttention).toBeGreaterThanOrEqual(1);
    expect(metrics.last24h.failed).toBeGreaterThanOrEqual(1);

    expect((await api("post", `/social/publishing/targets/${fail.targetId}/cancel`, viewerToken)).status).toBe(403);
    expect((await api("get", `/social/publishing/targets/${fail.targetId}`, otherToken)).status).toBe(404);
    expect((await api("post", `/social/publishing/targets/${fail.targetId}/cancel`, otherToken)).status).toBe(404);
  });

  it("Failures badge counts for publishers only", async () => {
    clearNavBadgeCache();
    const op = (await api("get", "/nav/badges", operatorToken)).body.data.badges;
    const viewer = (await api("get", "/nav/badges", viewerToken)).body.data.badges;
    expect(op.socialFailures).toBeGreaterThanOrEqual(1);
    expect(viewer.socialFailures).toBeUndefined();
  });

  it("controls: ADMIN edits workspace settings (audited); operator cannot; global is SUPER_ADMIN only", async () => {
    expect((await api("put", "/social/publishing/settings", operatorToken, { enabled: true })).status).toBe(403);
    const view = await api("get", "/social/publishing/settings", viewerToken);
    expect(view.status).toBe(200);
    await prisma.socialPublishingSetting.deleteMany({ where: { organizationId: orgId } });
    expect((await api("get", "/social/publishing/settings", viewerToken)).body.data.workspace).toMatchObject({ enabled: false, dryRun: true, killSwitch: false, graceMinutes: 60 });
    const upd = await api("put", "/social/publishing/settings", adminToken, { enabled: true, dryRun: true, graceMinutes: 30 });
    expect(upd.status).toBe(200);
    expect(upd.body.data.workspace).toMatchObject({ enabled: true, dryRun: true, graceMinutes: 30 });
    const kill = await api("put", "/social/publishing/settings", adminToken, { killSwitch: true });
    expect(kill.body.data.workspace.killSwitch).toBe(true);
    expect(await prisma.auditLog.count({ where: { organizationId: orgId, action: "SOCIAL_PUBLISHING_KILL_SWITCH_ENGAGED" } })).toBe(1);
    expect((await api("put", "/social/publishing/settings", adminToken, { graceMinutes: 1 })).status).toBe(400);
    const globalAttempt = await api("put", "/social/publishing/global", adminToken, { killSwitch: true });
    expect(globalAttempt.status).toBe(admin.role.key === "SUPER_ADMIN" ? 200 : 403); // only SUPER_ADMIN may touch the global switches
    expect((await api("put", "/social/publishing/global", operatorToken, { killSwitch: true })).status).toBe(403);
    await prisma.socialPublishingGlobal.update({ where: { id: "global" }, data: { killSwitch: false, enabled: false } });
  });

  it("global controls: only SUPER_ADMIN may change them, and a global kill switch is audited", async () => {
    const superAdmin = { ...admin, role: { ...admin.role, key: "SUPER_ADMIN" } } as SanitizedUser;
    await expect(publishingSettingsService.updateGlobal({ ...admin, role: { ...admin.role, key: "ADMIN" } } as SanitizedUser, { killSwitch: true })).rejects.toThrow(/super administrator/);
    const view = await publishingSettingsService.updateGlobal(superAdmin, { enabled: true, dryRun: false });
    expect(view.global).toMatchObject({ enabled: true, dryRun: false, killSwitch: false });
    await publishingSettingsService.updateGlobal(superAdmin, { killSwitch: true });
    expect(await prisma.auditLog.count({ where: { action: "SOCIAL_PUBLISHING_GLOBAL_KILL_SWITCH_ENGAGED", organizationId: orgId } })).toBeGreaterThanOrEqual(1);
    expect((await publishingSettingsService.view(orgId)).effective).toMatchObject({ publishing: false, reason: "global_kill_switch" });
  });

  it("the scheduler endpoint is protected by CRON_SECRET", async () => {
    await live();
    const { targetId } = await scheduled("Via endpoint");
    expect((await request(app).get("/api/v1/social/internal/publish-tick").set("X-Forwarded-For", hdr())).status).toBe(401);
    expect((await request(app).get("/api/v1/social/internal/publish-tick").set("Authorization", "Bearer wrong-secret-0123456789").set("X-Forwarded-For", hdr())).status).toBe(401);
    expect((await targetOf(targetId)).status).toBe("SCHEDULED");
    const ok = await request(app).post("/api/v1/social/internal/publish-tick").set("Authorization", `Bearer ${config.cronSecret}`).set("X-Forwarded-For", hdr());
    expect(ok.status).toBe(200);
    expect(ok.body.data.publish.outcomes.published).toBeGreaterThanOrEqual(1);
    expect((await targetOf(targetId)).status).toBe("PUBLISHED");
    mutable.cronSecret = "";
    expect((await request(app).get("/api/v1/social/internal/publish-tick").set("X-Forwarded-For", hdr())).status).toBe(404);
    mutable.cronSecret = "qa-test-cron-secret-0123456789";
  });

  it("never exposes tokens: stored credentials stay encrypted and the loader is server-internal", async () => {
    const list = await api("get", "/social/accounts", adminToken);
    expect(JSON.stringify(list.body)).not.toMatch(/mock_at_|mock_rt_|ciphertext/);
    expect(await socialAccountService.loadTokens(account)).toMatchObject({ accessToken: expect.stringMatching(/^mock_at_/) });
  });
});
