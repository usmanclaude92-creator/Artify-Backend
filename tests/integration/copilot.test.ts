/**
 * Phase 15: AI Copilot & Conversational Workspace (imported from
 * usmanclaude92-creator/Artify-Backend---Google-AI-Studio-, commit
 * 4a1d7cd). Exercises the adaptation points made during import: the
 * `confirmAction` path re-pointed at this repo's own `clientService`
 * instead of the excluded parallel AI Control Center stack, permission
 * gating on workspaces/messages/actions, and tenant isolation.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp, finalizeApp } from "../../server/app/app";
import { disconnectPrisma, prisma } from "../../server/db/prisma";
import { resetDb } from "../helpers/db";

describe("Copilot workspaces, conversations, actions", () => {
  const app = createApp();
  finalizeApp(app);

  let adminToken: string;
  let orgId: string;
  let clientId: string;

  beforeAll(async () => {
    await resetDb();

    const reg = await request(app).post("/api/v1/auth/register").send({
      email: "copilot-admin@example.com",
      password: "OriginalPassword123",
      firstName: "Copilot",
      lastName: "Admin",
      organizationName: "Copilot Co",
    });
    adminToken = reg.body.data.session.token;
    orgId = reg.body.data.user.organizationId;

    const clientRes = await request(app)
      .post("/api/v1/clients")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ clientCode: "COPILOT-TGT", name: "Copilot Target Client", email: "copilot-client@example.com" });
    clientId = clientRes.body.data.client.id;
  });

  afterAll(async () => {
    await disconnectPrisma();
  });

  it("auto-seeds and lists the default workspaces on first access", async () => {
    const res = await request(app).get("/api/v1/copilot/workspaces").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.workspaces.length).toBeGreaterThan(0);
  });

  it("creates a conversation, auto-assigning the default workspace when none is given", async () => {
    const res = await request(app)
      .post("/api/v1/copilot/conversations")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ title: "Test Conversation" });
    expect(res.status).toBe(201);
    expect(res.body.data.conversation.workspaceId).toBeTruthy();
    expect(res.body.data.conversation.title).toBe("Test Conversation");
  });

  it("sends a message and falls back gracefully when the AI provider is unavailable (test env AI_PROVIDER=none)", async () => {
    const convRes = await request(app)
      .post("/api/v1/copilot/conversations")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({});
    const conversationId = convRes.body.data.conversation.id;

    const res = await request(app)
      .post("/api/v1/copilot/messages")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ conversationId, content: "What is the status of our account?" });

    expect(res.status).toBe(200);
    expect(res.body.data.assistantMessage.content.length).toBeGreaterThan(0);
    expect(res.body.data.assistantMessage.status).toBe("COMPLETED");
  });

  it("rejects sending an empty message", async () => {
    const res = await request(app)
      .post("/api/v1/copilot/messages")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ content: "   " });
    expect(res.status).toBe(400);
  });

  it("confirms a pending modifyClientStatus action preview through this repo's real clientService", async () => {
    const convRes = await request(app)
      .post("/api/v1/copilot/conversations")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({});
    const conversationId = convRes.body.data.conversation.id;

    const preview = await prisma.copilotActionPreview.create({
      data: {
        organizationId: orgId,
        conversationId,
        toolName: "modifyClientStatus",
        actionType: "UPDATE_CLIENT_STATUS",
        targetEntity: clientId,
        changesSummary: "Suspend client account",
        parameters: { clientId, newStatus: "SUSPENDED" },
        riskLevel: "MEDIUM",
        status: "PENDING",
      },
    });

    const res = await request(app)
      .post(`/api/v1/copilot/actions/${preview.id}/confirm`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.data.success).toBe(true);
    expect(res.body.data.preview.status).toBe("EXECUTED");

    const clientRes = await request(app)
      .get(`/api/v1/clients/${clientId}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(clientRes.body.data.client.status).toBe("SUSPENDED");
  });

  it("rejects confirming an action preview without the required permission", async () => {
    await request(app)
      .post("/api/v1/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ email: "copilot-viewer@example.com", password: "UserPassword123", firstName: "V", lastName: "Wr", roleKey: "VIEWER" });
    const viewerToken = (
      await request(app).post("/api/v1/auth/login").send({ email: "copilot-viewer@example.com", password: "UserPassword123" })
    ).body.data.session.token;

    const convRes = await request(app)
      .post("/api/v1/copilot/conversations")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({});
    const conversationId = convRes.body.data.conversation.id;

    const preview = await prisma.copilotActionPreview.create({
      data: {
        organizationId: orgId,
        conversationId,
        toolName: "modifyClientStatus",
        actionType: "UPDATE_CLIENT_STATUS",
        targetEntity: clientId,
        changesSummary: "Archive client account",
        parameters: { clientId, newStatus: "ARCHIVED" },
        riskLevel: "MEDIUM",
        status: "PENDING",
      },
    });

    const res = await request(app)
      .post(`/api/v1/copilot/actions/${preview.id}/confirm`)
      .set("Authorization", `Bearer ${viewerToken}`)
      .send({});
    expect(res.status).toBe(403);
  });

  it("enforces tenant isolation: another organization cannot see or act on these conversations", async () => {
    const otherReg = await request(app).post("/api/v1/auth/register").send({
      email: "copilot-other-admin@example.com",
      password: "OriginalPassword123",
      firstName: "Other",
      lastName: "Admin",
      organizationName: "Other Copilot Co",
    });
    const otherToken = otherReg.body.data.session.token;

    const res = await request(app)
      .get("/api/v1/copilot/conversations")
      .set("Authorization", `Bearer ${otherToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.conversations).toHaveLength(0);
  });

  it("reports dashboard metrics for the organization", async () => {
    const res = await request(app).get("/api/v1/copilot/dashboard").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
  });
});
