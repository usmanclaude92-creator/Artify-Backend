/** Cross-site sign-in handoff: site (artifysols.com) -> Control Center, via a single-use 60s code. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp, finalizeApp } from "../../server/app/app";
import { disconnectPrisma, prisma } from "../../server/db/prisma";
import { resetDb } from "../helpers/db";

describe("auth handoff", () => {
  const app = createApp();
  finalizeApp(app);
  let adminToken = "";
  let portalToken = "";
  let ip = 20;
  const post = (path: string, body?: object, token?: string) => {
    const r = request(app).post(`/api/v1${path}`).set("X-Forwarded-For", `10.8.0.${ip++}`);
    if (token) r.set("Authorization", `Bearer ${token}`);
    return r.send(body ?? {});
  };

  beforeAll(async () => {
    await resetDb();
    const admin = await post("/auth/register", { email: "staff@example.com", password: "Str0ng-Passphrase-77", firstName: "St", lastName: "Aff", organizationName: "Staff Co" });
    adminToken = admin.body.data.session.token;
    const portal = await post("/auth/portal/register", { email: "client@example.com", password: "Str0ng-Passphrase-77", firstName: "Cl", lastName: "Ient", organizationName: "Client Co" });
    portalToken = portal.body.data.session.token;
  });
  afterAll(async () => {
    await disconnectPrisma();
  });

  it("requires authentication to request a code", async () => {
    expect((await post("/auth/handoff")).status).toBe(401);
  });

  it("issues a code to staff that is exchanged once for a NEW session", async () => {
    const issued = await post("/auth/handoff", {}, adminToken);
    expect(issued.status).toBe(200);
    const code: string = issued.body.data.code;
    expect(code).toMatch(/^art_handoff_/);

    const exchanged = await post("/auth/handoff/exchange", { code });
    expect(exchanged.status).toBe(200);
    expect(exchanged.body.data.user.email).toBe("staff@example.com");
    const newToken: string = exchanged.body.data.session.token;
    expect(newToken).not.toBe(adminToken);
    expect((await request(app).get("/api/v1/auth/me").set("Authorization", `Bearer ${newToken}`)).status).toBe(200);

    const reuse = await post("/auth/handoff/exchange", { code });
    expect(reuse.status).toBe(401);
  });

  it("is single-use even under concurrent exchanges", async () => {
    const { code } = (await post("/auth/handoff", {}, adminToken)).body.data;
    const results = await Promise.all([1, 2, 3, 4].map(() => post("/auth/handoff/exchange", { code })));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
  });

  it("rejects expired, unknown and malformed codes with the same generic error", async () => {
    const { code } = (await post("/auth/handoff", {}, adminToken)).body.data;
    await prisma.authHandoffCode.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    const expired = await post("/auth/handoff/exchange", { code });
    const unknown = await post("/auth/handoff/exchange", { code: "art_handoff_nope" });
    expect(expired.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(expired.body.error.message).toBe(unknown.body.error.message);
    expect((await post("/auth/handoff/exchange", {})).status).toBe(400);
  });

  it("never issues a code to client-portal accounts", async () => {
    expect((await post("/auth/handoff", {}, portalToken)).status).toBe(403);
  });

  it("does not exchange for a disabled user", async () => {
    const { code } = (await post("/auth/handoff", {}, adminToken)).body.data;
    await prisma.user.updateMany({ where: { email: "staff@example.com" }, data: { status: "DISABLED" } });
    expect((await post("/auth/handoff/exchange", { code })).status).toBe(401);
    await prisma.user.updateMany({ where: { email: "staff@example.com" }, data: { status: "ACTIVE" } });
  });
});
