/**
 * Phase 18: AI Control Center honesty, limits, health and permission boundaries.
 * The test env has no AI provider configured, so every assertion here also
 * proves that nothing is fabricated when credentials are absent.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp, finalizeApp } from "../../server/app/app";
import { disconnectPrisma, prisma } from "../../server/db/prisma";
import { resetDb } from "../helpers/db";
import { EmbeddingService } from "../../server/services/knowledge/EmbeddingService";
import { AdapterFactory } from "../../server/ai/adapters/adapterFactory";

describe("Phase 18 AI Control Center", () => {
  const app = createApp();
  finalizeApp(app);
  let token: string;
  let orgId: string;
  let otherToken: string;

  beforeAll(async () => {
    await resetDb();
    const reg = await request(app).post("/api/v1/auth/register").send({
      email: "ai18-admin@example.com", password: "OriginalPassword123", firstName: "Ai", lastName: "Admin", organizationName: "Ai18 Co",
    });
    token = reg.body.data.session.token;
    orgId = reg.body.data.user.organizationId;
    const reg2 = await request(app).post("/api/v1/auth/register").send({
      email: "ai18-other@example.com", password: "OriginalPassword123", firstName: "Other", lastName: "Admin", organizationName: "Other Co",
    });
    otherToken = reg2.body.data.session.token;
  });

  afterAll(async () => {
    await disconnectPrisma();
  });

  it("requires authentication for health and limits", async () => {
    expect((await request(app).get("/api/v1/ai/health")).status).toBe(401);
    expect((await request(app).put("/api/v1/ai/limits").send({ dailyRequests: 1, dailyTokens: 0 })).status).toBe(401);
  });

  it("reports provider as not configured and never returns secrets", async () => {
    const res = await request(app).get("/api/v1/ai/health").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    const h = res.body.data.health;
    expect(h.provider.configured).toBe(false);
    expect(h.provider.label).toBe("Not configured");
    expect(h.provider.capabilities.copilot).toBe(false);
    expect(h.knowledge.retrievalMode).toBeDefined();
    expect(JSON.stringify(h)).not.toMatch(/apikey|api_key|secret/i);
  });

  it("validates and audits limit updates, and enforces them on Copilot", async () => {
    const bad = await request(app).put("/api/v1/ai/limits").set("Authorization", `Bearer ${token}`).send({ dailyRequests: -1, dailyTokens: 0 });
    expect(bad.status).toBe(400);

    const ok = await request(app).put("/api/v1/ai/limits").set("Authorization", `Bearer ${token}`).send({ dailyRequests: 1, dailyTokens: 0 });
    expect(ok.status).toBe(200);
    const audit = await prisma.auditLog.findFirst({ where: { organizationId: orgId, action: "AI_LIMITS_UPDATED" } });
    expect(audit).toBeTruthy();

    const conv = await request(app).post("/api/v1/copilot/conversations").set("Authorization", `Bearer ${token}`).send({});
    const conversationId = conv.body.data.conversation.id;
    // First request is recorded as FAILED (no provider) so it does not consume the successful-usage quota.
    const first = await request(app).post("/api/v1/copilot/messages").set("Authorization", `Bearer ${token}`).send({ conversationId, content: "hello" });
    expect(first.status).toBe(200);
    expect(first.body.data.assistantMessage.status).toBe("FAILED");
    expect(first.body.data.assistantMessage.estimatedCost).toBe(0);

    // Seed one real successful usage row for today to reach the cap.
    const msg = first.body.data.assistantMessage;
    await prisma.copilotUsage.create({
      data: {
        organizationId: orgId, userId: (await prisma.user.findFirst({ where: { email: "ai18-admin@example.com" } }))!.id,
        conversationId, messageId: msg.id, providerType: "gemini", modelName: "m", inputTokens: 1, outputTokens: 1, totalTokens: 2, durationMs: 1, estimatedCost: 0, status: "SUCCESS",
      },
    });
    const blocked = await request(app).post("/api/v1/copilot/messages").set("Authorization", `Bearer ${token}`).send({ conversationId, content: "again" });
    expect(blocked.status).toBe(429);
  });

  it("keeps health aggregates tenant-isolated", async () => {
    const res = await request(app).get("/api/v1/ai/health").set("Authorization", `Bearer ${otherToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.health.usage.copilotRequests).toBe(0);
    expect(res.body.data.health.limits.dailyRequests).toBe(0);
  });

  it("does not fabricate embeddings or adapters outside the test runner", async () => {
    expect(EmbeddingService.isAvailable()).toBe(true); // test runner only
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      expect(() => AdapterFactory.getAdapter("GEMINI")).toThrow(/not configured/i);
      expect(await EmbeddingService.tryGenerateEmbedding("x")).toBeNull();
    } finally {
      process.env.NODE_ENV = prev;
    }
  });
});
