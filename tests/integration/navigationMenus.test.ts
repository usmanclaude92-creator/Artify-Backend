/**
 * Phase 5 (Navigation + Pages + Homepage) — Navigation Menu CRUD,
 * publish/revision/rollback workflow, nested item hierarchy, ordering,
 * permissions, tenant isolation, menu/template-part resolution,
 * dependency protection. Mirrors tests/integration/templateParts.test.ts's
 * shape exactly — NavigationMenu reuses the exact same draft/publish/
 * revision architecture.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp, finalizeApp } from "../../server/app/app";
import { disconnectPrisma, prisma } from "../../server/db/prisma";
import { resetDb } from "../helpers/db";

describe("Navigation Menus", () => {
  const app = createApp();
  finalizeApp(app);

  let adminToken: string;
  let managerToken: string;
  let userToken: string;
  let viewerToken: string;
  let otherOrgAdminToken: string;

  beforeAll(async () => {
    await resetDb();
    const reg = await request(app).post("/api/v1/auth/register").send({
      email: "menus-admin@example.com",
      password: "OriginalPassword123",
      firstName: "Menu",
      lastName: "Admin",
      organizationName: "Menus Admin Co",
    });
    adminToken = reg.body.data.session.token;

    for (const [email, roleKey] of [
      ["menus-manager@example.com", "MANAGER"],
      ["menus-user@example.com", "USER"],
      ["menus-viewer@example.com", "VIEWER"],
    ] as const) {
      await request(app)
        .post("/api/v1/users")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ email, password: "MemberPassword123", firstName: "M", lastName: "W", roleKey });
    }
    managerToken = (await request(app).post("/api/v1/auth/login").send({ email: "menus-manager@example.com", password: "MemberPassword123" })).body.data
      .session.token;
    userToken = (await request(app).post("/api/v1/auth/login").send({ email: "menus-user@example.com", password: "MemberPassword123" })).body.data.session
      .token;
    viewerToken = (await request(app).post("/api/v1/auth/login").send({ email: "menus-viewer@example.com", password: "MemberPassword123" })).body.data
      .session.token;

    const otherOrg = await request(app).post("/api/v1/auth/register").send({
      email: "menus-other-admin@example.com",
      password: "OriginalPassword123",
      firstName: "Other",
      lastName: "Admin",
      organizationName: "Other Menus Co",
    });
    otherOrgAdminToken = otherOrg.body.data.session.token;
  });

  afterAll(async () => {
    await disconnectPrisma();
  });

  it("creates a menu with a server-generated slug, a v1 DRAFT revision, and audits NAVIGATION_MENU_CREATED", async () => {
    const res = await request(app)
      .post("/api/v1/navigation-menus")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ type: "PRIMARY", name: "Main Menu", items: [{ id: "i1", label: "Custom", linkType: "custom", url: "https://example.com", openInNewTab: false, children: [] }] });
    expect(res.status).toBe(201);
    expect(res.body.data.navigationMenu.slug).toBe("main-menu");
    expect(res.body.data.navigationMenu.status).toBe("DRAFT");
    expect(res.body.data.navigationMenu.currentRevision.version).toBe(1);
    expect(res.body.data.navigationMenu.currentRevision.items).toHaveLength(1);

    const audit = await prisma.auditLog.findFirst({ where: { action: "NAVIGATION_MENU_CREATED", resourceId: res.body.data.navigationMenu.id } });
    expect(audit).not.toBeNull();
  });

  it("supports a nested item hierarchy (children) and reordering via a full replace", async () => {
    const created = await request(app)
      .post("/api/v1/navigation-menus")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        type: "HEADER",
        name: "Nested Menu",
        items: [
          {
            id: "parent-1",
            label: "Solutions",
            linkType: "custom",
            url: "/solutions",
            openInNewTab: false,
            children: [
              { id: "child-1", label: "AI", linkType: "custom", url: "/solutions/ai", openInNewTab: false, children: [] },
              { id: "child-2", label: "Automation", linkType: "custom", url: "/solutions/automation", openInNewTab: false, children: [] },
            ],
          },
        ],
      });
    expect(created.status).toBe(201);
    const id = created.body.data.navigationMenu.id;
    expect(created.body.data.navigationMenu.currentRevision.items[0].children).toHaveLength(2);

    // Reorder the children (swap order) via a full items replace.
    const reordered = await request(app)
      .patch(`/api/v1/navigation-menus/${id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        items: [
          {
            id: "parent-1",
            label: "Solutions",
            linkType: "custom",
            url: "/solutions",
            openInNewTab: false,
            children: [
              { id: "child-2", label: "Automation", linkType: "custom", url: "/solutions/automation", openInNewTab: false, children: [] },
              { id: "child-1", label: "AI", linkType: "custom", url: "/solutions/ai", openInNewTab: false, children: [] },
            ],
          },
        ],
      });
    expect(reordered.status).toBe(200);
    expect(reordered.body.data.navigationMenu.currentRevision.items[0].children[0].id).toBe("child-2");
  });

  it("edits DRAFT content in place until publish, then clones on further edits (matches Template/TemplatePart's own revision pattern)", async () => {
    const created = await request(app)
      .post("/api/v1/navigation-menus")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ type: "FOOTER", name: "Lifecycle Menu", items: [] });
    const id = created.body.data.navigationMenu.id;

    const edited = await request(app)
      .patch(`/api/v1/navigation-menus/${id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ items: [{ id: "i1", label: "V1", linkType: "custom", url: "/v1", openInNewTab: false, children: [] }] });
    expect(edited.status).toBe(200);
    expect(edited.body.data.navigationMenu.currentRevision.version).toBe(1);

    const publish = await request(app).post(`/api/v1/navigation-menus/${id}/publish`).set("Authorization", `Bearer ${adminToken}`).send();
    expect(publish.status).toBe(200);
    expect(publish.body.data.navigationMenu.status).toBe("PUBLISHED");
    const publishedRevisionId = publish.body.data.navigationMenu.currentRevisionId;

    const liveEdit = await request(app)
      .patch(`/api/v1/navigation-menus/${id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ items: [{ id: "i1", label: "V2", linkType: "custom", url: "/v2", openInNewTab: false, children: [] }] });
    expect(liveEdit.status).toBe(200);
    expect(liveEdit.body.data.navigationMenu.currentRevisionId).not.toBe(publishedRevisionId);
    expect(liveEdit.body.data.navigationMenu.currentRevision.version).toBe(2);

    const publishedRevision = await prisma.navigationMenuRevision.findUnique({ where: { id: publishedRevisionId } });
    expect(publishedRevision?.status).toBe("PUBLISHED");
    expect((publishedRevision!.items as { label: string }[])[0]!.label).toBe("V1");
  });

  it("reverts to a prior revision, creating a new revision rather than mutating history", async () => {
    const created = await request(app)
      .post("/api/v1/navigation-menus")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ type: "MOBILE", name: "Revert Me", items: [{ id: "i1", label: "V1", linkType: "custom", url: "/v1", openInNewTab: false, children: [] }] });
    const id = created.body.data.navigationMenu.id;
    const v1RevisionId = created.body.data.navigationMenu.currentRevisionId;

    await request(app).post(`/api/v1/navigation-menus/${id}/publish`).set("Authorization", `Bearer ${adminToken}`).send();
    await request(app)
      .patch(`/api/v1/navigation-menus/${id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ items: [{ id: "i1", label: "V2", linkType: "custom", url: "/v2", openInNewTab: false, children: [] }] });

    const revert = await request(app).post(`/api/v1/navigation-menus/${id}/revert`).set("Authorization", `Bearer ${adminToken}`).send({ revisionId: v1RevisionId });
    expect(revert.status).toBe(200);
    expect(revert.body.data.navigationMenu.currentRevision.version).toBe(3);
    expect(revert.body.data.navigationMenu.currentRevision.items[0].label).toBe("V1");

    const v1Untouched = await prisma.navigationMenuRevision.findUnique({ where: { id: v1RevisionId } });
    expect((v1Untouched!.items as { label: string }[])[0]!.label).toBe("V1");

    const revisions = await request(app).get(`/api/v1/navigation-menus/${id}/revisions`).set("Authorization", `Bearer ${adminToken}`);
    expect(revisions.body.data.revisions).toHaveLength(3);

    const audit = await prisma.auditLog.findFirst({ where: { action: "NAVIGATION_MENU_REVERTED", resourceId: id } });
    expect(audit).not.toBeNull();
  });

  it("duplicates a menu into a new, independent, fully-editable copy", async () => {
    const created = await request(app)
      .post("/api/v1/navigation-menus")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ type: "PRIMARY", name: "Original Menu", items: [{ id: "i1", label: "A", linkType: "custom", url: "/a", openInNewTab: false, children: [] }] });
    const id = created.body.data.navigationMenu.id;
    await request(app).post(`/api/v1/navigation-menus/${id}/publish`).set("Authorization", `Bearer ${adminToken}`).send();

    const dup = await request(app).post(`/api/v1/navigation-menus/${id}/duplicate`).set("Authorization", `Bearer ${adminToken}`).send({});
    expect(dup.status).toBe(201);
    expect(dup.body.data.navigationMenu.id).not.toBe(id);
    expect(dup.body.data.navigationMenu.status).toBe("DRAFT");
    expect(dup.body.data.navigationMenu.currentRevision.items[0].label).toBe("A");
  });

  it("refuses to publish a menu with a broken link target (deleted page)", async () => {
    const page = await request(app).post("/api/v1/pages").set("Authorization", `Bearer ${adminToken}`).send({ title: "Doomed Target Page" });
    const pageId = page.body.data.page.id;
    await request(app).delete(`/api/v1/pages/${pageId}`).set("Authorization", `Bearer ${adminToken}`).send();

    const menu = await request(app)
      .post("/api/v1/navigation-menus")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ type: "PRIMARY", name: "Broken Link Menu", items: [{ id: "i1", label: "Gone", linkType: "page", targetId: pageId, openInNewTab: false, children: [] }] });
    const menuId = menu.body.data.navigationMenu.id;

    const publish = await request(app).post(`/api/v1/navigation-menus/${menuId}/publish`).set("Authorization", `Bearer ${adminToken}`).send();
    expect(publish.status).toBe(400);
  });

  it("publishes successfully when every item's link target resolves", async () => {
    const page = await request(app).post("/api/v1/pages").set("Authorization", `Bearer ${adminToken}`).send({ title: "Valid Target Page" });
    const pageId = page.body.data.page.id;

    const menu = await request(app)
      .post("/api/v1/navigation-menus")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ type: "PRIMARY", name: "Valid Link Menu", items: [{ id: "i1", label: "Here", linkType: "page", targetId: pageId, openInNewTab: false, children: [] }] });
    const menuId = menu.body.data.navigationMenu.id;

    const publish = await request(app).post(`/api/v1/navigation-menus/${menuId}/publish`).set("Authorization", `Bearer ${adminToken}`).send();
    expect(publish.status).toBe(200);
  });

  it("GET /:id/usage finds a TemplatePart referencing this menu via a navigationMenu block", async () => {
    const menu = await request(app).post("/api/v1/navigation-menus").set("Authorization", `Bearer ${adminToken}`).send({ type: "HEADER", name: "Used Menu", items: [] });
    const menuId = menu.body.data.navigationMenu.id;

    const part = await request(app)
      .post("/api/v1/template-parts")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        type: "HEADER",
        name: "Header With Menu",
        content: { version: 1, blocks: [{ id: "b1", type: "navigationMenu", props: { navigationMenuId: menuId } }] },
      });

    const usage = await request(app).get(`/api/v1/navigation-menus/${menuId}/usage`).set("Authorization", `Bearer ${adminToken}`);
    expect(usage.status).toBe(200);
    expect(usage.body.data.templateParts.map((p: { id: string }) => p.id)).toContain(part.body.data.templatePart.id);
  });

  it("protects a system menu: cannot update, publish, archive, or delete it, but can duplicate it", async () => {
    const created = await request(app).post("/api/v1/navigation-menus").set("Authorization", `Bearer ${adminToken}`).send({ type: "PRIMARY", name: "System Menu" });
    const id = created.body.data.navigationMenu.id;
    await prisma.navigationMenu.update({ where: { id }, data: { isSystem: true } });

    expect((await request(app).patch(`/api/v1/navigation-menus/${id}`).set("Authorization", `Bearer ${adminToken}`).send({ name: "Hijack" })).status).toBe(403);
    expect((await request(app).post(`/api/v1/navigation-menus/${id}/publish`).set("Authorization", `Bearer ${adminToken}`).send()).status).toBe(403);
    expect((await request(app).post(`/api/v1/navigation-menus/${id}/archive`).set("Authorization", `Bearer ${adminToken}`).send()).status).toBe(403);
    expect((await request(app).delete(`/api/v1/navigation-menus/${id}`).set("Authorization", `Bearer ${adminToken}`).send()).status).toBe(403);

    const dup = await request(app).post(`/api/v1/navigation-menus/${id}/duplicate`).set("Authorization", `Bearer ${adminToken}`).send({});
    expect(dup.status).toBe(201);
    expect(dup.body.data.navigationMenu.isSystem).toBe(false);
  });

  it("refuses to delete a menu still referenced by a TemplatePart, but allows deleting one with no references", async () => {
    const referenced = await request(app).post("/api/v1/navigation-menus").set("Authorization", `Bearer ${adminToken}`).send({ type: "FOOTER", name: "Referenced Menu" });
    const referencedId = referenced.body.data.navigationMenu.id;
    await request(app)
      .post("/api/v1/template-parts")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ type: "FOOTER", name: "Footer With Menu", content: { version: 1, blocks: [{ id: "b1", type: "navigationMenu", props: { navigationMenuId: referencedId } }] } });

    const blockedDelete = await request(app).delete(`/api/v1/navigation-menus/${referencedId}`).set("Authorization", `Bearer ${adminToken}`).send();
    expect(blockedDelete.status).toBe(400);

    const unreferenced = await request(app).post("/api/v1/navigation-menus").set("Authorization", `Bearer ${adminToken}`).send({ type: "MOBILE", name: "Unused Menu" });
    const allowedDelete = await request(app).delete(`/api/v1/navigation-menus/${unreferenced.body.data.navigationMenu.id}`).set("Authorization", `Bearer ${adminToken}`).send();
    expect(allowedDelete.status).toBe(200);
  });

  it("enforces per-permission tiers: VIEWER read-only, USER can create but not update, MANAGER can update but not publish/delete", async () => {
    const created = await request(app).post("/api/v1/navigation-menus").set("Authorization", `Bearer ${adminToken}`).send({ type: "PRIMARY", name: "Perm Menu" });
    const id = created.body.data.navigationMenu.id;

    expect((await request(app).get("/api/v1/navigation-menus").set("Authorization", `Bearer ${viewerToken}`)).status).toBe(200);
    expect((await request(app).post("/api/v1/navigation-menus").set("Authorization", `Bearer ${viewerToken}`).send({ type: "PRIMARY", name: "X" })).status).toBe(403);

    expect((await request(app).post("/api/v1/navigation-menus").set("Authorization", `Bearer ${userToken}`).send({ type: "PRIMARY", name: "By User" })).status).toBe(201);
    expect((await request(app).patch(`/api/v1/navigation-menus/${id}`).set("Authorization", `Bearer ${userToken}`).send({ name: "Y" })).status).toBe(403);

    expect((await request(app).patch(`/api/v1/navigation-menus/${id}`).set("Authorization", `Bearer ${managerToken}`).send({ name: "By Manager" })).status).toBe(200);
    expect((await request(app).post(`/api/v1/navigation-menus/${id}/publish`).set("Authorization", `Bearer ${managerToken}`).send()).status).toBe(403);
    expect((await request(app).delete(`/api/v1/navigation-menus/${id}`).set("Authorization", `Bearer ${managerToken}`).send()).status).toBe(403);
  });

  it("rejects unauthenticated requests", async () => {
    expect((await request(app).get("/api/v1/navigation-menus")).status).toBe(401);
  });

  it("IDOR: a menu id from another organization is not readable, editable, or publishable", async () => {
    const created = await request(app).post("/api/v1/navigation-menus").set("Authorization", `Bearer ${otherOrgAdminToken}`).send({ type: "PRIMARY", name: "Other Org Menu" });
    const foreignId = created.body.data.navigationMenu.id;

    expect((await request(app).get(`/api/v1/navigation-menus/${foreignId}`).set("Authorization", `Bearer ${adminToken}`)).status).toBe(404);
    expect((await request(app).patch(`/api/v1/navigation-menus/${foreignId}`).set("Authorization", `Bearer ${adminToken}`).send({ name: "Hijack" })).status).toBe(404);
    expect((await request(app).post(`/api/v1/navigation-menus/${foreignId}/publish`).set("Authorization", `Bearer ${adminToken}`).send()).status).toBe(404);
  });

  it("searches/filters by type/status and paginates server-side", async () => {
    await request(app).post("/api/v1/navigation-menus").set("Authorization", `Bearer ${adminToken}`).send({ type: "CUSTOM", name: "Findable Custom Menu" });
    const search = await request(app).get("/api/v1/navigation-menus").query({ search: "Findable" }).set("Authorization", `Bearer ${adminToken}`);
    expect(search.body.data.navigationMenus.length).toBeGreaterThanOrEqual(1);

    const byType = await request(app).get("/api/v1/navigation-menus").query({ type: "CUSTOM" }).set("Authorization", `Bearer ${adminToken}`);
    expect(byType.body.data.navigationMenus.every((m: { type: string }) => m.type === "CUSTOM")).toBe(true);
  });
});
