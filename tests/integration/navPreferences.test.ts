/** Sidebar preferences — real DB. Test data tagged QA_TEST_2026_. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp, finalizeApp } from "../../server/app/app";
import { disconnectPrisma, prisma } from "../../server/db/prisma";
import { resetDb } from "../helpers/db";

describe("nav preferences", () => {
  const app = createApp();
  finalizeApp(app);
  let tokenA = "";
  let tokenB = "";
  let orgA = "";
  let ip = 60;
  const call = (method: "get" | "put" | "post", path: string, token: string, body?: object) => {
    const r = request(app)[method](`/api/v1${path}`).set("Authorization", `Bearer ${token}`).set("X-Forwarded-For", `10.6.0.${ip++}`);
    return method === "get" ? r : r.send(body ?? {});
  };

  beforeAll(async () => {
    await resetDb();
    const a = await request(app).post("/api/v1/auth/register").set("X-Forwarded-For", "10.6.0.1").send({ email: "qa-nav-a@example.com", password: "Str0ng-Passphrase-77", firstName: "QA", lastName: "A", organizationName: "QA_TEST_2026_ Nav A" });
    tokenA = a.body.data.session.token;
    orgA = a.body.data.user.organizationId;
    const b = await request(app).post("/api/v1/auth/register").set("X-Forwarded-For", "10.6.0.2").send({ email: "qa-nav-b@example.com", password: "Str0ng-Passphrase-77", firstName: "QA", lastName: "B", organizationName: "QA_TEST_2026_ Nav B" });
    tokenB = b.body.data.session.token;
  });
  afterAll(async () => {
    await disconnectPrisma();
  });

  it("requires a session", async () => {
    expect((await request(app).get("/api/v1/nav/preferences")).status).toBe(401);
  });

  it("defaults to expanded sidebar and no pins", async () => {
    const res = await call("get", "/nav/preferences", tokenA);
    expect(res.status).toBe(200);
    expect(res.body.data.preferences).toEqual({ railCollapsed: false, pinned: [] });
  });

  it("persists rail state and an ordered pin list, replacing it wholesale", async () => {
    expect((await call("put", "/nav/preferences", tokenA, { railCollapsed: true })).body.data.preferences).toEqual({ railCollapsed: true, pinned: [] });
    const set = await call("put", "/nav/preferences", tokenA, { pinned: ["approvals", "my-work", "crm-leads"] });
    expect(set.body.data.preferences).toEqual({ railCollapsed: true, pinned: ["approvals", "my-work", "crm-leads"] });
    const reordered = await call("put", "/nav/preferences", tokenA, { pinned: ["crm-leads", "approvals"] });
    expect(reordered.body.data.preferences.pinned).toEqual(["crm-leads", "approvals"]);
    expect(reordered.body.data.preferences.railCollapsed).toBe(true);
    expect((await call("get", "/nav/preferences", tokenA)).body.data.preferences.pinned).toEqual(["crm-leads", "approvals"]);
  });

  it("validates: max 8, unique, safe ids, non-empty body", async () => {
    const nine = Array.from({ length: 9 }, (_, i) => `item-${i}`);
    expect((await call("put", "/nav/preferences", tokenA, { pinned: nine })).status).toBe(400);
    expect((await call("put", "/nav/preferences", tokenA, { pinned: ["a", "a"] })).status).toBe(400);
    expect((await call("put", "/nav/preferences", tokenA, { pinned: ["Bad Id!"] })).status).toBe(400);
    expect((await call("put", "/nav/preferences", tokenA, {})).status).toBe(400);
    const eight = Array.from({ length: 8 }, (_, i) => `item-${i}`);
    expect((await call("put", "/nav/preferences", tokenA, { pinned: eight })).status).toBe(200);
  });

  it("is isolated per user, and pins are per workspace (rail state is per user)", async () => {
    expect((await call("get", "/nav/preferences", tokenB)).body.data.preferences).toEqual({ railCollapsed: false, pinned: [] });
    // a second workspace for user A: membership + switch
    const second = await prisma.organization.create({ data: { name: "QA_TEST_2026_ Nav A2", slug: "qa-test-2026-nav-a2", type: "CLIENT", status: "ACTIVE" } });
    const userA = await prisma.user.findFirst({ where: { email: "qa-nav-a@example.com" } });
    const membership = await prisma.organizationMembership.findFirst({ where: { userId: userA!.id, organizationId: orgA } });
    await prisma.organizationMembership.create({ data: { userId: userA!.id, organizationId: second.id, roleId: membership!.roleId, status: "ACTIVE" } });
    const sw = await call("post", "/auth/switch-organization", tokenA, { organizationId: second.id });
    expect(sw.status).toBe(200);
    const tokenA2 = sw.body.data.session.token as string;
    const inSecond = (await call("get", "/nav/preferences", tokenA2)).body.data.preferences;
    expect(inSecond.pinned).toEqual([]); // pins don't leak across workspaces…
    expect(inSecond.railCollapsed).toBe(true); // …but rail state follows the user
    await call("put", "/nav/preferences", tokenA2, { pinned: ["approvals"] });
    expect((await prisma.userNavPin.count({ where: { userId: userA!.id } }))).toBe(8 + 1);
  });
});
