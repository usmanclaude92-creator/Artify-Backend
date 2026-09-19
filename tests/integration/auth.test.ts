import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp, finalizeApp } from "../../server/app/app";
import { disconnectPrisma, prisma } from "../../server/db/prisma";
import { resetDb } from "../helpers/db";

describe("auth foundation (real Postgres — Phase 1 §17)", () => {
  const app = createApp();
  finalizeApp(app);

  beforeAll(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await resetDb();
    await disconnectPrisma();
  });

  const testUser = {
    email: "integration-test-user@example.com",
    password: "CorrectHorseBatteryStaple123",
    fullName: "Integration Test User",
    companyName: "Integration Test Co",
  };

  it("registers a new tenant + admin user atomically and stores a bcrypt hash, not plaintext or SHA-256", async () => {
    const res = await request(app).post("/api/v1/auth/register").send(testUser);

    expect(res.status).toBe(201);
    expect(res.body.data.session.token).toMatch(/^art_sess_/);
    expect(res.body.data.user.email).toBe(testUser.email);
    expect(res.body.data.user).not.toHaveProperty("passwordHash");

    const dbUser = await prisma.user.findUniqueOrThrow({ where: { email: testUser.email } });
    expect(dbUser.passwordHash.startsWith("$2")).toBe(true);
    expect(dbUser.passwordHash).not.toBe(testUser.password);
  });

  it("rejects registering the same email twice", async () => {
    const res = await request(app).post("/api/v1/auth/register").send(testUser);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("RESOURCE_CONFLICT");
  });

  it("rejects login with the wrong password using a generic message (no user-enumeration leak)", async () => {
    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: testUser.email, password: "totally-wrong-password" });
    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe("Invalid email or password credentials.");
  });

  it("rejects login for a nonexistent email with the exact same generic message", async () => {
    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "nobody-here@example.com", password: "whatever123" });
    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe("Invalid email or password credentials.");
  });

  it("logs in with correct credentials and issues a real, verifiable session", async () => {
    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: testUser.email, password: testUser.password });
    expect(res.status).toBe(200);
    expect(res.body.data.session.token).toMatch(/^art_sess_/);

    const dbSession = await prisma.session.findUnique({ where: { token: res.body.data.session.token } });
    expect(dbSession).not.toBeNull();
    expect(dbSession?.revokedAt).toBeNull();
  });

  it("rejects GET /auth/me with no token", async () => {
    const res = await request(app).get("/api/v1/auth/me");
    expect(res.status).toBe(401);
  });

  it("rejects GET /auth/me with a garbage token", async () => {
    const res = await request(app).get("/api/v1/auth/me").set("Authorization", "Bearer not-a-real-token");
    expect(res.status).toBe(401);
  });

  it("accepts GET /auth/me with a valid session token and returns the sanitized user", async () => {
    const login = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: testUser.email, password: testUser.password });
    const token = login.body.data.session.token;

    const res = await request(app).get("/api/v1/auth/me").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toBe(testUser.email);
  });

  it("locks the account after 5 consecutive failed logins", async () => {
    const email = "lockout-test@example.com";
    await request(app).post("/api/v1/auth/register").send({ ...testUser, email });

    for (let i = 0; i < 5; i++) {
      await request(app).post("/api/v1/auth/login").send({ email, password: "wrong-password" });
    }

    const res = await request(app).post("/api/v1/auth/login").send({ email, password: testUser.password });
    expect(res.status).toBe(401);
    expect(res.body.error.message).toMatch(/temporarily locked/i);
  });

  it("revokes the session on logout — a subsequent /me with the same token is rejected", async () => {
    const email = "logout-test@example.com";
    await request(app).post("/api/v1/auth/register").send({ ...testUser, email });
    const login = await request(app).post("/api/v1/auth/login").send({ email, password: testUser.password });
    const token = login.body.data.session.token;

    const logoutRes = await request(app).post("/api/v1/auth/logout").set("Authorization", `Bearer ${token}`);
    expect(logoutRes.status).toBe(200);

    const meRes = await request(app).get("/api/v1/auth/me").set("Authorization", `Bearer ${token}`);
    expect(meRes.status).toBe(401);
  });
});

describe("auth input validation", () => {
  const app = createApp();
  finalizeApp(app);

  afterAll(async () => {
    await disconnectPrisma();
  });

  it("rejects registration with a password shorter than the minimum length", async () => {
    const res = await request(app).post("/api/v1/auth/register").send({
      email: "short-pw@example.com",
      password: "short",
      fullName: "Someone",
      companyName: "Some Co",
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects registration with a malformed email", async () => {
    const res = await request(app).post("/api/v1/auth/register").send({
      email: "not-an-email",
      password: "SomeValidPassword123",
      fullName: "Someone",
      companyName: "Some Co",
    });
    expect(res.status).toBe(400);
  });
});
