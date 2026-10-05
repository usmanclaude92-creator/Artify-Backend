/**
 * Phase 17 — Administration, Security & Integrations: RBAC, tenant isolation,
 * credential protection, outbound-webhook signing/SSRF/retries, API keys,
 * session revocation, role management and audit coverage.
 */
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp, finalizeApp } from "../../server/app/app";
import { disconnectPrisma, prisma } from "../../server/db/prisma";
import { signHmac } from "../../server/utils/crypto";
import { EventEngine } from "../../server/services/automation/EventEngine";
import { webhookEndpointService } from "../../server/services/admin/webhookEndpointService";
import { resetDb } from "../helpers/db";

interface Received {
  headers: IncomingMessage["headers"];
  body: string;
}

describe("Phase 17 — administration, security & integrations", () => {
  const app = createApp();
  finalizeApp(app);

  const received: Received[] = [];
  let receiverStatus = 200;
  let receiver: Server;
  let receiverUrl: string;

  const createdRoleIds: string[] = [];
  let seq = 0;

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function registerOrg(label: string) {
    const email = `${label}-${++seq}@example.com`;
    const reg = await request(app).post("/api/v1/auth/register").send({
      email, password: "OriginalPassword123", firstName: label, lastName: "Admin", organizationName: `${label} Org ${seq}`,
    });
    return { token: reg.body.data.session.token as string, userId: reg.body.data.user.id as string, orgId: reg.body.data.user.organizationId as string, email };
  }

  async function promoteToSuperAdmin(userId: string, orgId: string) {
    const role = await prisma.role.findUniqueOrThrow({ where: { key: "SUPER_ADMIN" } });
    await prisma.user.update({ where: { id: userId }, data: { roleId: role.id } });
    await prisma.organizationMembership.updateMany({ where: { userId, organizationId: orgId }, data: { roleId: role.id } });
  }

  /** A fresh SUPER_ADMIN in a fresh org — also gives each section its own per-user rate-limit bucket. */
  async function superAdmin(label = "super") {
    const o = await registerOrg(label);
    await promoteToSuperAdmin(o.userId, o.orgId);
    return o;
  }

  async function addUser(adminToken: string, roleKey: string, label: string) {
    const email = `${label}-${++seq}@example.com`;
    const created = await request(app).post("/api/v1/users").set(auth(adminToken))
      .send({ email, password: "MemberPassword123", firstName: label, lastName: "Member", roleKey });
    expect(created.status).toBe(201);
    const login = await request(app).post("/api/v1/auth/login").send({ email, password: "MemberPassword123" });
    return { id: created.body.data.user.id as string, token: login.body.data.session.token as string, email };
  }

  /** Custom roles are reference data resetDb() deliberately leaves alone — remove any this file (or an aborted earlier run) created. */
  async function removeCustomRoles() {
    await resetDb();
    const custom = await prisma.role.findMany({ where: { isSystem: false }, select: { id: true } });
    for (const { id } of custom) {
      await prisma.rolePermission.deleteMany({ where: { roleId: id } });
      await prisma.role.delete({ where: { id } });
    }
  }

  beforeAll(async () => {
    await removeCustomRoles();
    receiver = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        received.push({ headers: req.headers, body: Buffer.concat(chunks).toString() });
        res.statusCode = receiverStatus;
        res.end("ok");
      });
    }).listen(0, "127.0.0.1");
    await new Promise((r) => receiver.once("listening", r));
    receiverUrl = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}/hook`;
  });

  afterAll(async () => {
    receiver.close();
    await removeCustomRoles();
    await disconnectPrisma();
  });

  describe("authentication and RBAC", () => {
    it("rejects unauthenticated access to every Phase 17 endpoint", async () => {
      const calls = [
        request(app).get("/api/v1/admin/overview"),
        request(app).get("/api/v1/admin/security/policy"),
        request(app).get("/api/v1/admin/sessions"),
        request(app).get("/api/v1/integrations"),
        request(app).get("/api/v1/webhook-endpoints"),
        request(app).get("/api/v1/api-keys"),
        request(app).get("/api/v1/audit-logs/facets"),
        request(app).post("/api/v1/roles").send({}),
      ];
      for (const res of await Promise.all(calls)) expect(res.status).toBe(401);
    });

    it("blocks a VIEWER from every admin surface", async () => {
      const admin = await registerOrg("viewerorg");
      const viewer = await addUser(admin.token, "VIEWER", "viewer");
      for (const path of ["/admin/overview", "/integrations", "/webhook-endpoints", "/api-keys", "/admin/security/events"]) {
        expect((await request(app).get(`/api/v1${path}`).set(auth(viewer.token))).status).toBe(403);
      }
    });

    it("gives ADMIN read access but not manage access to credentials and integrations", async () => {
      const admin = await registerOrg("adminorg");
      expect((await request(app).get("/api/v1/admin/overview").set(auth(admin.token))).status).toBe(200);
      expect((await request(app).get("/api/v1/integrations").set(auth(admin.token))).status).toBe(200);
      expect((await request(app).get("/api/v1/webhook-endpoints").set(auth(admin.token))).status).toBe(200);
      expect((await request(app).get("/api/v1/api-keys").set(auth(admin.token))).status).toBe(200);

      expect((await request(app).put("/api/v1/integrations/custom_api").set(auth(admin.token)).send({ enabled: false })).status).toBe(403);
      expect((await request(app).post("/api/v1/webhook-endpoints").set(auth(admin.token)).send({ name: "x", url: receiverUrl, events: ["*"] })).status).toBe(403);
      expect((await request(app).post("/api/v1/api-keys").set(auth(admin.token)).send({ name: "x", scopes: ["leads.read"] })).status).toBe(403);
      expect((await request(app).post("/api/v1/roles").set(auth(admin.token)).send({ name: "Nope", permissionKeys: [] })).status).toBe(403);
    });
  });

  describe("administration dashboard and security policy", () => {
    it("returns real organization-scoped counts", async () => {
      const admin = await registerOrg("dash");
      await addUser(admin.token, "VIEWER", "dashviewer");
      await request(app).post("/api/v1/auth/login").send({ email: admin.email, password: "WrongPassword999" });

      const res = await request(app).get("/api/v1/admin/overview").set(auth(admin.token));
      expect(res.status).toBe(200);
      const o = res.body.data.overview;
      expect(o.users.total).toBe(2);
      expect(o.users.active).toBe(2);
      expect(o.sessions.active).toBeGreaterThanOrEqual(2);
      expect(o.security.failedLogins24h).toBe(1);
      expect(o.integrations.webhookEndpoints.total).toBe(0);
      expect(o.organizations).toBeNull(); // only SUPER_ADMIN sees platform-wide organization counts
    });

    it("exposes the effective policy without leaking any secret", async () => {
      const admin = await registerOrg("policy");
      const res = await request(app).get("/api/v1/admin/security/policy").set(auth(admin.token));
      expect(res.status).toBe(200);
      expect(res.body.data.policy.lockout.failedAttemptsThreshold).toBeGreaterThan(0);
      const text = JSON.stringify(res.body);
      expect(text).not.toContain(process.env.SESSION_SECRET!);
      expect(text).not.toContain(process.env.WEBHOOK_SECRET!);
    });
  });

  describe("user administration safeguards", () => {
    it("prevents an administrator from deactivating their own account", async () => {
      const admin = await registerOrg("selfdisable");
      const res = await request(app).patch(`/api/v1/users/${admin.userId}`).set(auth(admin.token)).send({ status: "DISABLED" });
      expect(res.status).toBe(403);
    });

    it("prevents a non-SUPER_ADMIN from modifying a SUPER_ADMIN account", async () => {
      const admin = await registerOrg("protectsuper");
      const target = await addUser(admin.token, "USER", "willbesuper");
      await promoteToSuperAdmin(target.id, admin.orgId);
      expect((await request(app).patch(`/api/v1/users/${target.id}`).set(auth(admin.token)).send({ status: "DISABLED" })).status).toBe(403);
      expect((await request(app).post(`/api/v1/users/${target.id}/revoke-sessions`).set(auth(admin.token))).status).toBe(403);
      expect((await request(app).post(`/api/v1/users/${target.id}/unlock`).set(auth(admin.token))).status).toBe(403);
    });

    it("revokes all of a user's sessions, which immediately stops working, and audits it", async () => {
      const admin = await registerOrg("revokeall");
      const member = await addUser(admin.token, "USER", "victim");
      expect((await request(app).get("/api/v1/auth/me").set(auth(member.token))).status).toBe(200);

      const list = await request(app).get(`/api/v1/users/${member.id}/sessions`).set(auth(admin.token));
      expect(list.status).toBe(200);
      expect(list.body.data.sessions.length).toBeGreaterThan(0);
      expect(JSON.stringify(list.body)).not.toMatch(/tokenHash|art_sess_/);

      const revoke = await request(app).post(`/api/v1/users/${member.id}/revoke-sessions`).set(auth(admin.token));
      expect(revoke.status).toBe(200);
      expect(revoke.body.data.revoked).toBeGreaterThan(0);
      expect((await request(app).get("/api/v1/auth/me").set(auth(member.token))).status).toBe(401);
      expect(await prisma.auditLog.count({ where: { action: "USER_SESSIONS_REVOKED", resourceId: member.id } })).toBe(1);
    });

    it("unlocks a locked account", async () => {
      const admin = await registerOrg("unlock");
      const member = await addUser(admin.token, "USER", "locked");
      await prisma.user.update({ where: { id: member.id }, data: { failedLoginAttempts: 5, lockedUntil: new Date(Date.now() + 3600_000) } });
      expect((await request(app).post("/api/v1/auth/login").send({ email: member.email, password: "MemberPassword123" })).status).not.toBe(200);
      expect((await request(app).post(`/api/v1/users/${member.id}/unlock`).set(auth(admin.token))).status).toBe(200);
      expect((await request(app).post("/api/v1/auth/login").send({ email: member.email, password: "MemberPassword123" })).status).toBe(200);
    });

    it("enforces tenant isolation on user session administration", async () => {
      const a = await registerOrg("tenanta");
      const b = await registerOrg("tenantb");
      const victim = await addUser(a.token, "USER", "tenantavictim");
      expect((await request(app).get(`/api/v1/users/${victim.id}/sessions`).set(auth(b.token))).status).toBe(404);
      expect((await request(app).post(`/api/v1/users/${victim.id}/revoke-sessions`).set(auth(b.token))).status).toBe(404);
      expect((await request(app).post(`/api/v1/users/${victim.id}/unlock`).set(auth(b.token))).status).toBe(404);
    });

    it("revokes every other session of the caller but keeps the current one", async () => {
      const admin = await registerOrg("others");
      const second = await request(app).post("/api/v1/auth/login").send({ email: admin.email, password: "OriginalPassword123" });
      const secondToken = second.body.data.session.token as string;
      const res = await request(app).post("/api/v1/auth/sessions/revoke-others").set(auth(admin.token));
      expect(res.status).toBe(200);
      expect((await request(app).get("/api/v1/auth/me").set(auth(admin.token))).status).toBe(200);
      expect((await request(app).get("/api/v1/auth/me").set(auth(secondToken))).status).toBe(401);
    });

    it("lets an administrator list and revoke organization sessions, without exposing tokens", async () => {
      const sa = await superAdmin("sessadmin");
      const member = await addUser(sa.token, "USER", "sessmember");
      const list = await request(app).get("/api/v1/admin/sessions").set(auth(sa.token));
      expect(list.status).toBe(200);
      expect(JSON.stringify(list.body)).not.toMatch(/tokenHash|art_sess_/);
      const target = list.body.data.sessions.find((s: { user: { email: string } }) => s.user.email === member.email);
      expect(target).toBeDefined();

      expect((await request(app).post(`/api/v1/admin/sessions/${target.id}/revoke`).set(auth(sa.token))).status).toBe(200);
      expect((await request(app).get("/api/v1/auth/me").set(auth(member.token))).status).toBe(401);
    });
  });

  describe("role management", () => {
    it("lets only a SUPER_ADMIN create custom roles, protects system roles, and audits changes", async () => {
      const sa = await superAdmin("roles");

      const created = await request(app).post("/api/v1/roles").set(auth(sa.token)).send({ name: "Content Reviewer", description: "Reviews content", permissionKeys: ["content.read", "templates.read"] });
      expect(created.status).toBe(201);
      const roleId = created.body.data.role.id as string;
      createdRoleIds.push(roleId);
      expect(created.body.data.role.key).toBe("CUSTOM_CONTENT_REVIEWER");

      expect((await request(app).post("/api/v1/roles").set(auth(sa.token)).send({ name: "Content Reviewer", permissionKeys: [] })).status).toBe(409);

      const adminRole = await prisma.role.findUniqueOrThrow({ where: { key: "ADMIN" } });
      expect((await request(app).patch(`/api/v1/roles/${adminRole.id}`).set(auth(sa.token)).send({ name: "Hacked" })).status).toBe(403);
      expect((await request(app).put(`/api/v1/roles/${adminRole.id}/permissions`).set(auth(sa.token)).send({ permissionKeys: [] })).status).toBe(403);
      expect((await request(app).delete(`/api/v1/roles/${adminRole.id}`).set(auth(sa.token))).status).toBe(403);

      expect((await request(app).put(`/api/v1/roles/${roleId}/permissions`).set(auth(sa.token)).send({ permissionKeys: ["content.read", "not.a.permission"] })).status).toBe(400);
      expect((await request(app).put(`/api/v1/roles/${roleId}/permissions`).set(auth(sa.token)).send({ permissionKeys: ["content.read", "security.manage"] })).status).toBe(400);

      const ok = await request(app).put(`/api/v1/roles/${roleId}/permissions`).set(auth(sa.token)).send({ permissionKeys: ["content.read", "templates.read", "security.manage"], confirmCritical: true });
      expect(ok.status).toBe(200);
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "ROLE_PERMISSIONS_CHANGED", resourceId: roleId } });
      expect((audit.afterData as { added: string[] }).added).toEqual(["security.manage"]);

      expect((await request(app).post("/api/v1/roles").set(auth(sa.token)).send({ name: "x", permissionKeys: [] })).status).toBe(400); // name too short
    });

    it("refuses to delete a role that is still assigned, then deletes it once free", async () => {
      const sa = await superAdmin("roledelete");
      const created = await request(app).post("/api/v1/roles").set(auth(sa.token)).send({ name: "Temp Role", permissionKeys: ["content.read"] });
      const roleId = created.body.data.role.id as string;
      createdRoleIds.push(roleId);
      const member = await addUser(sa.token, "CUSTOM_TEMP_ROLE", "temprole");
      expect((await request(app).delete(`/api/v1/roles/${roleId}`).set(auth(sa.token))).status).toBe(409);
      await request(app).patch(`/api/v1/users/${member.id}`).set(auth(sa.token)).send({ roleKey: "VIEWER" });
      expect((await request(app).delete(`/api/v1/roles/${roleId}`).set(auth(sa.token))).status).toBe(200);
      createdRoleIds.splice(createdRoleIds.indexOf(roleId), 1);
    });

    it("blocks privilege escalation: an administrator cannot assign a role that holds permissions they lack", async () => {
      const sa = await superAdmin("escalate");
      const created = await request(app).post("/api/v1/roles").set(auth(sa.token)).send({ name: "Power Role", permissionKeys: ["content.read", "security.manage"], confirmCritical: true });
      createdRoleIds.push(created.body.data.role.id);

      const admin = await registerOrg("escalateadmin");
      const member = await addUser(admin.token, "VIEWER", "escalatemember");
      const assign = await request(app).patch(`/api/v1/users/${member.id}`).set(auth(admin.token)).send({ roleKey: "CUSTOM_POWER_ROLE" });
      expect(assign.status).toBe(403);
      const create = await request(app).post("/api/v1/users").set(auth(admin.token))
        .send({ email: "esc-new@example.com", password: "MemberPassword123", firstName: "E", lastName: "N", roleKey: "CUSTOM_POWER_ROLE" });
      expect(create.status).toBe(403);
    });
  });

  describe("integrations and credential protection", () => {
    it("stores credentials encrypted, never returns them, tests connectivity honestly, and audits without secrets", async () => {
      const sa = await superAdmin("integ");
      const secret = "sk_live_super_secret_value_1234";

      const bad = await request(app).put("/api/v1/integrations/custom_api").set(auth(sa.token)).send({ config: { baseUrl: "http://169.254.169.254" }, secret });
      expect(bad.status).toBe(400); // SSRF guard: cloud-metadata address

      expect((await request(app).put("/api/v1/integrations/unknown_provider").set(auth(sa.token)).send({ enabled: false })).status).toBe(404);
      expect((await request(app).put("/api/v1/integrations/custom_api").set(auth(sa.token)).send({ secret: "short" })).status).toBe(400);
      expect((await request(app).put("/api/v1/integrations/custom_api").set(auth(sa.token)).send({ config: { evil: "x" } })).status).toBe(400);

      received.length = 0;
      const saved = await request(app).put("/api/v1/integrations/custom_api").set(auth(sa.token)).send({ config: { baseUrl: receiverUrl.replace("/hook", "") }, secret });
      expect(saved.status).toBe(200);
      expect(saved.body.data.integration.hasSecret).toBe(true);
      expect(saved.body.data.integration.secretLast4).toBe("1234");
      expect(saved.body.data.integration.status).toBe("CONFIGURED"); // configured != verified
      expect(JSON.stringify(saved.body)).not.toContain(secret);

      const row = await prisma.integration.findFirstOrThrow({ where: { organizationId: sa.orgId, provider: "custom_api" } });
      expect(row.secretCiphertext).toMatch(/^v1\./);
      expect(row.secretCiphertext).not.toContain(secret);

      const overview = await request(app).get("/api/v1/integrations").set(auth(sa.token));
      expect(JSON.stringify(overview.body)).not.toContain(secret);
      expect(JSON.stringify(overview.body)).not.toContain(row.secretCiphertext!);

      receiverStatus = 200;
      const ok = await request(app).post("/api/v1/integrations/custom_api/test").set(auth(sa.token));
      expect(ok.body.data.integration.status).toBe("VERIFIED");
      expect(received.at(-1)!.headers.authorization).toBe(`Bearer ${secret}`);

      receiverStatus = 500;
      const failed = await request(app).post("/api/v1/integrations/custom_api/test").set(auth(sa.token));
      expect(failed.body.data.integration.status).toBe("FAILING");
      expect(failed.body.data.integration.lastError).toContain("500");
      receiverStatus = 200;

      const audits = await prisma.auditLog.findMany({ where: { organizationId: sa.orgId, action: { startsWith: "INTEGRATION_" } } });
      expect(audits.length).toBeGreaterThanOrEqual(3);
      expect(JSON.stringify(audits)).not.toContain(secret);

      const cleared = await request(app).delete("/api/v1/integrations/custom_api/secret").set(auth(sa.token));
      expect(cleared.body.data.integration.hasSecret).toBe(false);
      expect(cleared.body.data.integration.status).toBe("NOT_CONFIGURED");
    });

    it("refuses to enable an integration that is not configured, and reports system integrations by configuration only", async () => {
      const sa = await superAdmin("integsys");
      expect((await request(app).put("/api/v1/integrations/custom_api").set(auth(sa.token)).send({ enabled: true })).status).toBe(400);
      expect((await request(app).post("/api/v1/integrations/custom_api/test").set(auth(sa.token))).status).toBe(400);
      const overview = await request(app).get("/api/v1/integrations").set(auth(sa.token));
      const gemini = overview.body.data.system.find((s: { key: string }) => s.key === "ai_gemini");
      expect(gemini.verified).toBe(false);
      expect(["configured", "not_configured"]).toContain(gemini.status);
      expect(overview.body.data.encryption.source).toMatch(/dedicated|derived/);
    });

    it("isolates integrations per tenant", async () => {
      const a = await superAdmin("intega");
      const b = await superAdmin("integb");
      await request(app).put("/api/v1/integrations/custom_api").set(auth(a.token)).send({ config: { baseUrl: receiverUrl.replace("/hook", "") }, secret: "tenant-a-secret-9999" });
      const view = await request(app).get("/api/v1/integrations").set(auth(b.token));
      expect(view.body.data.configurable[0].integration).toBeNull();
    });
  });

  describe("outbound webhooks", () => {
    it("creates an endpoint with a one-time secret, signs deliveries correctly, and never re-exposes the secret", async () => {
      const sa = await superAdmin("hooks");
      received.length = 0;
      receiverStatus = 200;

      const created = await request(app).post("/api/v1/webhook-endpoints").set(auth(sa.token)).send({ name: "CRM sync", url: receiverUrl, events: ["lead.created"] });
      expect(created.status).toBe(201);
      expect(created.headers["cache-control"]).toBe("no-store");
      const secret = created.body.data.secret as string;
      const id = created.body.data.endpoint.id as string;
      expect(secret).toMatch(/^whsec_/);
      expect(JSON.stringify(created.body.data.endpoint)).not.toContain(secret);

      const list = await request(app).get("/api/v1/webhook-endpoints").set(auth(sa.token));
      expect(JSON.stringify(list.body)).not.toContain(secret);
      expect(JSON.stringify(list.body)).not.toMatch(/secretCiphertext|v1\./);

      const test = await request(app).post(`/api/v1/webhook-endpoints/${id}/test`).set(auth(sa.token));
      expect(test.body.data.delivery.status).toBe("SUCCEEDED");
      const hit = received.at(-1)!;
      expect(hit.headers["x-artify-event"]).toBe("webhook.test");
      const expected = signHmac(secret, `${hit.headers["x-artify-timestamp"]}.${hit.body}`);
      expect(hit.headers["x-artify-signature"]).toBe(`sha256=${expected}`);

      // A real platform event reaches the subscribed endpoint; an unsubscribed one does not.
      received.length = 0;
      await EventEngine.getInstance().emit({ eventType: "lead.created", entityType: "lead", entityId: "lead-1", organizationId: sa.orgId, payload: { name: "Acme", password: "must-be-stripped" } });
      await EventEngine.getInstance().emit({ eventType: "client.created", entityType: "client", entityId: "c-1", organizationId: sa.orgId, payload: { name: "Nope" } });
      expect(received).toHaveLength(1);
      expect(received[0]!.headers["x-artify-event"]).toBe("lead.created");
      expect(received[0]!.body).not.toContain("must-be-stripped");

      const deliveries = await request(app).get(`/api/v1/webhook-endpoints/${id}/deliveries`).set(auth(sa.token));
      expect(deliveries.body.data.deliveries.length).toBe(2);
      expect(deliveries.body.meta.pagination.total).toBe(2);
    });

    it("rejects private/metadata URLs, unsupported events and invalid input", async () => {
      const sa = await superAdmin("hooksbad");
      const post = (body: object) => request(app).post("/api/v1/webhook-endpoints").set(auth(sa.token)).send(body);
      expect((await post({ name: "x", url: "http://169.254.169.254/latest", events: ["*"] })).status).toBe(400);
      expect((await post({ name: "x", url: "http://10.0.0.5/hook", events: ["*"] })).status).toBe(400);
      expect((await post({ name: "x", url: "ftp://example.com/hook", events: ["*"] })).status).toBe(400);
      expect((await post({ name: "x", url: receiverUrl, events: ["not.a.real.event"] })).status).toBe(400);
      expect((await post({ name: "", url: receiverUrl, events: ["*"] })).status).toBe(400);
      expect((await post({ name: "x", url: receiverUrl, events: [] })).status).toBe(400);
    });

    it("records failures, schedules retries, retries on demand, and rotates secrets", async () => {
      const sa = await superAdmin("hooksretry");
      const created = await request(app).post("/api/v1/webhook-endpoints").set(auth(sa.token)).send({ name: "Flaky", url: receiverUrl, events: ["*"] });
      const id = created.body.data.endpoint.id as string;
      const oldSecret = created.body.data.secret as string;

      receiverStatus = 500;
      const failed = await request(app).post(`/api/v1/webhook-endpoints/${id}/test`).set(auth(sa.token));
      expect(failed.body.data.delivery.status).toBe("PENDING");
      expect(failed.body.data.delivery.attempts).toBe(1);
      expect(failed.body.data.delivery.nextRetryAt).not.toBeNull();
      expect(failed.body.data.delivery.error).toContain("500");

      // Cron-driven retry once the backoff has elapsed.
      await prisma.webhookDelivery.updateMany({ where: { endpointId: id }, data: { nextRetryAt: new Date(Date.now() - 1000) } });
      receiverStatus = 200;
      expect(await webhookEndpointService.processDueRetries()).toBeGreaterThanOrEqual(1);
      const after = await prisma.webhookDelivery.findFirstOrThrow({ where: { endpointId: id } });
      expect(after.status).toBe("SUCCEEDED");
      expect(after.attempts).toBe(2);

      // Manual retry of a failed delivery; already-succeeded deliveries refuse.
      expect((await request(app).post(`/api/v1/webhook-endpoints/deliveries/${after.id}/retry`).set(auth(sa.token))).status).toBe(409);

      received.length = 0;
      const rotated = await request(app).post(`/api/v1/webhook-endpoints/${id}/rotate-secret`).set(auth(sa.token));
      const newSecret = rotated.body.data.secret as string;
      expect(newSecret).not.toBe(oldSecret);
      await request(app).post(`/api/v1/webhook-endpoints/${id}/test`).set(auth(sa.token));
      const hit = received.at(-1)!;
      expect(hit.headers["x-artify-signature"]).toBe(`sha256=${signHmac(newSecret, `${hit.headers["x-artify-timestamp"]}.${hit.body}`)}`);
      expect(hit.headers["x-artify-signature"]).not.toBe(`sha256=${signHmac(oldSecret, `${hit.headers["x-artify-timestamp"]}.${hit.body}`)}`);
    });

    it("enforces tenant isolation and supports disable/delete", async () => {
      const a = await superAdmin("hooksa");
      const b = await superAdmin("hooksb");
      const created = await request(app).post("/api/v1/webhook-endpoints").set(auth(a.token)).send({ name: "A hook", url: receiverUrl, events: ["*"] });
      const id = created.body.data.endpoint.id as string;

      expect((await request(app).patch(`/api/v1/webhook-endpoints/${id}`).set(auth(b.token)).send({ enabled: false })).status).toBe(404);
      expect((await request(app).post(`/api/v1/webhook-endpoints/${id}/test`).set(auth(b.token))).status).toBe(404);
      expect((await request(app).get(`/api/v1/webhook-endpoints/${id}/deliveries`).set(auth(b.token))).status).toBe(404);
      expect((await request(app).post(`/api/v1/webhook-endpoints/${id}/rotate-secret`).set(auth(b.token))).status).toBe(404);
      expect((await request(app).delete(`/api/v1/webhook-endpoints/${id}`).set(auth(b.token))).status).toBe(404);
      expect((await request(app).get("/api/v1/webhook-endpoints").set(auth(b.token))).body.data.endpoints).toHaveLength(0);

      // A disabled endpoint receives nothing.
      await request(app).patch(`/api/v1/webhook-endpoints/${id}`).set(auth(a.token)).send({ enabled: false });
      received.length = 0;
      await EventEngine.getInstance().emit({ eventType: "lead.created", entityType: "lead", entityId: "l-9", organizationId: a.orgId, payload: {} });
      expect(received).toHaveLength(0);

      expect((await request(app).delete(`/api/v1/webhook-endpoints/${id}`).set(auth(a.token))).status).toBe(200);
      expect((await request(app).get("/api/v1/webhook-endpoints").set(auth(a.token))).body.data.endpoints).toHaveLength(0);
    });
  });

  describe("API keys", () => {
    it("shows the key once, stores only a hash, authenticates the external API, and honours revoke/expiry", async () => {
      const sa = await superAdmin("keys");
      const created = await request(app).post("/api/v1/api-keys").set(auth(sa.token)).send({ name: "Reporting", scopes: ["leads.read"], expiresInDays: 30 });
      expect(created.status).toBe(201);
      expect(created.headers["cache-control"]).toBe("no-store");
      const key = created.body.data.key as string;
      const id = created.body.data.apiKey.id as string;
      expect(key).toMatch(/^artify_ak_[0-9a-f]{64}$/);
      expect(JSON.stringify(created.body.data.apiKey)).not.toContain(key);

      const row = await prisma.apiKey.findUniqueOrThrow({ where: { id } });
      expect(row.keyHash).not.toContain(key);
      expect(row.keyHash).toMatch(/^[0-9a-f]{64}$/);

      const list = await request(app).get("/api/v1/api-keys").set(auth(sa.token));
      expect(JSON.stringify(list.body)).not.toContain(key);
      expect(JSON.stringify(list.body)).not.toContain(row.keyHash);

      const who = await request(app).get("/api/v1/external/whoami").set(auth(key));
      expect(who.status).toBe(200);
      expect(who.body.data.apiKey.scopes).toEqual(["leads.read"]);
      expect(who.body.data.organization.id).toBe(sa.orgId);
      expect((await prisma.apiKey.findUniqueOrThrow({ where: { id } })).lastUsedAt).not.toBeNull();

      // A key is not a session: it cannot reach session-protected routes, and a session token is not a key.
      expect((await request(app).get("/api/v1/users").set(auth(key))).status).toBe(401);
      expect((await request(app).get("/api/v1/external/whoami").set(auth(sa.token))).status).toBe(401);
      expect((await request(app).get("/api/v1/external/whoami").set(auth("artify_ak_" + "0".repeat(64)))).status).toBe(401);
      expect((await request(app).get("/api/v1/external/whoami")).status).toBe(401);

      await prisma.apiKey.update({ where: { id }, data: { expiresAt: new Date(Date.now() - 1000) } });
      expect((await request(app).get("/api/v1/external/whoami").set(auth(key))).status).toBe(401);
      await prisma.apiKey.update({ where: { id }, data: { expiresAt: null } });
      expect((await request(app).get("/api/v1/external/whoami").set(auth(key))).status).toBe(200);

      expect((await request(app).post(`/api/v1/api-keys/${id}/revoke`).set(auth(sa.token))).status).toBe(200);
      expect((await request(app).get("/api/v1/external/whoami").set(auth(key))).status).toBe(401);
      expect(await prisma.auditLog.count({ where: { organizationId: sa.orgId, action: { in: ["API_KEY_CREATED", "API_KEY_REVOKED"] } } })).toBe(2);
    });

    it("rejects administrative, unknown and over-broad scopes, and invalid expiry", async () => {
      const sa = await superAdmin("keyscopes");
      const post = (body: object) => request(app).post("/api/v1/api-keys").set(auth(sa.token)).send(body);
      expect((await post({ name: "k", scopes: ["api_keys.manage"] })).status).toBe(400);
      expect((await post({ name: "k", scopes: ["roles.assign"] })).status).toBe(400);
      expect((await post({ name: "k", scopes: ["nope.nope"] })).status).toBe(400);
      expect((await post({ name: "k", scopes: [] })).status).toBe(400);
      expect((await post({ name: "k", scopes: ["leads.read"], expiresInDays: 9999 })).status).toBe(400);

      // A key manager can only grant scopes they hold themselves.
      const role = await request(app).post("/api/v1/roles").set(auth(sa.token)).send({ name: "Key Manager", permissionKeys: ["api_keys.read", "api_keys.manage", "leads.read"], confirmCritical: true });
      createdRoleIds.push(role.body.data.role.id);
      const manager = await addUser(sa.token, "CUSTOM_KEY_MANAGER", "keymgr");
      const own = await request(app).post("/api/v1/api-keys").set(auth(manager.token)).send({ name: "ok", scopes: ["leads.read"] });
      expect(own.status).toBe(201);
      const tooBroad = await request(app).post("/api/v1/api-keys").set(auth(manager.token)).send({ name: "no", scopes: ["clients.read"] });
      expect(tooBroad.status).toBe(400);
    });

    it("isolates keys per tenant", async () => {
      const a = await superAdmin("keysa");
      const b = await superAdmin("keysb");
      const created = await request(app).post("/api/v1/api-keys").set(auth(a.token)).send({ name: "A", scopes: ["leads.read"] });
      expect((await request(app).get("/api/v1/api-keys").set(auth(b.token))).body.data.apiKeys).toHaveLength(0);
      expect((await request(app).post(`/api/v1/api-keys/${created.body.data.apiKey.id}/revoke`).set(auth(b.token))).status).toBe(404);
    });
  });

  describe("audit log", () => {
    it("supports search, severity, actor-type and resource filters, detail drill-down and tenant scoping", async () => {
      const sa = await superAdmin("audit");
      const other = await registerOrg("auditother");
      const member = await addUser(sa.token, "USER", "auditmember");
      await request(app).patch(`/api/v1/users/${member.id}`).set(auth(sa.token)).send({ firstName: "Renamed" });
      await request(app).post(`/api/v1/users/${member.id}/revoke-sessions`).set(auth(sa.token));
      await request(app).post("/api/v1/auth/login").send({ email: member.email, password: "WrongPassword999" });

      const q = await request(app).get("/api/v1/audit-logs").query({ q: "USER_CREATED" }).set(auth(sa.token));
      expect(q.status).toBe(200);
      expect(q.body.data.auditLogs.length).toBeGreaterThanOrEqual(1);
      expect(q.body.data.auditLogs.every((r: { action: string }) => r.action.includes("USER_CREATED"))).toBe(true);

      const critical = await request(app).get("/api/v1/audit-logs").query({ severity: "critical" }).set(auth(sa.token));
      expect(critical.body.data.auditLogs.map((r: { action: string }) => r.action)).toContain("USER_SESSIONS_REVOKED");
      expect(critical.body.data.auditLogs.every((r: { severity: string }) => r.severity === "critical")).toBe(true);

      const warning = await request(app).get("/api/v1/audit-logs").query({ severity: "warning" }).set(auth(sa.token));
      expect(warning.body.data.auditLogs.map((r: { action: string }) => r.action)).toContain("AUTH_LOGIN_FAILED");

      const byResource = await request(app).get("/api/v1/audit-logs").query({ resourceType: "user", resourceId: member.id }).set(auth(sa.token));
      expect(byResource.body.data.auditLogs.every((r: { resourceId: string }) => r.resourceId === member.id)).toBe(true);

      const paged = await request(app).get("/api/v1/audit-logs").query({ limit: 2, page: 1 }).set(auth(sa.token));
      expect(paged.body.data.auditLogs).toHaveLength(2);
      expect(paged.body.meta.pagination.total).toBeGreaterThan(2);

      const facets = await request(app).get("/api/v1/audit-logs/facets").set(auth(sa.token));
      expect(facets.body.data.actions).toContain("USER_CREATED");

      const eventId = q.body.data.auditLogs[0].id as string;
      const detail = await request(app).get(`/api/v1/audit-logs/${eventId}`).set(auth(sa.token));
      expect(detail.status).toBe(200);
      expect(detail.body.data.auditLog.id).toBe(eventId);

      // Another tenant cannot read this event, and cannot widen scope with organizationId.
      expect((await request(app).get(`/api/v1/audit-logs/${eventId}`).set(auth(other.token))).status).toBe(404);
      const widened = await request(app).get("/api/v1/audit-logs").query({ organizationId: sa.orgId, q: "USER_CREATED" }).set(auth(other.token));
      expect(widened.body.data.auditLogs).toHaveLength(0);

      expect((await request(app).get("/api/v1/audit-logs").query({ severity: "bogus" }).set(auth(sa.token))).status).toBe(400);
    });

    it("exposes no way to modify or delete audit records over HTTP", async () => {
      const sa = await superAdmin("auditimmutable");
      const list = await request(app).get("/api/v1/audit-logs").set(auth(sa.token));
      const id = list.body.data.auditLogs[0].id;
      for (const method of ["patch", "put", "delete"] as const) {
        const res = await request(app)[method](`/api/v1/audit-logs/${id}`).set(auth(sa.token)).send({});
        expect([404, 405]).toContain(res.status);
      }
      expect(await prisma.auditLog.count({ where: { id } })).toBe(1);
    });

    it("never writes credentials into the audit trail or security events", async () => {
      const sa = await superAdmin("auditsecrets");
      const created = await request(app).post("/api/v1/webhook-endpoints").set(auth(sa.token)).send({ name: "audited", url: receiverUrl, events: ["*"] });
      const key = await request(app).post("/api/v1/api-keys").set(auth(sa.token)).send({ name: "audited", scopes: ["leads.read"] });
      const everything = JSON.stringify(await prisma.auditLog.findMany({ where: { organizationId: sa.orgId } }));
      expect(everything).not.toContain(created.body.data.secret);
      expect(everything).not.toContain(key.body.data.key);
      const events = await request(app).get("/api/v1/admin/security/events").set(auth(sa.token));
      expect(events.status).toBe(200);
      expect(JSON.stringify(events.body)).not.toContain(key.body.data.key);
    });
  });
});
