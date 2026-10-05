import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp, finalizeApp } from "../../server/app/app";
import { disconnectPrisma } from "../../server/db/prisma";

describe("public API cache headers", () => {
  const app = createApp();
  finalizeApp(app);
  afterAll(async () => {
    await disconnectPrisma();
  });

  it("sets shared-cache headers on GET and keys the cache by Origin", async () => {
    const res = await request(app).get("/api/v1/public/site").set("Origin", "http://localhost:3000");
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("public, s-maxage=60, stale-while-revalidate=300");
    expect(res.headers["vary"]).toMatch(/Origin/i);
  });

  it("never caches the public write endpoints", async () => {
    const res = await request(app).post("/api/v1/public/leads").send({});
    expect(res.headers["cache-control"] ?? "").not.toMatch(/s-maxage/);
  });

  it("rejects a disallowed origin with 403, not 500", async () => {
    const res = await request(app).get("/api/v1/public/site").set("Origin", "https://evil.example");
    expect(res.status).toBe(403);
  });
});
