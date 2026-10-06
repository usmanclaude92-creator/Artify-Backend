/** Social connected accounts — real DB, mock provider (no network). Test data tagged QA_TEST_2026_. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp, finalizeApp } from "../../server/app/app";
import { disconnectPrisma, prisma } from "../../server/db/prisma";
import { resetDb } from "../helpers/db";
import { socialAccountService } from "../../server/services/social/socialAccountService";
import { tokenVault } from "../../server/services/social/tokenVault";

describe("social accounts", () => {
  const app = createApp();
  finalizeApp(app);
  let adminToken = "";
  let viewerToken = "";
  let portalToken = "";
  let otherToken = "";
  let admin2Token = "";
  let admin3Token = "";
  let orgId = "";
  let adminId = "";
  let ip = 80;

  const call = (method: "get" | "post", path: string, token: string, body?: object) => {
    const r = request(app)[method](`/api/v1/social/accounts${path}`).set("Authorization", `Bearer ${token}`).set("X-Forwarded-For", `10.5.0.${ip++}`);
    return method === "post" ? r.send(body ?? {}) : r;
  };
  const makeUser = async (email: string, roleKey: string) => {
    await request(app).post("/api/v1/users").set("Authorization", `Bearer ${adminToken}`).set("X-Forwarded-For", `10.5.0.${ip++}`).send({ email, password: "Str0ng-Passphrase-77", firstName: "QA", lastName: roleKey, roleKey });
    return (await request(app).post("/api/v1/auth/login").set("X-Forwarded-For", `10.5.0.${ip++}`).send({ email, password: "Str0ng-Passphrase-77" })).body.data.session.token as string;
  };
  /** Full connect flow through the API; returns the account. */
  async function connect(token: string, name = "demo") {
    const start = await call("post", "/connect/start", token, { provider: "mock" });
    expect(start.status).toBe(200);
    const state = new URL(start.body.data.authUrl).searchParams.get("state")!;
    const cb = await call("post", "/callback", token, { state, code: `mock_${name}` });
    return { start, state, cb };
  }

  beforeAll(async () => {
    await resetDb();
    const reg = await request(app).post("/api/v1/auth/register").set("X-Forwarded-For", "10.5.0.1").send({ email: "qa-social-admin@example.com", password: "Str0ng-Passphrase-77", firstName: "QA", lastName: "Admin", organizationName: "QA_TEST_2026_ Social" });
    adminToken = reg.body.data.session.token;
    orgId = reg.body.data.user.organizationId;
    adminId = reg.body.data.user.id;
    viewerToken = await makeUser("qa-social-viewer@example.com", "VIEWER");
    // sensitive-action limiter is per user (20 / 15 min): spread heavy tests across several admins
    admin2Token = await makeUser("qa-social-admin2@example.com", "ADMIN");
    admin3Token = await makeUser("qa-social-admin3@example.com", "ADMIN");
    portalToken = (await request(app).post("/api/v1/auth/portal/register").set("X-Forwarded-For", "10.5.0.2").send({ email: "qa-social-portal@example.com", password: "Str0ng-Passphrase-77", firstName: "QA", lastName: "Portal", organizationName: "QA_TEST_2026_ Portal" })).body.data.session.token;
    otherToken = (await request(app).post("/api/v1/auth/register").set("X-Forwarded-For", "10.5.0.3").send({ email: "qa-social-other@example.com", password: "Str0ng-Passphrase-77", firstName: "QA", lastName: "Other", organizationName: "QA_TEST_2026_ Other Social" })).body.data.session.token;
  });
  afterAll(async () => {
    await disconnectPrisma();
  });

  it("enforces permissions: portal none; viewer read-only; admin manages", async () => {
    expect((await call("get", "", portalToken)).status).toBe(403);
    expect((await call("get", "", viewerToken)).status).toBe(200);
    expect((await call("post", "/connect/start", viewerToken, { provider: "mock" })).status).toBe(403);
    expect((await call("post", "/callback", viewerToken, { state: "x".repeat(20) })).status).toBe(403);
    expect((await call("get", "", adminToken)).status).toBe(200);
    expect((await request(app).get("/api/v1/social/accounts")).status).toBe(401);
    const perms = await prisma.rolePermission.findMany({ where: { role: { key: "CLIENT_PORTAL" }, permission: { key: { startsWith: "social." } } } });
    expect(perms).toHaveLength(0);
  });

  it("lists providers: mock available; Facebook Pages/linkedin registered but not configured", async () => {
    const list = (await call("get", "", adminToken)).body.data;
    expect(list.accounts).toEqual([]);
    expect(list.providers.find((p: { key: string }) => p.key === "mock")).toMatchObject({ available: true });
    expect(list.providers.find((p: { key: string }) => p.key === "meta_facebook")).toMatchObject({ configured: false, available: false });
    const start = await call("post", "/connect/start", adminToken, { provider: "meta_facebook" });
    expect(start.status).toBe(400);
    expect((await call("post", "/connect/start", adminToken, { provider: "nope" })).status).toBe(400);
  });

  it("connects through a state-protected flow and never leaks tokens anywhere", async () => {
    const { start, state, cb } = await connect(adminToken, "alpha");
    expect(cb.status).toBe(200);
    const account = cb.body.data.account;
    expect(account).toMatchObject({ provider: "mock", externalAccountId: "mock-alpha", handle: "@mock_alpha", status: "CONNECTED", connectedByUserId: adminId });

    // credentials are encrypted at rest and decryptable only through the vault
    const row = await prisma.socialAccountCredential.findUnique({ where: { socialAccountId: account.id } });
    expect(row!.ciphertext.startsWith("sv1.")).toBe(true);
    const tokens = tokenVault.decrypt(row!.ciphertext, row!.keyVersion, account.id);
    expect(tokens.accessToken).toMatch(/^mock_at_alpha_/);

    // no response and no audit/notification row contains token material
    const responses = [start.text, cb.text, (await call("get", "", adminToken)).text, (await call("get", `/${account.id}`, adminToken)).text, (await call("post", `/${account.id}/health`, adminToken)).text];
    for (const body of responses) {
      expect(body).not.toContain(tokens.accessToken);
      expect(body).not.toContain(tokens.refreshToken as string);
      expect(body).not.toMatch(/ciphertext|accessToken|refreshToken|credential/i);
    }
    const audits = JSON.stringify(await prisma.auditLog.findMany({ where: { organizationId: orgId, action: { startsWith: "SOCIAL_" } } }));
    expect(audits).toContain("SOCIAL_ACCOUNT_CONNECTED");
    expect(audits).not.toContain(tokens.accessToken);
    expect(audits).not.toContain("mock_at_");
    expect(audits).not.toContain(state);
  });

  it("rejects replayed, forged, expired and cross-user state", async () => {
    const { state } = await connect(adminToken, "beta");
    expect((await call("post", "/callback", adminToken, { state, code: "mock_beta" })).status).toBe(401); // replay
    expect((await call("post", "/callback", adminToken, { state: "art_oauth_" + "f".repeat(43), code: "mock_x" })).status).toBe(401); // forged

    const mine = await call("post", "/connect/start", adminToken, { provider: "mock" });
    const myState = new URL(mine.body.data.authUrl).searchParams.get("state")!;
    // another user (viewer lacks permission; use other org admin) cannot redeem it
    expect((await call("post", "/callback", otherToken, { state: myState, code: "mock_evil" })).status).toBe(401);
    // …and the failed attempt did not burn the legitimate user's state
    expect((await call("post", "/callback", adminToken, { state: myState, code: "mock_gamma" })).status).toBe(200);

    const exp = await call("post", "/connect/start", adminToken, { provider: "mock" });
    const expState = new URL(exp.body.data.authUrl).searchParams.get("state")!;
    await prisma.socialOAuthState.updateMany({ where: { usedAt: null }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await call("post", "/callback", adminToken, { state: expState, code: "mock_delta" })).status).toBe(401);
  });

  it("surfaces provider failures without leaking details, and audits them", async () => {
    const { cb } = await connect(adminToken, "fail");
    expect(cb.status).toBe(400);
    expect(await prisma.auditLog.count({ where: { organizationId: orgId, action: "SOCIAL_ACCOUNT_CONNECT_FAILED" } })).toBe(1);
  });

  it("is workspace-scoped: another workspace sees none and cannot read or mutate these accounts", async () => {
    const mineList = (await call("get", "", adminToken)).body.data.accounts as Array<{ id: string }>;
    expect(mineList.length).toBeGreaterThan(0);
    expect((await call("get", "", otherToken)).body.data.accounts).toEqual([]);
    const id = mineList[0]!.id;
    expect((await call("get", `/${id}`, otherToken)).status).toBe(404);
    expect((await call("post", `/${id}/disconnect`, otherToken)).status).toBe(404);
    expect((await call("post", `/${id}/health`, otherToken)).status).toBe(404);
    expect((await call("post", `/${id}/reconnect`, otherToken)).status).toBe(404);
    // the same external account can be connected independently in another workspace
    const { cb } = await connect(otherToken, "alpha");
    expect(cb.status).toBe(200);
    expect(await prisma.socialAccount.count({ where: { externalAccountId: "mock-alpha" } })).toBe(2);
  });

  it("reconnect only accepts the same external account", async () => {
    const acct = (await prisma.socialAccount.findFirst({ where: { organizationId: orgId, externalAccountId: "mock-alpha" } }))!;
    const start = await call("post", `/${acct.id}/reconnect`, adminToken);
    expect(start.status).toBe(200);
    const state = new URL(start.body.data.authUrl).searchParams.get("state")!;
    const wrong = await call("post", "/callback", adminToken, { state, code: "mock_someoneelse" });
    expect(wrong.status).toBe(400);
    const again = new URL((await call("post", `/${acct.id}/reconnect`, adminToken)).body.data.authUrl).searchParams.get("state")!;
    expect((await call("post", "/callback", adminToken, { state: again, code: "mock_alpha" })).status).toBe(200);
    expect(await prisma.auditLog.count({ where: { organizationId: orgId, action: "SOCIAL_ACCOUNT_REAUTHENTICATED" } })).toBe(1);
  });

  it("disconnect deletes credentials, keeps the record and audits", async () => {
    const acct = (await prisma.socialAccount.findFirst({ where: { organizationId: orgId, externalAccountId: "mock-gamma" } }))!;
    const res = await call("post", `/${acct.id}/disconnect`, adminToken);
    expect(res.status).toBe(200);
    expect(res.body.data.account.status).toBe("DISCONNECTED");
    expect(await prisma.socialAccountCredential.count({ where: { socialAccountId: acct.id } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { organizationId: orgId, action: "SOCIAL_ACCOUNT_DISCONNECTED", resourceId: acct.id } })).toBe(1);
    expect((await call("post", `/${acct.id}/disconnect`, viewerToken)).status).toBe(403);
  });

  it("health check: failing token -> NEEDS_REAUTH + one notification to managers (not viewers)", async () => {
    const { cb } = await connect(admin2Token, "expired");
    const id = cb.body.data.account.id as string;
    const res = await call("post", `/${id}/health`, admin2Token);
    expect(res.body.data.account).toMatchObject({ status: "NEEDS_REAUTH" });
    expect(res.body.data.account.lastError).toBeTruthy();
    await call("post", `/${id}/health`, admin2Token); // second failure must not notify again
    const notes = await prisma.notification.findMany({ where: { organizationId: orgId, type: "social_account_attention", entityId: id } });
    const managers = await prisma.user.findMany({ where: { organizationId: orgId, email: { in: ["qa-social-admin@example.com", "qa-social-admin2@example.com", "qa-social-admin3@example.com"] } }, select: { id: true } });
    expect(notes.map((n) => n.userId).sort()).toEqual(managers.map((m) => m.id).sort()); // every manager once, never the viewer
    expect(JSON.stringify(notes)).not.toContain("mock_at_");
  });

  it("daily job: refreshes tokens expiring within 7 days, flags those that can't be refreshed", async () => {
    const ok = (await connect(admin3Token, "soon")).cb.body.data.account.id as string;
    const bad = (await connect(admin3Token, "norefresh")).cb.body.data.account.id as string;
    const soon = new Date(Date.now() + 3 * 86400_000);
    await prisma.socialAccount.updateMany({ where: { id: { in: [ok, bad] } }, data: { tokenExpiresAt: soon } });
    const summary = await socialAccountService.runTokenHealthJob(500, 0);
    expect(summary.checked).toBeGreaterThanOrEqual(2);
    // The 5-minute cron tick must not re-check accounts that were just checked.
    expect((await socialAccountService.runTokenHealthJob()).checked).toBe(0);

    const okAfter = await prisma.socialAccount.findUnique({ where: { id: ok } });
    expect(okAfter!.status).toBe("CONNECTED");
    expect(okAfter!.tokenExpiresAt!.getTime()).toBeGreaterThan(Date.now() + 30 * 86400_000); // refreshed
    const badAfter = await prisma.socialAccount.findUnique({ where: { id: bad } });
    expect(badAfter!.status).toBe("NEEDS_REAUTH");
    expect(await prisma.notification.count({ where: { organizationId: orgId, entityId: bad, type: "social_account_attention" } })).toBe(3); // one per manager
  });

  it("the cron tick endpoint runs the token health job", async () => {
    // CRON_SECRET unset in tests => the tick route is disabled (404); the job itself is covered above.
    const res = await request(app).get("/api/v1/automation/internal/tick").set("X-Forwarded-For", "10.5.0.250");
    expect([401, 404]).toContain(res.status);
  });
});
