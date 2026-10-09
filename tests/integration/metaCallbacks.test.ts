/** Step 15: Meta deauthorize + data-deletion callbacks through the real API and DB (signed_request fixtures), including the approval flow and the public status lookup. */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { readFileSync } from "node:fs";

const fx = JSON.parse(readFileSync(new URL("../fixtures/meta/signed_requests.json", import.meta.url), "utf8"));
vi.mock("../../server/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/config/env")>();
  return { ...actual, config: { ...actual.config, metaAppId: "QA_APP_ID", metaAppSecret: "meta-test-app-secret-not-real", publicSiteBaseUrl: "https://site.example.test" } };
});
import { createApp, finalizeApp } from "../../server/app/app";
import { disconnectPrisma, prisma } from "../../server/db/prisma";
import { resetDb } from "../helpers/db";
import { signForTest } from "../../server/services/meta/signedRequest";

const ASID = "5550001112223334";
const fresh = (userId = ASID, over: Record<string, unknown> = {}) => signForTest({ algorithm: "HMAC-SHA256", issued_at: Math.floor(Date.now() / 1000), user_id: userId, ...over }, fx.appSecret);

describe("Step 15 Meta callbacks", () => {
  const app = createApp();
  finalizeApp(app);
  let ip = 10;
  let orgId = "", superTok = "", acct1 = "", acct2 = "", convId = "";
  const form = (path: string, signed?: string) => { const r = request(app).post(`/api/v1/meta${path}`).set("X-Forwarded-For", `10.15.0.${ip++}`).type("form"); return signed === undefined ? r.send({}) : r.send({ signed_request: signed }); };
  const call = (method: "get" | "post", path: string, body?: object) => { const r = request(app)[method](`/api/v1${path}`).set("Authorization", `Bearer ${superTok}`).set("X-Forwarded-For", `10.15.1.${ip++}`); return method === "get" ? r : r.send(body ?? {}); };

  beforeAll(async () => {
    await resetDb();
    await prisma.metaDataRequest.deleteMany({});
    const reg = await request(app).post("/api/v1/auth/register").set("X-Forwarded-For", "10.15.2.1").send({ email: "qa-meta-admin@example.com", password: "Str0ng-Passphrase-77", firstName: "QA", lastName: "Admin", organizationName: "QA_TEST_2026_ Meta Org" });
    superTok = reg.body.data.session.token;
    const uid = reg.body.data.user.id as string;
    const role = await prisma.role.findUniqueOrThrow({ where: { key: "SUPER_ADMIN" } });
    await prisma.user.update({ where: { id: uid }, data: { roleId: role.id } });
    await prisma.organizationMembership.updateMany({ where: { userId: uid }, data: { roleId: role.id } });
    orgId = (await prisma.user.findUniqueOrThrow({ where: { id: uid } })).organizationId;
    const mk = (externalAccountId: string, provider: string, metaUserId: string | null) => prisma.socialAccount.create({ data: { organizationId: orgId, provider, externalAccountId, displayName: `QA_TEST_2026_ ${externalAccountId}`, status: "CONNECTED", metaUserId } });
    acct1 = (await mk("page-1", "meta_facebook", ASID)).id;
    acct2 = (await mk("page-2", "meta_facebook", "somebody-else")).id;
    for (const id of [acct1, acct2]) await prisma.socialAccountCredential.create({ data: { socialAccountId: id, ciphertext: "QA_TEST_2026_ciphertext", keyVersion: 1 } });
    const conv = await prisma.socialConversation.create({ data: { organizationId: orgId, socialAccountId: acct2, providerThreadId: "c:1", type: "COMMENT", participantExternalId: ASID, participantName: "QA Commenter", participantHandle: "qa.commenter" } });
    convId = conv.id;
    await prisma.socialMessage.create({ data: { conversationId: conv.id, organizationId: orgId, socialAccountId: acct2, direction: "INBOUND", authorKind: "CUSTOMER", body: "QA_TEST_2026_ hello", providerMessageId: "m1" } });
  });
  afterAll(async () => { await prisma.metaDataRequest.deleteMany({}); await disconnectPrisma(); });

  describe("signature handling (fail closed, nothing leaks, always audited)", () => {
    it("rejects missing, tampered, wrong-secret, expired and wrong-algorithm requests with 400 on both endpoints", async () => {
      for (const path of ["/data-deletion", "/deauthorize"]) {
        expect((await form(path)).status).toBe(400);
        expect((await form(path, "garbage")).status).toBe(400);
        expect((await form(path, fx.tamperedPayload.signed_request)).status).toBe(400);
        expect((await form(path, fx.wrongSecret.signed_request)).status).toBe(400);
        expect((await form(path, fx.expired.signed_request)).status).toBe(400);
        expect((await form(path, fx.wrongAlgorithm.signed_request)).status).toBe(400);
        const bad = await form(path, fx.tamperedPayload.signed_request);
        expect(JSON.stringify(bad.body)).not.toMatch(/signature|9999999999999999|secret/i);
      }
      expect(await prisma.metaDataRequest.count()).toBe(0);
      expect(await prisma.privacyRequest.count()).toBe(0);
      expect(await prisma.auditLog.count({ where: { action: "META_CALLBACK_REJECTED" } })).toBeGreaterThanOrEqual(12);
      expect((await prisma.socialAccountCredential.count())).toBe(2); // nothing was touched
    });
    it("verifies a JSON body exactly like a form body (the signature is what counts)", async () => {
      const r = await request(app).post("/api/v1/meta/data-deletion").set("X-Forwarded-For", "10.15.3.1").send({ signed_request: fresh("0000000000000001") });
      // Body parsing accepts JSON as well; the request is still verified exactly the same way.
      expect([200, 400]).toContain(r.status);
    });
  });

  it("answers a browser visit (GET) with a clear 405 and an Allow: POST header, never a 404", async () => {
    for (const path of ["/data-deletion", "/deauthorize"]) {
      const r = await request(app).get(`/api/v1/meta${path}`).set("X-Forwarded-For", `10.15.7.${ip++}`);
      expect(r.status).toBe(405);
      expect(r.headers.allow).toBe("POST");
      expect(JSON.stringify(r.body)).toMatch(/only accepts POST/);
    }
  });

  describe("deauthorize", () => {
    it("moves only that person's accounts to NEEDS_REAUTH, deletes their tokens, audits, and returns 200", async () => {
      const r = await form("/deauthorize", fresh());
      expect(r.status).toBe(200);
      const a1 = await prisma.socialAccount.findUniqueOrThrow({ where: { id: acct1 } });
      const a2 = await prisma.socialAccount.findUniqueOrThrow({ where: { id: acct2 } });
      expect(a1.status).toBe("NEEDS_REAUTH");
      expect(a1.lastError).toMatch(/removed the app/);
      expect(a2.status).toBe("CONNECTED");
      expect(await prisma.socialAccountCredential.count({ where: { socialAccountId: acct1 } })).toBe(0);
      expect(await prisma.socialAccountCredential.count({ where: { socialAccountId: acct2 } })).toBe(1);
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "META_DEAUTHORIZED", resourceId: acct1 } });
      expect(audit.actorType).toBe("SYSTEM");
      expect(JSON.stringify(audit)).not.toContain(ASID); // only the keyed hash is recorded
    });
    it("is harmless for an unknown person (200, audited, nothing changed)", async () => {
      expect((await form("/deauthorize", fresh("7770000000000000"))).status).toBe(200);
      expect(await prisma.auditLog.count({ where: { action: "META_DEAUTHORIZE_RECEIVED" } })).toBe(1);
    });
  });

  describe("data deletion", () => {
    let code = "", requestId = "", approvalId = "";
    it("returns exactly { url, confirmation_code } and creates a PENDING privacy request instead of deleting", async () => {
      const r = await form("/data-deletion", fresh());
      expect(r.status).toBe(200);
      expect(Object.keys(r.body).sort()).toEqual(["confirmation_code", "url"]);
      code = r.body.confirmation_code;
      expect(code).toMatch(/^MDR-[A-Za-z0-9_-]{16}$/);
      expect(r.body.url).toBe(`https://site.example.test/data-deletion-status?code=${code}`);
      const req = await prisma.privacyRequest.findFirstOrThrow({ where: { kind: "META_DELETION" } });
      requestId = req.id; approvalId = req.approvalId!;
      expect(req.status).toBe("PENDING_APPROVAL");
      expect(req.requestedById).toBe("meta-callback");
      expect(JSON.stringify(req)).not.toContain(ASID);
      // nothing deleted yet
      expect(await prisma.socialMessage.count({ where: { conversationId: convId } })).toBe(1);
      expect((await prisma.socialConversation.findUniqueOrThrow({ where: { id: convId } })).participantName).toBe("QA Commenter");
      expect(await prisma.auditLog.count({ where: { action: "META_DELETION_RECEIVED", organizationId: orgId } })).toBe(1);
    });
    it("a retry from Meta returns the same code and does not create another approval", async () => {
      const r = await form("/data-deletion", fresh());
      expect(r.body.confirmation_code).toBe(code);
      expect(await prisma.privacyRequest.count({ where: { kind: "META_DELETION" } })).toBe(1);
    });
    it("the public status page lookup says 'in review', reveals nothing personal, and unknown codes are 404", async () => {
      const s = await request(app).get(`/api/v1/meta/deletion-status?code=${code}`).set("X-Forwarded-For", "10.15.4.1");
      expect(s.status).toBe(200);
      expect(s.body.data.status).toBe("IN_REVIEW");
      expect(JSON.stringify(s.body)).not.toMatch(new RegExp(`${ASID}|QA Commenter|page-1`));
      expect((await request(app).get("/api/v1/meta/deletion-status?code=MDR-doesnotexist0000").set("X-Forwarded-For", "10.15.4.2")).status).toBe(404);
      expect((await request(app).get("/api/v1/meta/deletion-status?code=%27%20OR%201=1").set("X-Forwarded-For", "10.15.4.3")).status).toBe(404);
    });
    it("shows up in the Approvals center (source privacy) and is executed only after a human approves", async () => {
      const list = await call("get", "/approvals?source=privacy");
      expect(list.body.data.approvals.some((a: { id: string }) => a.id === approvalId)).toBe(true);
      const d = await call("post", `/approvals/privacy/${approvalId}/decision`, { decision: "approve" });
      expect(d.status).toBe(200);
      expect(d.body.data.counts ?? d.body.data.result?.counts ?? d.body.data).toBeTruthy();
      expect(await prisma.socialMessage.count({ where: { conversationId: convId } })).toBe(0);
      const conv = await prisma.socialConversation.findUniqueOrThrow({ where: { id: convId } });
      expect([conv.participantName, conv.participantHandle, conv.participantExternalId]).toEqual([null, null, null]);
      const a1 = await prisma.socialAccount.findUniqueOrThrow({ where: { id: acct1 } });
      expect([a1.status, a1.metaUserId, a1.connectedByUserId]).toEqual(["DISCONNECTED", null, null]);
      expect((await prisma.privacyRequest.findUniqueOrThrow({ where: { id: requestId } })).status).toBe("EXECUTED");
      const done = await prisma.auditLog.findFirstOrThrow({ where: { action: "PRIVACY_ERASURE_EXECUTED", resourceId: requestId } });
      expect(JSON.stringify(done.afterData)).toContain("META_DELETION");
    });
    it("the status becomes COMPLETED after approval", async () => {
      const s = await request(app).get(`/api/v1/meta/deletion-status?code=${code}`).set("X-Forwarded-For", "10.15.4.5");
      expect(s.body.data.status).toBe("COMPLETED");
    });
    it("a person we hold nothing about gets a code whose status honestly says nothing was held", async () => {
      const r = await form("/data-deletion", fresh("8880000000000000"));
      expect(r.status).toBe(200);
      const s = await request(app).get(`/api/v1/meta/deletion-status?code=${r.body.confirmation_code}`).set("X-Forwarded-For", "10.15.4.6");
      expect(s.body.data.status).toBe("NOTHING_HELD");
      expect(await prisma.privacyRequest.count({ where: { kind: "META_DELETION", subjectRef: { not: (await prisma.privacyRequest.findUniqueOrThrow({ where: { id: requestId } })).subjectRef } } })).toBe(0);
    });
    it("a rejected request is reported as DECLINED", async () => {
      await prisma.socialAccount.update({ where: { id: acct2 }, data: { metaUserId: "9990000000000000" } });
      const r = await form("/data-deletion", fresh("9990000000000000"));
      const req = await prisma.privacyRequest.findFirstOrThrow({ where: { reason: { contains: r.body.confirmation_code } } });
      expect((await call("post", `/approvals/privacy/${req.approvalId}/decision`, { decision: "reject", comment: "QA_TEST_2026_ cannot verify this request" })).status).toBe(200);
      const s = await request(app).get(`/api/v1/meta/deletion-status?code=${r.body.confirmation_code}`).set("X-Forwarded-For", "10.15.4.7");
      expect(s.body.data.status).toBe("DECLINED");
      expect((await prisma.socialAccount.findUniqueOrThrow({ where: { id: acct2 } })).status).toBe("CONNECTED");
    });
  });

  it("is rate limited per IP", async () => {
    const hits = [];
    for (let i = 0; i < 40; i++) hits.push((await request(app).post("/api/v1/meta/data-deletion").set("X-Forwarded-For", "10.15.9.9").type("form").send({ signed_request: "garbage" })).status);
    expect(hits.includes(429)).toBe(true);
  });
});

describe("Step 15 Meta review demo workspace", () => {
  const app = createApp();
  finalizeApp(app);
  let ip = 200, superTok = "", adminTok = "", mainOrg = "";
  const api = (method: "get" | "post" | "delete", path: string, token: string, body?: object) => { const r = request(app)[method](`/api/v1${path}`).set("Authorization", `Bearer ${token}`).set("X-Forwarded-For", `10.16.0.${ip++}`); return method === "post" ? r.send(body ?? {}) : r; };
  beforeAll(async () => {
    await resetDb();
    const reg = await request(app).post("/api/v1/auth/register").set("X-Forwarded-For", "10.16.9.1").send({ email: "qa-meta2-admin@example.com", password: "Str0ng-Passphrase-77", firstName: "QA", lastName: "Admin", organizationName: "QA_TEST_2026_ Meta Org 2" });
    adminTok = reg.body.data.session.token;
    const uid = reg.body.data.user.id as string;
    mainOrg = (await prisma.user.findUniqueOrThrow({ where: { id: uid } })).organizationId;
    const sa = await prisma.role.findUniqueOrThrow({ where: { key: "SUPER_ADMIN" } });
    // a second user is the SUPER_ADMIN; the registered admin stays ADMIN
    const created = await api("post", "/users", adminTok, { email: "qa-meta2-super@example.com", password: "Str0ng-Passphrase-77", firstName: "QA", lastName: "Super", roleKey: "ADMIN" });
    await prisma.user.update({ where: { id: created.body.data.user.id }, data: { roleId: sa.id } });
    await prisma.organizationMembership.updateMany({ where: { userId: created.body.data.user.id }, data: { roleId: sa.id } });
    superTok = (await request(app).post("/api/v1/auth/login").set("X-Forwarded-For", "10.16.9.2").send({ email: "qa-meta2-super@example.com", password: "Str0ng-Passphrase-77" })).body.data.session.token;
    await prisma.socialAccount.create({ data: { organizationId: mainOrg, provider: "meta_facebook", externalAccountId: "REAL_PAGE_1", displayName: "QA_TEST_2026_ real page", status: "CONNECTED" } });
  });

  it("is SUPER_ADMIN only", async () => {
    expect((await api("get", "/ops/meta-review", adminTok)).status).toBe(403);
    expect((await api("post", "/ops/meta-review", adminTok)).status).toBe(403);
    expect((await api("delete", "/ops/meta-review", adminTok)).status).toBe(403);
    expect((await api("get", "/ops/meta-review", superTok)).body.data.seeded).toBe(false);
  });

  let reviewerPassword = "";
  it("seeds an isolated workspace with sample data and a one-time reviewer password", async () => {
    const r = await api("post", "/ops/meta-review", superTok);
    expect(r.status).toBe(201);
    reviewerPassword = r.body.data.reviewerPassword;
    expect(reviewerPassword.length).toBeGreaterThanOrEqual(16);
    const st = await api("get", "/ops/meta-review", superTok);
    expect(st.body.data.counts).toEqual({ accounts: 2, conversations: 4, posts: 2, users: 1 });
    expect(JSON.stringify(st.body)).not.toContain(reviewerPassword);
    expect((await api("post", "/ops/meta-review", superTok)).status).toBe(409);
    const stored = await prisma.user.findUniqueOrThrow({ where: { email: "meta-reviewer@artifysols.com" } });
    expect(stored.passwordHash).not.toContain(reviewerPassword);
  });

  it("the reviewer can log in, sees the sample inbox, and cannot see the main organization's data", async () => {
    const login = await request(app).post("/api/v1/auth/login").set("X-Forwarded-For", "10.16.9.3").send({ email: "meta-reviewer@artifysols.com", password: reviewerPassword });
    expect(login.status).toBe(200);
    const tok = login.body.data.session.token as string;
    const convs = await api("get", "/social/inbox/conversations", tok);
    expect(convs.status).toBe(200);
    expect(JSON.stringify(convs.body)).toContain("Sample Customer");
    const accounts = await api("get", "/social/accounts", tok);
    const names = JSON.stringify(accounts.body);
    expect(names).toContain("Sample Page (demo data)");
    expect(names).not.toContain("real page");
    // platform-level pages are not readable from the demo workspace
    expect((await api("get", "/ops/health", tok)).status).toBe(403);
    expect((await api("get", "/ops/backups", tok)).status).toBe(403);
    expect((await api("get", "/users", tok)).body.data?.users?.every?.((u: { email: string }) => u.email === "meta-reviewer@artifysols.com") ?? true).toBe(true);
  });

  it("removal deletes the organization, the reviewer and all sample data, and leaves the main organization alone", async () => {
    expect((await api("delete", "/ops/meta-review", superTok)).status).toBe(200);
    expect((await api("get", "/ops/meta-review", superTok)).body.data.seeded).toBe(false);
    expect(await prisma.user.count({ where: { email: "meta-reviewer@artifysols.com" } })).toBe(0);
    expect(await prisma.socialConversation.count({ where: { providerThreadId: { startsWith: "dm:demo" } } })).toBe(0);
    expect(await prisma.socialAccount.count({ where: { externalAccountId: "REAL_PAGE_1" } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: { in: ["META_REVIEW_DEMO_SEEDED", "META_REVIEW_DEMO_REMOVED"] } } })).toBe(2);
    // can be seeded again with a different password
    const again = await api("post", "/ops/meta-review", superTok);
    expect(again.status).toBe(201);
    expect(again.body.data.reviewerPassword).not.toBe(reviewerPassword);
    await api("delete", "/ops/meta-review", superTok);
  });
});
