import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp, finalizeApp } from "../../server/app/app";
import { disconnectPrisma } from "../../server/db/prisma";

describe("liveness and readiness (Phase 1 §10 — real DB checks, no fake status)", () => {
  const app = createApp();
  finalizeApp(app);

  afterAll(async () => {
    await disconnectPrisma();
  });

  it("GET /api/v1/system/live returns 200 without touching the database", async () => {
    const res = await request(app).get("/api/v1/system/live");
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("alive");
  });

  it("GET /api/v1/system/ready returns 200 and reports a real, healthy Postgres dependency", async () => {
    const res = await request(app).get("/api/v1/system/ready");
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("ready");
    const dbDep = res.body.data.dependencies.find((d: { name: string }) => d.name === "postgresql");
    expect(dbDep).toBeDefined();
    expect(dbDep.healthy).toBe(true);
    expect(typeof dbDep.latencyMs).toBe("number");
  });

  it("every response carries a correlation request id header (Phase 1 §13)", async () => {
    const res = await request(app).get("/api/v1/system/live");
    expect(res.headers["x-request-id"]).toBeTruthy();
  });

  it("returns a standard 404 envelope for an unknown /api route, not a leaked stack trace", async () => {
    const res = await request(app).get("/api/v1/does-not-exist");
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("RESOURCE_NOT_FOUND");
  });
});
