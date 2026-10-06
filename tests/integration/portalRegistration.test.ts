/**
 * Public client-portal registration, email verification and reset-by-email.
 * Email delivery is stubbed (spy on emailService) — no network.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp, finalizeApp } from "../../server/app/app";
import { disconnectPrisma, prisma } from "../../server/db/prisma";
import { emailService, type OutboundEmail } from "../../server/services/emailService";
import { resetDb } from "../helpers/db";

describe("Client portal registration", () => {
  const app = createApp();
  finalizeApp(app);
  const sent: OutboundEmail[] = [];
  // Each call comes from a distinct client IP so the per-IP registration cap (5/hour) is not what's under test.
  let ipCounter = 10;
  const register = (body: object) => request(app).post("/api/v1/auth/portal/register").set("X-Forwarded-For", `10.9.0.${ipCounter++}`).send(body);
  const valid = (email: string) => ({ email, password: "Str0ng-Passphrase-77", firstName: "Port", lastName: "Al", organizationName: "Portal Co" });
  const tokenFrom = (mail: OutboundEmail | undefined) => decodeURIComponent((mail?.text.match(/token=([^\s&]+)/) ?? [])[1] ?? "");

  beforeAll(async () => {
    await resetDb();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    sent.length = 0;
  });
  afterAll(async () => {
    await disconnectPrisma();
  });

  const enableEmail = () => {
    vi.spyOn(emailService, "isEnabled").mockReturnValue(true);
    vi.spyOn(emailService, "send").mockImplementation(async (m) => {
      sent.push(m);
    });
  };

  it("degraded mode (no email provider): signs in immediately with the least-privilege role", async () => {
    const res = await register(valid("degraded@example.com"));
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe("registered");
    expect(res.body.data.user.role.key).toBe("CLIENT_PORTAL");
    const perms: string[] = res.body.data.user.role.permissions;
    expect(perms.length).toBeGreaterThan(0);
    expect(perms.every((p) => p.startsWith("portal."))).toBe(true);

    const token = res.body.data.session.token;
    expect((await request(app).get("/api/v1/clients").set("Authorization", `Bearer ${token}`)).status).toBe(403);
    expect((await request(app).get("/api/v1/users").set("Authorization", `Bearer ${token}`)).status).toBe(403);

    const dup = await register(valid("degraded@example.com"));
    expect(dup.status).toBe(409);
  });

  it("with email: no session until verified, verification works once, duplicates look identical", async () => {
    enableEmail();
    const res = await register(valid("verify@example.com"));
    expect(res.status).toBe(201);
    expect(res.body.data).toEqual({ status: "verification_required" });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe("verify@example.com");

    const blocked = await request(app).post("/api/v1/auth/login").send({ email: "verify@example.com", password: "Str0ng-Passphrase-77" });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe("EMAIL_NOT_VERIFIED");

    // A wrong password must NOT reveal that the account exists-but-unverified.
    const wrong = await request(app).post("/api/v1/auth/login").send({ email: "verify@example.com", password: "Wrong-Passphrase-1" });
    expect(wrong.status).toBe(401);

    const token = tokenFrom(sent[0]);
    expect(token).toMatch(/^art_verify_/);
    expect((await request(app).post("/api/v1/auth/verify-email").send({ token })).status).toBe(200);
    expect((await request(app).post("/api/v1/auth/verify-email").send({ token })).status).toBe(401); // single use

    const ok = await request(app).post("/api/v1/auth/login").send({ email: "verify@example.com", password: "Str0ng-Passphrase-77" });
    expect(ok.status).toBe(200);

    sent.length = 0;
    const dup = await register(valid("verify@example.com"));
    expect(dup.status).toBe(201);
    expect(dup.body.data).toEqual({ status: "verification_required" });
    expect(sent[0]!.subject).toMatch(/already have/i);
    expect(await prisma.user.count({ where: { email: "verify@example.com" } })).toBe(1);
  });

  it("resend is generic and only emails unverified accounts", async () => {
    enableEmail();
    await register(valid("resend@example.com"));
    sent.length = 0;
    const a = await request(app).post("/api/v1/auth/resend-verification").send({ email: "resend@example.com" });
    const b = await request(app).post("/api/v1/auth/resend-verification").send({ email: "nobody-here@example.com" });
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.body.data).toEqual(b.body.data);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe("resend@example.com");
  });

  it("honeypot submissions look successful but create nothing", async () => {
    enableEmail();
    const res = await register({ ...valid("bot@example.com"), website: "http://spam.example" });
    expect(res.status).toBe(201);
    expect(res.body.data).toEqual({ status: "verification_required" });
    expect(await prisma.user.count({ where: { email: "bot@example.com" } })).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it("caps registrations per IP", async () => {
    const results: number[] = [];
    for (let i = 0; i < 7; i++) {
      const res = await request(app).post("/api/v1/auth/portal/register").set("X-Forwarded-For", "10.8.8.8").send({ ...valid(`cap${i}@example.com`), password: "short" });
      results.push(res.status);
    }
    expect(results.slice(0, 5).every((c) => c === 400)).toBe(true);
    expect(results.slice(5).every((c) => c === 429)).toBe(true);
  });

  it("rejects weak passwords, including ones containing the email name", async () => {
    const weak = await register({ ...valid("jonathan@example.com"), password: "jonathan-secure-99" });
    expect(weak.status).toBe(400);
    const short = await register({ ...valid("short@example.com"), password: "abc123" });
    expect(short.status).toBe(400);
  });

  it("password reset is delivered by email and confirms the address", async () => {
    enableEmail();
    await register(valid("reset@example.com"));
    sent.length = 0;
    const req1 = await request(app).post("/api/v1/auth/password-reset/request").send({ email: "reset@example.com" });
    expect(req1.status).toBe(200);
    expect(req1.body.data.devToken).toBeUndefined();
    expect(sent).toHaveLength(1);
    const token = tokenFrom(sent[0]);
    const confirm = await request(app).post("/api/v1/auth/password-reset/confirm").send({ token, newPassword: "An0ther-Strong-Phrase-5" });
    expect(confirm.status).toBe(200);
    const login = await request(app).post("/api/v1/auth/login").send({ email: "reset@example.com", password: "An0ther-Strong-Phrase-5" });
    expect(login.status).toBe(200); // reset also proved inbox control, so no verification block
  });
});

describe("Operator review of portal registrations", () => {
  const app = createApp();
  finalizeApp(app);
  let agencyToken: string;
  let outsiderToken: string;
  let ip = 50;
  const register = (email: string) =>
    request(app)
      .post("/api/v1/auth/portal/register")
      .set("X-Forwarded-For", `10.7.0.${ip++}`)
      .send({ email, password: "Str0ng-Passphrase-77", firstName: "Rev", lastName: "Iew", organizationName: `Review ${email}` });

  beforeAll(async () => {
    await resetDb();
    const { config } = await import("../../server/config/env");
    const { hashPassword } = await import("../../server/utils/password");
    const agencyId = config.publicWebsiteOrganizationId;
    await prisma.organization.upsert({ where: { id: agencyId }, update: {}, create: { id: agencyId, name: "Agency", slug: "agency-review", type: "INTERNAL", tier: "ENTERPRISE", status: "ACTIVE" } });
    const admin = await prisma.role.findUniqueOrThrow({ where: { key: "ADMIN" } });
    const user = await prisma.user.create({
      data: { organizationId: agencyId, email: "agency-admin@example.com", passwordHash: await hashPassword("Agency-Passphrase-42"), firstName: "Ag", lastName: "Ency", roleId: admin.id },
    });
    await prisma.organizationMembership.create({ data: { userId: user.id, organizationId: agencyId, roleId: admin.id, status: "ACTIVE", isPrimary: true } });
    agencyToken = (await request(app).post("/api/v1/auth/login").send({ email: "agency-admin@example.com", password: "Agency-Passphrase-42" })).body.data.session.token;
    const outsider = await request(app).post("/api/v1/auth/register").send({ email: "outsider@example.com", password: "Outsider-Passphrase-42", firstName: "Out", lastName: "Sider", organizationName: "Outsider Co" });
    outsiderToken = outsider.body.data.session.token;
  });

  it("lists, links to a client (activating the portal) and rejects; non-agency admins are refused", async () => {
    const reg = await register("pending1@example.com");
    const portalToken = reg.body.data.session.token;
    const orgId = reg.body.data.user.organizationId;

    expect((await request(app).get("/api/v1/portal-registrations").set("Authorization", `Bearer ${outsiderToken}`)).status).toBe(403);
    const list = await request(app).get("/api/v1/portal-registrations").set("Authorization", `Bearer ${agencyToken}`);
    expect(list.status).toBe(200);
    expect(list.body.data.registrations.some((r: { organizationId: string }) => r.organizationId === orgId)).toBe(true);

    const client = await request(app).post("/api/v1/clients").set("Authorization", `Bearer ${agencyToken}`).send({ clientCode: "PR-1", name: "Linked Client", email: "linked@example.com" });
    expect(client.status).toBe(201);
    const link = await request(app).post(`/api/v1/portal-registrations/${orgId}/link`).set("Authorization", `Bearer ${agencyToken}`).send({ clientId: client.body.data.client.id });
    expect(link.status).toBe(200);
    expect((await request(app).get("/api/v1/portal/dashboard").set("Authorization", `Bearer ${portalToken}`)).status).toBe(200);
    const after = await request(app).get("/api/v1/portal-registrations").set("Authorization", `Bearer ${agencyToken}`);
    expect(after.body.data.registrations.some((r: { organizationId: string }) => r.organizationId === orgId)).toBe(false);

    const second = await register("pending2@example.com");
    const rej = await request(app).post(`/api/v1/portal-registrations/${second.body.data.user.organizationId}/reject`).set("Authorization", `Bearer ${agencyToken}`).send();
    expect(rej.status).toBe(200);
    expect((await request(app).get("/api/v1/auth/me").set("Authorization", `Bearer ${second.body.data.session.token}`)).status).toBe(401);
  });
});
