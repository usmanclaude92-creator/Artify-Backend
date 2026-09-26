/**
 * Phase 14: Enterprise Knowledge, Document Intelligence & RAG — HTTP layer
 * (imported from usmanclaude92-creator/Artify-Backend---Google-AI-Studio-,
 * commit 4a1d7cd). server/routes/v1/knowledgeRoutes.ts was rewritten from
 * the source's raw try/catch handlers to this repo's asyncHandler +
 * sendSuccess convention — this exercises that route layer end to end
 * (permission gates, upload, search, tenant isolation), complementing
 * tests/unit/knowledge/knowledgeService.test.ts's direct service-level
 * coverage.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp, finalizeApp } from "../../server/app/app";
import { disconnectPrisma } from "../../server/db/prisma";
import { resetDb } from "../helpers/db";

describe("Knowledge routes", () => {
  const app = createApp();
  finalizeApp(app);

  let adminToken: string;
  let otherOrgAdminToken: string;
  let collectionId: string;

  beforeAll(async () => {
    await resetDb();

    const reg = await request(app).post("/api/v1/auth/register").send({
      email: "knowledge-routes-admin@example.com",
      password: "OriginalPassword123",
      firstName: "KR",
      lastName: "Admin",
      organizationName: "Knowledge Routes Co",
    });
    adminToken = reg.body.data.session.token;

    const otherReg = await request(app).post("/api/v1/auth/register").send({
      email: "knowledge-routes-other@example.com",
      password: "OriginalPassword123",
      firstName: "Other",
      lastName: "Admin",
      organizationName: "Other Knowledge Routes Co",
    });
    otherOrgAdminToken = otherReg.body.data.session.token;
  });

  afterAll(async () => {
    await disconnectPrisma();
  });

  it("rejects collection creation without knowledge.create permission", async () => {
    const viewerRes = await request(app)
      .post("/api/v1/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ email: "knowledge-routes-viewer@example.com", password: "UserPassword123", firstName: "V", lastName: "Wr", roleKey: "VIEWER" });
    expect(viewerRes.status).toBe(201);
    const viewerToken = (
      await request(app).post("/api/v1/auth/login").send({ email: "knowledge-routes-viewer@example.com", password: "UserPassword123" })
    ).body.data.session.token;

    const res = await request(app)
      .post("/api/v1/knowledge/collections")
      .set("Authorization", `Bearer ${viewerToken}`)
      .send({ name: "Viewer Attempt" });
    expect(res.status).toBe(403);
  });

  it("creates a collection and uploads a document via the base64 upload endpoint", async () => {
    const colRes = await request(app)
      .post("/api/v1/knowledge/collections")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Onboarding Docs", accessPolicy: "PUBLIC" });
    expect(colRes.status).toBe(201);
    collectionId = colRes.body.data.collection.id;

    const text = "New hires must complete security training within 7 days of their start date.";
    const uploadRes = await request(app)
      .post("/api/v1/knowledge/documents/upload")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        contentBase64: Buffer.from(text, "utf8").toString("base64"),
        mimeType: "text/plain",
        filename: "onboarding.txt",
        title: "New Hire Security Training",
        collectionId,
      });

    expect(uploadRes.status).toBe(201);
    expect(uploadRes.body.data.documentId).toBeDefined();
    expect(uploadRes.body.data.status).toBe("INDEXED");
  });

  it("searches indexed content and returns citations-ready results", async () => {
    const res = await request(app)
      .post("/api/v1/knowledge/search")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ query: "security training new hires" });

    expect(res.status).toBe(200);
    expect(res.body.data.results.length).toBeGreaterThan(0);
    expect(res.body.data.results[0].documentTitle).toBe("New Hire Security Training");
  });

  it("enforces tenant isolation: another organization sees no collections or documents", async () => {
    const res = await request(app)
      .get("/api/v1/knowledge/collections")
      .set("Authorization", `Bearer ${otherOrgAdminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.collections).toHaveLength(0);

    const searchRes = await request(app)
      .post("/api/v1/knowledge/search")
      .set("Authorization", `Bearer ${otherOrgAdminToken}`)
      .send({ query: "security training new hires" });
    expect(searchRes.body.data.results).toHaveLength(0);
  });

  it("reindexes a document on demand", async () => {
    const docsRes = await request(app)
      .get("/api/v1/knowledge/documents")
      .set("Authorization", `Bearer ${adminToken}`)
      .query({ collectionId });
    const documentId = docsRes.body.data.documents[0].id;

    const res = await request(app)
      .post(`/api/v1/knowledge/documents/${documentId}/reindex`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });
});
