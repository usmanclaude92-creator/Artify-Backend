/** Phase 11 — case study CRUD, workflow, content relationships (Product/Page/Post/Industry), relationship validation, IDOR, permissions, tenant isolation. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp, finalizeApp } from "../../server/app/app";
import { disconnectPrisma, prisma } from "../../server/db/prisma";
import { resetDb } from "../helpers/db";

describe("Case studies", () => {
  const app = createApp();
  finalizeApp(app);

  let adminToken: string;
  let viewerToken: string;
  let otherOrgAdminToken: string;
  let productId: string;
  let industryId: string;
  let pageId: string;
  let postId: string;
  let otherOrgPageId: string;
  let otherOrgPostId: string;

  beforeAll(async () => {
    await resetDb();
    const reg = await request(app).post("/api/v1/auth/register").send({
      email: "casestudy-admin@example.com",
      password: "OriginalPassword123",
      firstName: "Case",
      lastName: "Admin",
      organizationName: "Case Study Co",
    });
    adminToken = reg.body.data.session.token;

    await request(app)
      .post("/api/v1/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ email: "casestudy-viewer@example.com", password: "ViewerPassword123", firstName: "V", lastName: "W", roleKey: "VIEWER" });
    viewerToken = (await request(app).post("/api/v1/auth/login").send({ email: "casestudy-viewer@example.com", password: "ViewerPassword123" })).body
      .data.session.token;

    const otherOrg = await request(app).post("/api/v1/auth/register").send({
      email: "casestudy-other-admin@example.com",
      password: "OriginalPassword123",
      firstName: "Other",
      lastName: "Admin",
      organizationName: "Other Case Study Org",
    });
    otherOrgAdminToken = otherOrg.body.data.session.token;

    const product = await request(app)
      .post("/api/v1/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ code: "CS-PROD-01", name: "Zero-Touch Close", type: "SOLUTION" });
    productId = product.body.data.product.id;

    const industry = await request(app).post("/api/v1/industries").set("Authorization", `Bearer ${adminToken}`).send({ name: "Finance & Accounting" });
    industryId = industry.body.data.industry.id;

    const page = await request(app).post("/api/v1/pages").set("Authorization", `Bearer ${adminToken}`).send({ title: "Related Page" });
    pageId = page.body.data.page.id;

    const post = await request(app).post("/api/v1/posts").set("Authorization", `Bearer ${adminToken}`).send({ title: "Related Post" });
    postId = post.body.data.post.id;

    const otherPage = await request(app).post("/api/v1/pages").set("Authorization", `Bearer ${otherOrgAdminToken}`).send({ title: "Foreign Page" });
    otherOrgPageId = otherPage.body.data.page.id;
    const otherPost = await request(app).post("/api/v1/posts").set("Authorization", `Bearer ${otherOrgAdminToken}`).send({ title: "Foreign Post" });
    otherOrgPostId = otherPost.body.data.post.id;
  });

  afterAll(async () => {
    await disconnectPrisma();
  });

  it("creates a case study with real relationships and structured content, and audits CASE_STUDY_CREATED", async () => {
    const res = await request(app)
      .post("/api/v1/case-studies")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        title: "Acme Corp Zero-Touch Close",
        body: "How Acme automated month-end close.",
        clientName: "Acme Corp",
        industryId,
        productIds: [productId],
        relatedPageIds: [pageId],
        relatedPostIds: [postId],
        content: {
          challenge: "Manual close took 10 days.",
          solutionApproach: "Deployed Zero-Touch Close.",
          implementation: "Rolled out over 6 weeks.",
          results: "Close time dropped to 1 day.",
          testimonialQuote: "Game changer.",
          testimonialAuthorName: "Jane Doe",
          testimonialAuthorTitle: "VP Finance, Acme Corp",
          technologies: ["React", "PostgreSQL"],
        },
      });
    expect(res.status).toBe(201);
    expect(res.body.data.caseStudy.clientName).toBe("Acme Corp");
    expect(res.body.data.caseStudy.industryId).toBe(industryId);
    expect(res.body.data.caseStudy.products).toHaveLength(1);
    expect(res.body.data.caseStudy.products[0].productId).toBe(productId);
    expect(res.body.data.caseStudy.relatedPages).toHaveLength(1);
    expect(res.body.data.caseStudy.relatedPosts).toHaveLength(1);
    expect(res.body.data.caseStudy.currentRevision.metadata.challenge).toBe("Manual close took 10 days.");

    const audit = await prisma.auditLog.findFirst({ where: { action: "CASE_STUDY_CREATED", resourceId: res.body.data.caseStudy.id } });
    expect(audit).not.toBeNull();
  });

  it("rejects a productId/industryId/relatedPageId/relatedPostId that doesn't exist or belongs to a different organization (IDOR-safe FK validation)", async () => {
    const badProduct = await request(app)
      .post("/api/v1/case-studies")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ title: "Bad Product", productIds: ["00000000-0000-0000-0000-000000000000"] });
    expect(badProduct.status).toBe(400);

    const badIndustry = await request(app)
      .post("/api/v1/case-studies")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ title: "Bad Industry", industryId: "00000000-0000-0000-0000-000000000000" });
    expect(badIndustry.status).toBe(400);

    const badPage = await request(app)
      .post("/api/v1/case-studies")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ title: "Bad Page", relatedPageIds: [otherOrgPageId] });
    expect(badPage.status).toBe(400);

    const badPost = await request(app)
      .post("/api/v1/case-studies")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ title: "Bad Post", relatedPostIds: [otherOrgPostId] });
    expect(badPost.status).toBe(400);
  });

  it("replaces relationship assignment on update", async () => {
    const created = await request(app).post("/api/v1/case-studies").set("Authorization", `Bearer ${adminToken}`).send({ title: "Retag Me", productIds: [productId] });
    const id = created.body.data.caseStudy.id;

    const cleared = await request(app).patch(`/api/v1/case-studies/${id}`).set("Authorization", `Bearer ${adminToken}`).send({ productIds: [] });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.caseStudy.products).toHaveLength(0);

    const reAdded = await request(app).patch(`/api/v1/case-studies/${id}`).set("Authorization", `Bearer ${adminToken}`).send({ relatedPageIds: [pageId], relatedPostIds: [postId] });
    expect(reAdded.status).toBe(200);
    expect(reAdded.body.data.caseStudy.relatedPages).toHaveLength(1);
    expect(reAdded.body.data.caseStudy.relatedPosts).toHaveLength(1);
  });

  it("publishes a case study, keeps live content edits published, and explicit unpublish forks a DRAFT revision", async () => {
    const created = await request(app).post("/api/v1/case-studies").set("Authorization", `Bearer ${adminToken}`).send({ title: "Publish Flow", body: "v1" });
    const id = created.body.data.caseStudy.id;

    const publish = await request(app).post(`/api/v1/case-studies/${id}/publish`).set("Authorization", `Bearer ${adminToken}`).send();
    expect(publish.status).toBe(200);
    expect(publish.body.data.caseStudy.status).toBe("PUBLISHED");
    const publishedRevisionId = publish.body.data.caseStudy.currentRevisionId;

    const liveEdit = await request(app).patch(`/api/v1/case-studies/${id}`).set("Authorization", `Bearer ${adminToken}`).send({ body: "v2 live" });
    expect(liveEdit.status).toBe(200);
    expect(liveEdit.body.data.caseStudy.status).toBe("PUBLISHED");
    expect(liveEdit.body.data.caseStudy.currentRevisionId).not.toBe(publishedRevisionId);
    expect(liveEdit.body.data.caseStudy.currentRevision.version).toBe(2);

    const originalRevision = await prisma.contentRevision.findUnique({ where: { id: publishedRevisionId } });
    expect(originalRevision?.status).toBe("PUBLISHED");
    expect(originalRevision?.body).toBe("v1");

    const unpublish = await request(app).patch(`/api/v1/case-studies/${id}`).set("Authorization", `Bearer ${adminToken}`).send({ status: "DRAFT", body: "v3 draft" });
    expect(unpublish.status).toBe(200);
    expect(unpublish.body.data.caseStudy.status).toBe("DRAFT");
    expect(unpublish.body.data.caseStudy.currentRevision.version).toBe(3);
  });

  it("blocks direct content edits on an ARCHIVED case study", async () => {
    const created = await request(app).post("/api/v1/case-studies").set("Authorization", `Bearer ${adminToken}`).send({ title: "Archive Edit Guard", body: "v1" });
    const id = created.body.data.caseStudy.id;

    const archive = await request(app).post(`/api/v1/case-studies/${id}/archive`).set("Authorization", `Bearer ${adminToken}`).send();
    expect(archive.status).toBe(200);
    expect(archive.body.data.caseStudy.status).toBe("ARCHIVED");

    const editWhileArchived = await request(app).patch(`/api/v1/case-studies/${id}`).set("Authorization", `Bearer ${adminToken}`).send({ body: "sneaky" });
    expect(editWhileArchived.status).toBe(409);
  });

  it("submits for review, archives via the dedicated endpoint, and reverts to a prior (published) revision", async () => {
    const created = await request(app).post("/api/v1/case-studies").set("Authorization", `Bearer ${adminToken}`).send({ title: "Workflow Case Study", body: "v1" });
    const id = created.body.data.caseStudy.id;
    const v1RevisionId = created.body.data.caseStudy.currentRevisionId;

    const submit = await request(app).post(`/api/v1/case-studies/${id}/submit-review`).set("Authorization", `Bearer ${adminToken}`).send();
    expect(submit.status).toBe(200);
    expect(submit.body.data.caseStudy.status).toBe("IN_REVIEW");

    const publish = await request(app).post(`/api/v1/case-studies/${id}/publish`).set("Authorization", `Bearer ${adminToken}`).send();
    expect(publish.status).toBe(200);

    const unpublishAndEdit = await request(app).patch(`/api/v1/case-studies/${id}`).set("Authorization", `Bearer ${adminToken}`).send({ status: "DRAFT", body: "v2" });
    expect(unpublishAndEdit.status).toBe(200);
    expect(unpublishAndEdit.body.data.caseStudy.currentRevision.version).toBe(2);

    const archive = await request(app).post(`/api/v1/case-studies/${id}/archive`).set("Authorization", `Bearer ${adminToken}`).send();
    expect(archive.status).toBe(200);

    const restore = await request(app).patch(`/api/v1/case-studies/${id}`).set("Authorization", `Bearer ${adminToken}`).send({ status: "DRAFT" });
    expect(restore.status).toBe(200);

    const revert = await request(app).post(`/api/v1/case-studies/${id}/revert`).set("Authorization", `Bearer ${adminToken}`).send({ revisionId: v1RevisionId });
    expect(revert.status).toBe(200);
    expect(revert.body.data.caseStudy.currentRevision.body).toBe("v1");
    expect(revert.body.data.caseStudy.currentRevision.version).toBe(3);

    const audit = await prisma.auditLog.findFirst({ where: { action: "CASE_STUDY_REVERTED", resourceId: id } });
    expect(audit).not.toBeNull();
  });

  it("rejects setting ARCHIVED directly via generic PATCH (dedicated endpoint only)", async () => {
    const created = await request(app).post("/api/v1/case-studies").set("Authorization", `Bearer ${adminToken}`).send({ title: "Direct Archive Attempt" });
    const res = await request(app).patch(`/api/v1/case-studies/${created.body.data.caseStudy.id}`).set("Authorization", `Bearer ${adminToken}`).send({ status: "ARCHIVED" });
    expect(res.status).toBe(400);
  });

  it("optimistic concurrency: a stale expectedUpdatedAt is rejected with 409", async () => {
    const created = await request(app).post("/api/v1/case-studies").set("Authorization", `Bearer ${adminToken}`).send({ title: "Concurrent Case Study", body: "v1" });
    const id = created.body.data.caseStudy.id;
    const staleUpdatedAt = created.body.data.caseStudy.updatedAt;

    await request(app).patch(`/api/v1/case-studies/${id}`).set("Authorization", `Bearer ${adminToken}`).send({ body: "other change" });

    const stale = await request(app)
      .patch(`/api/v1/case-studies/${id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ body: "stale change", expectedUpdatedAt: staleUpdatedAt });
    expect(stale.status).toBe(409);
  });

  it("soft-deletes into Trash, lists it there, and restores it back to DRAFT", async () => {
    const created = await request(app).post("/api/v1/case-studies").set("Authorization", `Bearer ${adminToken}`).send({ title: "Trash Me" });
    const id = created.body.data.caseStudy.id;

    await request(app).delete(`/api/v1/case-studies/${id}`).set("Authorization", `Bearer ${adminToken}`).send();

    const trash = await request(app).get("/api/v1/case-studies/trash").set("Authorization", `Bearer ${adminToken}`);
    expect(trash.status).toBe(200);
    expect(trash.body.data.caseStudies.some((c: { id: string }) => c.id === id)).toBe(true);

    const restore = await request(app).post(`/api/v1/case-studies/${id}/restore`).set("Authorization", `Bearer ${adminToken}`).send();
    expect(restore.status).toBe(200);

    const get = await request(app).get(`/api/v1/case-studies/${id}`).set("Authorization", `Bearer ${adminToken}`);
    expect(get.status).toBe(200);
    expect(get.body.data.caseStudy.status).toBe("DRAFT");
  });

  it("bulk-archives a mix of valid and already-archived ids, reporting per-id success/failure without aborting the batch", async () => {
    const a = await request(app).post("/api/v1/case-studies").set("Authorization", `Bearer ${adminToken}`).send({ title: "Bulk A" });
    const b = await request(app).post("/api/v1/case-studies").set("Authorization", `Bearer ${adminToken}`).send({ title: "Bulk B" });
    const idA = a.body.data.caseStudy.id;
    const idB = b.body.data.caseStudy.id;
    await request(app).post(`/api/v1/case-studies/${idB}/archive`).set("Authorization", `Bearer ${adminToken}`).send();

    const bulk = await request(app).post("/api/v1/case-studies/bulk/archive").set("Authorization", `Bearer ${adminToken}`).send({ ids: [idA, idB] });
    expect(bulk.status).toBe(200);
    expect(bulk.body.data.succeeded).toEqual([idA]);
    expect(bulk.body.data.failed).toEqual([{ id: idB, error: expect.stringContaining("already archived") }]);
  });

  it("filters the list by industryId and productId server-side", async () => {
    await request(app).post("/api/v1/case-studies").set("Authorization", `Bearer ${adminToken}`).send({ title: "Filterable", industryId, productIds: [productId] });

    const byIndustry = await request(app).get("/api/v1/case-studies").query({ industryId }).set("Authorization", `Bearer ${adminToken}`);
    expect(byIndustry.status).toBe(200);
    expect(byIndustry.body.data.caseStudies.every((c: { industryId: string }) => c.industryId === industryId)).toBe(true);

    const byProduct = await request(app).get("/api/v1/case-studies").query({ productId }).set("Authorization", `Bearer ${adminToken}`);
    expect(byProduct.status).toBe(200);
    expect(byProduct.body.data.caseStudies.length).toBeGreaterThan(0);
  });

  it("enforces permissions and rejects unauthenticated requests", async () => {
    expect((await request(app).get("/api/v1/case-studies").set("Authorization", `Bearer ${viewerToken}`)).status).toBe(200);
    expect((await request(app).post("/api/v1/case-studies").set("Authorization", `Bearer ${viewerToken}`).send({ title: "X" })).status).toBe(403);
    expect((await request(app).get("/api/v1/case-studies")).status).toBe(401);
  });

  it("IDOR: a case study id from another organization is not readable, editable, or deletable", async () => {
    const created = await request(app).post("/api/v1/case-studies").set("Authorization", `Bearer ${otherOrgAdminToken}`).send({ title: "Other Org Case Study" });
    const foreignId = created.body.data.caseStudy.id;

    expect((await request(app).get(`/api/v1/case-studies/${foreignId}`).set("Authorization", `Bearer ${adminToken}`)).status).toBe(404);
    expect((await request(app).patch(`/api/v1/case-studies/${foreignId}`).set("Authorization", `Bearer ${adminToken}`).send({ title: "Hijack" })).status).toBe(404);
    expect((await request(app).delete(`/api/v1/case-studies/${foreignId}`).set("Authorization", `Bearer ${adminToken}`).send()).status).toBe(404);
  });
});
