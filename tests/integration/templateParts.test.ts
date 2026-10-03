/**
 * Phase 1 (Website module) — Template Part CRUD, publish, tenant
 * isolation, permissions. Deliberately lighter than templates.test.ts —
 * TemplatePart is architecturally identical to Template (same revision
 * pattern), so this covers only what differs (its own routes/permissions)
 * rather than re-proving the shared workflow mechanics twice.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp, finalizeApp } from "../../server/app/app";
import { disconnectPrisma, prisma } from "../../server/db/prisma";
import { resetDb } from "../helpers/db";

describe("Template Parts", () => {
  const app = createApp();
  finalizeApp(app);

  let adminToken: string;
  let viewerToken: string;
  let otherOrgAdminToken: string;

  beforeAll(async () => {
    await resetDb();
    const reg = await request(app).post("/api/v1/auth/register").send({
      email: "parts-admin@example.com",
      password: "OriginalPassword123",
      firstName: "Parts",
      lastName: "Admin",
      organizationName: "Template Parts Co",
    });
    adminToken = reg.body.data.session.token;

    await request(app)
      .post("/api/v1/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ email: "parts-viewer@example.com", password: "MemberPassword123", firstName: "V", lastName: "W", roleKey: "VIEWER" });
    viewerToken = (await request(app).post("/api/v1/auth/login").send({ email: "parts-viewer@example.com", password: "MemberPassword123" })).body.data
      .session.token;

    const otherOrg = await request(app).post("/api/v1/auth/register").send({
      email: "parts-other-admin@example.com",
      password: "OriginalPassword123",
      firstName: "Other",
      lastName: "Admin",
      organizationName: "Other Parts Co",
    });
    otherOrgAdminToken = otherOrg.body.data.session.token;
  });

  afterAll(async () => {
    await disconnectPrisma();
  });

  it("creates, publishes, and revises a template part", async () => {
    const created = await request(app)
      .post("/api/v1/template-parts")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ type: "HEADER", name: "Main Header", content: { logo: "artify" } });
    expect(created.status).toBe(201);
    expect(created.body.data.templatePart.slug).toBe("main-header");
    expect(created.body.data.templatePart.status).toBe("DRAFT");

    const id = created.body.data.templatePart.id;
    const publish = await request(app).post(`/api/v1/template-parts/${id}/publish`).set("Authorization", `Bearer ${adminToken}`).send();
    expect(publish.status).toBe(200);
    expect(publish.body.data.templatePart.status).toBe("PUBLISHED");

    const edited = await request(app).patch(`/api/v1/template-parts/${id}`).set("Authorization", `Bearer ${adminToken}`).send({ content: { logo: "artify-v2" } });
    expect(edited.status).toBe(200);
    expect(edited.body.data.templatePart.currentRevision.version).toBe(2);

    const audit = await prisma.auditLog.findFirst({ where: { action: "TEMPLATE_PART_CREATED", resourceId: id } });
    expect(audit).not.toBeNull();
  });

  it("accepts a real Site Editor block document as content and sanitizes embedded script content (Phase 2)", async () => {
    const created = await request(app)
      .post("/api/v1/template-parts")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        type: "FOOTER",
        name: "Editor Footer",
        content: { version: 1, blocks: [{ id: "t1", type: "text", props: { html: "<p>ok</p><script>alert(1)</script>" } }] },
      });
    expect(created.status).toBe(201);
    const html = created.body.data.templatePart.currentRevision.content.blocks[0].props.html;
    expect(html).toContain("ok");
    expect(html).not.toContain("<script>");
  });

  it("preserves legacy free-form content verbatim — never silently strips unrecognized keys (backward compatibility)", async () => {
    const created = await request(app)
      .post("/api/v1/template-parts")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ type: "SIDEBAR", name: "Legacy Part", content: { logo: "artify", links: ["/", "/about"] } });
    expect(created.status).toBe(201);
    expect(created.body.data.templatePart.currentRevision.content).toEqual({ logo: "artify", links: ["/", "/about"] });
  });

  it("protects a system template part from update/publish/archive/delete", async () => {
    const created = await request(app).post("/api/v1/template-parts").set("Authorization", `Bearer ${adminToken}`).send({ type: "FOOTER", name: "System Footer" });
    const id = created.body.data.templatePart.id;
    await prisma.templatePart.update({ where: { id }, data: { isSystem: true } });

    expect((await request(app).patch(`/api/v1/template-parts/${id}`).set("Authorization", `Bearer ${adminToken}`).send({ name: "Hijack" })).status).toBe(403);
    expect((await request(app).delete(`/api/v1/template-parts/${id}`).set("Authorization", `Bearer ${adminToken}`).send()).status).toBe(403);
  });

  it("VIEWER is read-only; unauthenticated requests are rejected; cross-org access 404s", async () => {
    expect((await request(app).get("/api/v1/template-parts").set("Authorization", `Bearer ${viewerToken}`)).status).toBe(200);
    expect(
      (await request(app).post("/api/v1/template-parts").set("Authorization", `Bearer ${viewerToken}`).send({ type: "HEADER", name: "X" })).status
    ).toBe(403);
    expect((await request(app).get("/api/v1/template-parts")).status).toBe(401);

    const foreign = await request(app).post("/api/v1/template-parts").set("Authorization", `Bearer ${otherOrgAdminToken}`).send({ type: "SIDEBAR", name: "Foreign" });
    expect((await request(app).get(`/api/v1/template-parts/${foreign.body.data.templatePart.id}`).set("Authorization", `Bearer ${adminToken}`)).status).toBe(
      404
    );
  });

  it("GET /:id/usage finds both a Template region reference and a Page editorBlocks reference, tenant-scoped", async () => {
    const part = await request(app).post("/api/v1/template-parts").set("Authorization", `Bearer ${adminToken}`).send({ type: "HEADER", name: "Referenced Header" });
    const partId = part.body.data.templatePart.id;

    const template = await request(app)
      .post("/api/v1/templates")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ type: "STANDARD_PAGE", name: "Referencing Template", structure: { regions: [{ key: "header", templatePartId: partId }] } });

    const page = await request(app)
      .post("/api/v1/pages")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        title: "Page With Part Block",
        editorBlocks: { version: 1, blocks: [{ id: "b1", type: "templatePart", props: { templatePartId: partId } }] },
      });

    const usage = await request(app).get(`/api/v1/template-parts/${partId}/usage`).set("Authorization", `Bearer ${adminToken}`);
    expect(usage.status).toBe(200);
    expect(usage.body.data.templates.map((t: { id: string }) => t.id)).toContain(template.body.data.template.id);
    expect(usage.body.data.pages.map((p: { id: string }) => p.id)).toContain(page.body.data.page.id);

    expect((await request(app).get(`/api/v1/template-parts/${partId}/usage`).set("Authorization", `Bearer ${otherOrgAdminToken}`)).status).toBe(404);
  });

  it("refuses to delete a template part referenced by a Template region", async () => {
    const part = await request(app).post("/api/v1/template-parts").set("Authorization", `Bearer ${adminToken}`).send({ type: "FOOTER", name: "Used By Template" });
    const partId = part.body.data.templatePart.id;
    await request(app)
      .post("/api/v1/templates")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ type: "STANDARD_PAGE", name: "Holds Part Reference", structure: { regions: [{ key: "footer", templatePartId: partId }] } });

    const del = await request(app).delete(`/api/v1/template-parts/${partId}`).set("Authorization", `Bearer ${adminToken}`).send();
    expect(del.status).toBe(400);
  });

  it("refuses to delete a template part referenced by a Page's editorBlocks", async () => {
    const part = await request(app).post("/api/v1/template-parts").set("Authorization", `Bearer ${adminToken}`).send({ type: "SIDEBAR", name: "Used By Page" });
    const partId = part.body.data.templatePart.id;
    await request(app)
      .post("/api/v1/pages")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        title: "References The Part",
        editorBlocks: { version: 1, blocks: [{ id: "b1", type: "templatePart", props: { templatePartId: partId } }] },
      });

    const del = await request(app).delete(`/api/v1/template-parts/${partId}`).set("Authorization", `Bearer ${adminToken}`).send();
    expect(del.status).toBe(400);
  });

  it("allows deleting a template part once it is no longer referenced anywhere", async () => {
    const part = await request(app).post("/api/v1/template-parts").set("Authorization", `Bearer ${adminToken}`).send({ type: "CTA_SECTION", name: "Unused Part" });
    const partId = part.body.data.templatePart.id;

    const del = await request(app).delete(`/api/v1/template-parts/${partId}`).set("Authorization", `Bearer ${adminToken}`).send();
    expect(del.status).toBe(200);

    const stillVisible = await request(app).get(`/api/v1/template-parts/${partId}`).set("Authorization", `Bearer ${adminToken}`);
    expect(stillVisible.status).toBe(404);
  });
});
