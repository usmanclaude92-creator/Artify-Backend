/** Phase 12 §31 — AI provider/model catalog, tool catalog + org settings, prompt templates: CRUD, permissions, versioning/publish. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp, finalizeApp } from "../../server/app/app";
import { disconnectPrisma } from "../../server/db/prisma";
import { resetDb } from "../helpers/db";

describe("AI catalog (providers, models, tools, prompt templates)", () => {
  const app = createApp();
  finalizeApp(app);

  let adminToken: string;
  let managerToken: string;
  let viewerToken: string;

  beforeAll(async () => {
    await resetDb();
    const reg = await request(app).post("/api/v1/auth/register").send({
      email: "ai-catalog-admin@example.com",
      password: "OriginalPassword123",
      firstName: "AI",
      lastName: "Admin",
      organizationName: "AI Catalog Co",
    });
    adminToken = reg.body.data.session.token;

    await request(app)
      .post("/api/v1/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ email: "ai-catalog-manager@example.com", password: "ManagerPassword123", firstName: "M", lastName: "W", roleKey: "MANAGER" });
    managerToken = (await request(app).post("/api/v1/auth/login").send({ email: "ai-catalog-manager@example.com", password: "ManagerPassword123" })).body
      .data.session.token;

    await request(app)
      .post("/api/v1/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ email: "ai-catalog-viewer@example.com", password: "ViewerPassword123", firstName: "V", lastName: "W", roleKey: "VIEWER" });
    viewerToken = (await request(app).post("/api/v1/auth/login").send({ email: "ai-catalog-viewer@example.com", password: "ViewerPassword123" })).body.data
      .session.token;
  });

  afterAll(async () => {
    await disconnectPrisma();
  });

  describe("providers & models", () => {
    it("lets an ADMIN create a provider, but denies a MANAGER and a VIEWER", async () => {
      const managerAttempt = await request(app)
        .post("/api/v1/ai/providers")
        .set("Authorization", `Bearer ${managerToken}`)
        .send({ code: "test-provider", name: "Test Provider" });
      expect(managerAttempt.status).toBe(403);

      const viewerAttempt = await request(app)
        .post("/api/v1/ai/providers")
        .set("Authorization", `Bearer ${viewerToken}`)
        .send({ code: "test-provider", name: "Test Provider" });
      expect(viewerAttempt.status).toBe(403);

      const res = await request(app)
        .post("/api/v1/ai/providers")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ code: "test-provider", name: "Test Provider", status: "ACTIVE" });
      expect(res.status).toBe(201);
      expect(res.body.data.provider.code).toBe("test-provider");
    });

    it("rejects a duplicate provider code", async () => {
      const res = await request(app)
        .post("/api/v1/ai/providers")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ code: "test-provider", name: "Duplicate" });
      expect(res.status).toBe(409);
    });

    it("lets a VIEWER read the provider catalog (read-only)", async () => {
      const res = await request(app).get("/api/v1/ai/providers").set("Authorization", `Bearer ${viewerToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.providers.length).toBeGreaterThan(0);
    });

    it("creates a model under a provider and enforces model-manage permission", async () => {
      const providers = await request(app).get("/api/v1/ai/providers").set("Authorization", `Bearer ${adminToken}`);
      const providerId = providers.body.data.providers.find((p: { code: string }) => p.code === "test-provider").id;

      const denied = await request(app)
        .post("/api/v1/ai/providers/models")
        .set("Authorization", `Bearer ${managerToken}`)
        .send({ providerId, modelId: "test-model-1", displayName: "Test Model 1" });
      expect(denied.status).toBe(403);

      const res = await request(app)
        .post("/api/v1/ai/providers/models")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ providerId, modelId: "test-model-1", displayName: "Test Model 1" });
      expect(res.status).toBe(201);
      expect(res.body.data.model.providerId).toBe(providerId);
    });
  });

  describe("tool catalog & org settings", () => {
    it("lists the platform tool catalog with this org's effective enablement (enabled by default)", async () => {
      const res = await request(app).get("/api/v1/ai/tools").set("Authorization", `Bearer ${viewerToken}`);
      expect(res.status).toBe(200);
      const leadsList = res.body.data.tools.find((t: { code: string }) => t.code === "leads.list");
      expect(leadsList.orgEnabled).toBe(true);
      const issueInvoice = res.body.data.tools.find((t: { code: string }) => t.code === "invoices.issue");
      expect(issueInvoice.riskLevel).toBe("HIGH");
      expect(issueInvoice.requiresApproval).toBe(true);
    });

    it("denies a MANAGER from disabling a tool for the org, but allows an ADMIN", async () => {
      const denied = await request(app)
        .patch("/api/v1/ai/tools/leads.create/settings")
        .set("Authorization", `Bearer ${managerToken}`)
        .send({ enabled: false });
      expect(denied.status).toBe(403);

      const res = await request(app)
        .patch("/api/v1/ai/tools/leads.create/settings")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ enabled: false });
      expect(res.status).toBe(200);
      expect(res.body.data.setting.enabled).toBe(false);

      const list = await request(app).get("/api/v1/ai/tools").set("Authorization", `Bearer ${adminToken}`);
      expect(list.body.data.tools.find((t: { code: string }) => t.code === "leads.create").orgEnabled).toBe(false);

      // Restore for later tests in other files that rely on the default.
      await request(app).patch("/api/v1/ai/tools/leads.create/settings").set("Authorization", `Bearer ${adminToken}`).send({ enabled: true });
    });

    it("404s for an unknown tool code", async () => {
      const res = await request(app).patch("/api/v1/ai/tools/not.a.real.tool/settings").set("Authorization", `Bearer ${adminToken}`).send({ enabled: false });
      expect(res.status).toBe(404);
    });
  });

  describe("prompt templates", () => {
    let templateId: string;

    it("lets a MANAGER create a prompt template (starts as v1/DRAFT), denies a VIEWER", async () => {
      const denied = await request(app)
        .post("/api/v1/ai/prompts")
        .set("Authorization", `Bearer ${viewerToken}`)
        .send({ key: "lead-triage", name: "Lead Triage", systemInstructions: "You triage leads.", userTemplate: "Triage: {{lead}}" });
      expect(denied.status).toBe(403);

      const res = await request(app)
        .post("/api/v1/ai/prompts")
        .set("Authorization", `Bearer ${managerToken}`)
        .send({ key: "lead-triage", name: "Lead Triage", systemInstructions: "You triage leads.", userTemplate: "Triage: {{lead}}" });
      expect(res.status).toBe(201);
      expect(res.body.data.promptTemplate.status).toBe("DRAFT");
      expect(res.body.data.promptTemplate.currentVersion.version).toBe(1);
      templateId = res.body.data.promptTemplate.id;
    });

    it("rejects a duplicate key within the same organization", async () => {
      const res = await request(app)
        .post("/api/v1/ai/prompts")
        .set("Authorization", `Bearer ${managerToken}`)
        .send({ key: "lead-triage", name: "Dup", systemInstructions: "x", userTemplate: "y" });
      expect(res.status).toBe(409);
    });

    it("creates a new immutable version and publishes it, activating the template", async () => {
      const version = await request(app)
        .post(`/api/v1/ai/prompts/${templateId}/versions`)
        .set("Authorization", `Bearer ${managerToken}`)
        .send({ systemInstructions: "You triage leads, v2.", userTemplate: "Triage v2: {{lead}}" });
      expect(version.status).toBe(201);
      expect(version.body.data.version.version).toBe(2);

      const publish = await request(app)
        .post(`/api/v1/ai/prompts/${templateId}/publish`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ versionId: version.body.data.version.id });
      expect(publish.status).toBe(200);
      expect(publish.body.data.promptTemplate.status).toBe("ACTIVE");
      expect(publish.body.data.promptTemplate.currentVersion.version).toBe(2);
    });

    it("rejects publishing a versionId that belongs to a different template", async () => {
      const other = await request(app)
        .post("/api/v1/ai/prompts")
        .set("Authorization", `Bearer ${managerToken}`)
        .send({ key: "other-template", name: "Other", systemInstructions: "x", userTemplate: "y" });
      const otherVersionId = other.body.data.promptTemplate.currentVersion.id;

      const res = await request(app)
        .post(`/api/v1/ai/prompts/${templateId}/publish`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ versionId: otherVersionId });
      expect(res.status).toBe(400);
    });

    it("archives (soft-deletes) a template", async () => {
      const res = await request(app).delete(`/api/v1/ai/prompts/${templateId}`).set("Authorization", `Bearer ${adminToken}`);
      expect(res.status).toBe(200);

      const fetched = await request(app).get(`/api/v1/ai/prompts/${templateId}`).set("Authorization", `Bearer ${adminToken}`);
      expect(fetched.body.data.promptTemplate.status).toBe("ARCHIVED");
    });
  });
});
