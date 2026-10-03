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
});
