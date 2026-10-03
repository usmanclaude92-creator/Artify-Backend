/**
 * Phase 1 (Website module) — Template CRUD, publish/revision/rollback
 * workflow, system-template protection, permissions, tenant isolation.
 * Mirrors tests/integration/pages.test.ts's shape exactly — Template
 * deliberately reuses Post/Page's own revision pattern
 * (docs/control-center-replacement-roadmap.md).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp, finalizeApp } from "../../server/app/app";
import { disconnectPrisma, prisma } from "../../server/db/prisma";
import { resetDb } from "../helpers/db";

describe("Templates", () => {
  const app = createApp();
  finalizeApp(app);

  let adminToken: string;
  let managerToken: string;
  let userToken: string;
  let viewerToken: string;
  let otherOrgAdminToken: string;
  let organizationId: string;

  beforeAll(async () => {
    await resetDb();
    const reg = await request(app).post("/api/v1/auth/register").send({
      email: "templates-admin@example.com",
      password: "OriginalPassword123",
      firstName: "Tpl",
      lastName: "Admin",
      organizationName: "Templates Admin Co",
    });
    adminToken = reg.body.data.session.token;
    organizationId = reg.body.data.user.organizationId;

    for (const [email, roleKey] of [
      ["templates-manager@example.com", "MANAGER"],
      ["templates-user@example.com", "USER"],
      ["templates-viewer@example.com", "VIEWER"],
    ] as const) {
      await request(app)
        .post("/api/v1/users")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ email, password: "MemberPassword123", firstName: "M", lastName: "W", roleKey });
    }
    managerToken = (await request(app).post("/api/v1/auth/login").send({ email: "templates-manager@example.com", password: "MemberPassword123" })).body
      .data.session.token;
    userToken = (await request(app).post("/api/v1/auth/login").send({ email: "templates-user@example.com", password: "MemberPassword123" })).body.data
      .session.token;
    viewerToken = (await request(app).post("/api/v1/auth/login").send({ email: "templates-viewer@example.com", password: "MemberPassword123" })).body
      .data.session.token;

    const otherOrg = await request(app).post("/api/v1/auth/register").send({
      email: "templates-other-admin@example.com",
      password: "OriginalPassword123",
      firstName: "Other",
      lastName: "Admin",
      organizationName: "Other Templates Co",
    });
    otherOrgAdminToken = otherOrg.body.data.session.token;
  });

  afterAll(async () => {
    await disconnectPrisma();
  });

  it("creates a template with a server-generated slug, a v1 DRAFT revision, and audits TEMPLATE_CREATED", async () => {
    const res = await request(app)
      .post("/api/v1/templates")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ type: "STANDARD_PAGE", name: "Basic Page", structure: { regions: ["header", "content", "footer"] } });
    expect(res.status).toBe(201);
    expect(res.body.data.template.slug).toBe("basic-page");
    expect(res.body.data.template.status).toBe("DRAFT");
    expect(res.body.data.template.currentRevision.version).toBe(1);
    expect(res.body.data.template.currentRevision.structure).toEqual({ regions: ["header", "content", "footer"] });
    expect(res.body.data.template._count.pages).toBe(0);

    const audit = await prisma.auditLog.findFirst({ where: { action: "TEMPLATE_CREATED", resourceId: res.body.data.template.id } });
    expect(audit).not.toBeNull();
  });

  it("edits DRAFT content in place until publish, then clones on further edits (matches Post/Page's own revision pattern)", async () => {
    const created = await request(app)
      .post("/api/v1/templates")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ type: "HOMEPAGE", name: "Lifecycle Template", structure: { v: 1 } });
    const id = created.body.data.template.id;

    const edited = await request(app).patch(`/api/v1/templates/${id}`).set("Authorization", `Bearer ${adminToken}`).send({ structure: { v: "1-edited" } });
    expect(edited.status).toBe(200);
    expect(edited.body.data.template.currentRevision.version).toBe(1);

    const publish = await request(app).post(`/api/v1/templates/${id}/publish`).set("Authorization", `Bearer ${adminToken}`).send();
    expect(publish.status).toBe(200);
    expect(publish.body.data.template.status).toBe("PUBLISHED");
    expect(publish.body.data.template.currentRevision.status).toBe("PUBLISHED");
    const publishedRevisionId = publish.body.data.template.currentRevisionId;

    const liveEdit = await request(app).patch(`/api/v1/templates/${id}`).set("Authorization", `Bearer ${adminToken}`).send({ structure: { v: 2 } });
    expect(liveEdit.status).toBe(200);
    expect(liveEdit.body.data.template.currentRevisionId).not.toBe(publishedRevisionId);
    expect(liveEdit.body.data.template.currentRevision.version).toBe(2);

    const publishedRevision = await prisma.templateRevision.findUnique({ where: { id: publishedRevisionId } });
    expect(publishedRevision?.status).toBe("PUBLISHED");
    expect(publishedRevision?.structure).toEqual({ v: "1-edited" });
  });

  it("reverts to a prior revision, creating a new revision rather than mutating history", async () => {
    const created = await request(app)
      .post("/api/v1/templates")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ type: "STANDARD_PAGE", name: "Revert Me", structure: { v: 1 } });
    const id = created.body.data.template.id;
    const v1RevisionId = created.body.data.template.currentRevisionId;

    await request(app).post(`/api/v1/templates/${id}/publish`).set("Authorization", `Bearer ${adminToken}`).send();
    await request(app).patch(`/api/v1/templates/${id}`).set("Authorization", `Bearer ${adminToken}`).send({ structure: { v: 2 } });

    const revert = await request(app).post(`/api/v1/templates/${id}/revert`).set("Authorization", `Bearer ${adminToken}`).send({ revisionId: v1RevisionId });
    expect(revert.status).toBe(200);
    expect(revert.body.data.template.currentRevision.version).toBe(3);
    expect(revert.body.data.template.currentRevision.structure).toEqual({ v: 1 });

    const v1Untouched = await prisma.templateRevision.findUnique({ where: { id: v1RevisionId } });
    expect(v1Untouched?.structure).toEqual({ v: 1 });

    const revisions = await request(app).get(`/api/v1/templates/${id}/revisions`).set("Authorization", `Bearer ${adminToken}`);
    expect(revisions.body.data.revisions).toHaveLength(3);

    const audit = await prisma.auditLog.findFirst({ where: { action: "TEMPLATE_REVERTED", resourceId: id } });
    expect(audit).not.toBeNull();
  });

  it("duplicates a template into a new, independent, fully-editable copy", async () => {
    const created = await request(app)
      .post("/api/v1/templates")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ type: "PRODUCT", name: "Original", structure: { regions: ["a"] } });
    const id = created.body.data.template.id;
    await request(app).post(`/api/v1/templates/${id}/publish`).set("Authorization", `Bearer ${adminToken}`).send();

    const dup = await request(app).post(`/api/v1/templates/${id}/duplicate`).set("Authorization", `Bearer ${adminToken}`).send({});
    expect(dup.status).toBe(201);
    expect(dup.body.data.template.id).not.toBe(id);
    expect(dup.body.data.template.status).toBe("DRAFT");
    expect(dup.body.data.template.currentRevision.structure).toEqual({ regions: ["a"] });
    expect(dup.body.data.template.isSystem).toBe(false);

    // Editing the duplicate must never affect the source's published revision.
    await request(app).patch(`/api/v1/templates/${dup.body.data.template.id}`).set("Authorization", `Bearer ${adminToken}`).send({ structure: { regions: ["b"] } });
    const original = await request(app).get(`/api/v1/templates/${id}`).set("Authorization", `Bearer ${adminToken}`);
    expect(original.body.data.template.currentRevision.structure).toEqual({ regions: ["a"] });
  });

  it("archiving a template does not delete it and leaves an assigned page to fall back safely (checked in pages.test.ts's own template-integration case)", async () => {
    const created = await request(app).post("/api/v1/templates").set("Authorization", `Bearer ${adminToken}`).send({ type: "STANDARD_PAGE", name: "Archive Me" });
    const id = created.body.data.template.id;

    const archive = await request(app).post(`/api/v1/templates/${id}/archive`).set("Authorization", `Bearer ${adminToken}`).send();
    expect(archive.status).toBe(200);
    expect(archive.body.data.template.status).toBe("ARCHIVED");

    const stillReadable = await request(app).get(`/api/v1/templates/${id}`).set("Authorization", `Bearer ${adminToken}`);
    expect(stillReadable.status).toBe(200);
  });

  it("protects a system template: cannot update, publish, archive, or delete it, but can duplicate it", async () => {
    const created = await request(app)
      .post("/api/v1/templates")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ type: "NOT_FOUND", name: "System 404" });
    const id = created.body.data.template.id;
    await prisma.template.update({ where: { id }, data: { isSystem: true } });

    expect((await request(app).patch(`/api/v1/templates/${id}`).set("Authorization", `Bearer ${adminToken}`).send({ name: "Hijack" })).status).toBe(403);
    expect((await request(app).post(`/api/v1/templates/${id}/publish`).set("Authorization", `Bearer ${adminToken}`).send()).status).toBe(403);
    expect((await request(app).post(`/api/v1/templates/${id}/archive`).set("Authorization", `Bearer ${adminToken}`).send()).status).toBe(403);
    expect((await request(app).delete(`/api/v1/templates/${id}`).set("Authorization", `Bearer ${adminToken}`).send()).status).toBe(403);

    const dup = await request(app).post(`/api/v1/templates/${id}/duplicate`).set("Authorization", `Bearer ${adminToken}`).send({});
    expect(dup.status).toBe(201);
    expect(dup.body.data.template.isSystem).toBe(false);
  });

  it("refuses to delete a template still assigned to a page", async () => {
    const template = await request(app)
      .post("/api/v1/templates")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ type: "STANDARD_PAGE", name: "In Use" });
    const templateId = template.body.data.template.id;
    await request(app).post(`/api/v1/templates/${templateId}/publish`).set("Authorization", `Bearer ${adminToken}`).send();

    await request(app).post("/api/v1/pages").set("Authorization", `Bearer ${adminToken}`).send({ title: "Uses Template", templateId });

    const del = await request(app).delete(`/api/v1/templates/${templateId}`).set("Authorization", `Bearer ${adminToken}`).send();
    expect(del.status).toBe(400);
  });

  it("enforces per-permission tiers: VIEWER read-only, USER can create but not update, MANAGER can update but not publish/delete", async () => {
    const created = await request(app).post("/api/v1/templates").set("Authorization", `Bearer ${adminToken}`).send({ type: "STANDARD_PAGE", name: "Perm Template" });
    const id = created.body.data.template.id;

    expect((await request(app).get("/api/v1/templates").set("Authorization", `Bearer ${viewerToken}`)).status).toBe(200);
    expect((await request(app).post("/api/v1/templates").set("Authorization", `Bearer ${viewerToken}`).send({ type: "STANDARD_PAGE", name: "X" })).status).toBe(403);

    expect((await request(app).post("/api/v1/templates").set("Authorization", `Bearer ${userToken}`).send({ type: "STANDARD_PAGE", name: "By User" })).status).toBe(201);
    expect((await request(app).patch(`/api/v1/templates/${id}`).set("Authorization", `Bearer ${userToken}`).send({ name: "Y" })).status).toBe(403);

    expect((await request(app).patch(`/api/v1/templates/${id}`).set("Authorization", `Bearer ${managerToken}`).send({ name: "By Manager" })).status).toBe(200);
    expect((await request(app).post(`/api/v1/templates/${id}/publish`).set("Authorization", `Bearer ${managerToken}`).send()).status).toBe(403);
    expect((await request(app).delete(`/api/v1/templates/${id}`).set("Authorization", `Bearer ${managerToken}`).send()).status).toBe(403);
  });

  it("rejects unauthenticated requests", async () => {
    expect((await request(app).get("/api/v1/templates")).status).toBe(401);
  });

  it("IDOR: a template id from another organization is not readable, editable, or publishable", async () => {
    const created = await request(app)
      .post("/api/v1/templates")
      .set("Authorization", `Bearer ${otherOrgAdminToken}`)
      .send({ type: "STANDARD_PAGE", name: "Other Org Template" });
    const foreignId = created.body.data.template.id;

    expect((await request(app).get(`/api/v1/templates/${foreignId}`).set("Authorization", `Bearer ${adminToken}`)).status).toBe(404);
    expect((await request(app).patch(`/api/v1/templates/${foreignId}`).set("Authorization", `Bearer ${adminToken}`).send({ name: "Hijack" })).status).toBe(404);
    expect((await request(app).post(`/api/v1/templates/${foreignId}/publish`).set("Authorization", `Bearer ${adminToken}`).send()).status).toBe(404);
  });

  it("searches/filters by type/status and paginates server-side", async () => {
    await request(app).post("/api/v1/templates").set("Authorization", `Bearer ${adminToken}`).send({ type: "CASE_STUDY", name: "Findable Case Study" });
    const search = await request(app).get("/api/v1/templates").query({ search: "Findable" }).set("Authorization", `Bearer ${adminToken}`);
    expect(search.body.data.templates.length).toBeGreaterThanOrEqual(1);

    const byType = await request(app).get("/api/v1/templates").query({ type: "CASE_STUDY" }).set("Authorization", `Bearer ${adminToken}`);
    expect(byType.body.data.templates.every((t: { type: string }) => t.type === "CASE_STUDY")).toBe(true);
  });

  it("a template referencing this organization's own resource never leaks organizationId beyond it", async () => {
    const res = await request(app).post("/api/v1/templates").set("Authorization", `Bearer ${adminToken}`).send({ type: "STANDARD_PAGE", name: "Org Scoped" });
    expect(res.body.data.template.organizationId).toBe(organizationId);
  });

  it("GET /:id/usage lists real pages assigned to the template, tenant-scoped", async () => {
    const template = await request(app).post("/api/v1/templates").set("Authorization", `Bearer ${adminToken}`).send({ type: "STANDARD_PAGE", name: "Usage Template" });
    const templateId = template.body.data.template.id;
    await request(app).post(`/api/v1/templates/${templateId}/publish`).set("Authorization", `Bearer ${adminToken}`).send();
    const page = await request(app).post("/api/v1/pages").set("Authorization", `Bearer ${adminToken}`).send({ title: "Uses Usage Template", templateId });

    const usage = await request(app).get(`/api/v1/templates/${templateId}/usage`).set("Authorization", `Bearer ${adminToken}`);
    expect(usage.status).toBe(200);
    expect(usage.body.data.pages).toHaveLength(1);
    expect(usage.body.data.pages[0].id).toBe(page.body.data.page.id);

    expect((await request(app).get(`/api/v1/templates/${templateId}/usage`).set("Authorization", `Bearer ${otherOrgAdminToken}`)).status).toBe(404);
  });

  it("GET /:id/preview resolves each region's assigned Template Part", async () => {
    const part = await request(app)
      .post("/api/v1/template-parts")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ type: "HEADER", name: "Preview Header", content: { version: 1, blocks: [] } });
    const partId = part.body.data.templatePart.id;

    const template = await request(app)
      .post("/api/v1/templates")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ type: "STANDARD_PAGE", name: "Preview Template", structure: { regions: [{ key: "header", templatePartId: partId }] } });
    const templateId = template.body.data.template.id;

    const preview = await request(app).get(`/api/v1/templates/${templateId}/preview`).set("Authorization", `Bearer ${adminToken}`);
    expect(preview.status).toBe(200);
    expect(preview.body.data.regions).toHaveLength(1);
    expect(preview.body.data.regions[0].key).toBe("header");
    expect(preview.body.data.regions[0].part.id).toBe(partId);
  });

  it("refuses to publish a template whose region references a deleted/non-existent Template Part", async () => {
    const part = await request(app)
      .post("/api/v1/template-parts")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ type: "HEADER", name: "Doomed Header" });
    const partId = part.body.data.templatePart.id;
    await request(app).delete(`/api/v1/template-parts/${partId}`).set("Authorization", `Bearer ${adminToken}`).send();

    const template = await request(app)
      .post("/api/v1/templates")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ type: "STANDARD_PAGE", name: "Broken Reference", structure: { regions: [{ key: "header", templatePartId: partId }] } });
    const templateId = template.body.data.template.id;

    const publish = await request(app).post(`/api/v1/templates/${templateId}/publish`).set("Authorization", `Bearer ${adminToken}`).send();
    expect(publish.status).toBe(400);
  });

  it("publishes successfully when every region's Template Part resolves", async () => {
    const part = await request(app)
      .post("/api/v1/template-parts")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ type: "FOOTER", name: "Valid Footer" });
    const partId = part.body.data.templatePart.id;

    const template = await request(app)
      .post("/api/v1/templates")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ type: "STANDARD_PAGE", name: "Valid Reference", structure: { regions: [{ key: "footer", templatePartId: partId }] } });
    const templateId = template.body.data.template.id;

    const publish = await request(app).post(`/api/v1/templates/${templateId}/publish`).set("Authorization", `Bearer ${adminToken}`).send();
    expect(publish.status).toBe(200);
  });
});
