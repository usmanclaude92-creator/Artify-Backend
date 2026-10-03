/** Phase 8 — category/tag CRUD, duplicate slug handling, org isolation, permissions. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp, finalizeApp } from "../../server/app/app";
import { disconnectPrisma } from "../../server/db/prisma";
import { resetDb } from "../helpers/db";

describe("CMS categories and tags", () => {
  const app = createApp();
  finalizeApp(app);

  let adminToken: string;
  let viewerToken: string;
  let otherOrgAdminToken: string;

  beforeAll(async () => {
    await resetDb();
    const reg = await request(app).post("/api/v1/auth/register").send({
      email: "taxonomy-admin@example.com",
      password: "OriginalPassword123",
      firstName: "Tax",
      lastName: "Admin",
      organizationName: "Taxonomy Co",
    });
    adminToken = reg.body.data.session.token;

    await request(app)
      .post("/api/v1/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ email: "taxonomy-viewer@example.com", password: "ViewerPassword123", firstName: "V", lastName: "W", roleKey: "VIEWER" });
    viewerToken = (await request(app).post("/api/v1/auth/login").send({ email: "taxonomy-viewer@example.com", password: "ViewerPassword123" })).body.data
      .session.token;

    const otherOrg = await request(app).post("/api/v1/auth/register").send({
      email: "taxonomy-other-admin@example.com",
      password: "OriginalPassword123",
      firstName: "Other",
      lastName: "Admin",
      organizationName: "Other Taxonomy Co",
    });
    otherOrgAdminToken = otherOrg.body.data.session.token;
  });

  afterAll(async () => {
    await disconnectPrisma();
  });

  it("creates, lists, updates, and deletes a category", async () => {
    const created = await request(app).post("/api/v1/categories").set("Authorization", `Bearer ${adminToken}`).send({ name: "Announcements" });
    expect(created.status).toBe(201);
    expect(created.body.data.category.slug).toBe("announcements");
    const id = created.body.data.category.id;

    const list = await request(app).get("/api/v1/categories").set("Authorization", `Bearer ${adminToken}`);
    expect(list.body.data.categories.some((c: { id: string }) => c.id === id)).toBe(true);

    const updated = await request(app).patch(`/api/v1/categories/${id}`).set("Authorization", `Bearer ${adminToken}`).send({ name: "Announcements v2" });
    expect(updated.status).toBe(200);
    expect(updated.body.data.category.name).toBe("Announcements v2");

    const del = await request(app).delete(`/api/v1/categories/${id}`).set("Authorization", `Bearer ${adminToken}`).send();
    expect(del.status).toBe(200);
    const afterDelete = await request(app).get(`/api/v1/categories/${id}`).set("Authorization", `Bearer ${adminToken}`);
    expect(afterDelete.status).toBe(404);
  });

  it("rejects a duplicate category slug within the same organization", async () => {
    await request(app).post("/api/v1/categories").set("Authorization", `Bearer ${adminToken}`).send({ name: "Dup", slug: "dup-cat" });
    const dupe = await request(app).post("/api/v1/categories").set("Authorization", `Bearer ${adminToken}`).send({ name: "Dup Two", slug: "dup-cat" });
    expect(dupe.status).toBe(409);
  });

  it("creates, lists, updates, and deletes a tag", async () => {
    const created = await request(app).post("/api/v1/tags").set("Authorization", `Bearer ${adminToken}`).send({ name: "Featured" });
    expect(created.status).toBe(201);
    const id = created.body.data.tag.id;

    const updated = await request(app).patch(`/api/v1/tags/${id}`).set("Authorization", `Bearer ${adminToken}`).send({ name: "Featured v2" });
    expect(updated.status).toBe(200);

    const del = await request(app).delete(`/api/v1/tags/${id}`).set("Authorization", `Bearer ${adminToken}`).send();
    expect(del.status).toBe(200);
    const afterDelete = await request(app).get(`/api/v1/tags/${id}`).set("Authorization", `Bearer ${adminToken}`);
    expect(afterDelete.status).toBe(404);
  });

  it("rejects a duplicate tag slug within the same organization", async () => {
    await request(app).post("/api/v1/tags").set("Authorization", `Bearer ${adminToken}`).send({ name: "Dup", slug: "dup-tag" });
    const dupe = await request(app).post("/api/v1/tags").set("Authorization", `Bearer ${adminToken}`).send({ name: "Dup Two", slug: "dup-tag" });
    expect(dupe.status).toBe(409);
  });

  it("enforces permissions: VIEWER can read but not create/update/delete", async () => {
    const created = await request(app).post("/api/v1/categories").set("Authorization", `Bearer ${adminToken}`).send({ name: "Perm Category" });
    const id = created.body.data.category.id;

    expect((await request(app).get("/api/v1/categories").set("Authorization", `Bearer ${viewerToken}`)).status).toBe(200);
    expect((await request(app).post("/api/v1/categories").set("Authorization", `Bearer ${viewerToken}`).send({ name: "X" })).status).toBe(403);
    expect((await request(app).patch(`/api/v1/categories/${id}`).set("Authorization", `Bearer ${viewerToken}`).send({ name: "Y" })).status).toBe(403);
    expect((await request(app).delete(`/api/v1/categories/${id}`).set("Authorization", `Bearer ${viewerToken}`).send()).status).toBe(403);
  });

  it("IDOR: a category/tag id from another organization is not readable or editable", async () => {
    const foreignCategory = await request(app).post("/api/v1/categories").set("Authorization", `Bearer ${otherOrgAdminToken}`).send({ name: "Foreign" });
    const foreignCategoryId = foreignCategory.body.data.category.id;
    expect((await request(app).get(`/api/v1/categories/${foreignCategoryId}`).set("Authorization", `Bearer ${adminToken}`)).status).toBe(404);
    expect((await request(app).patch(`/api/v1/categories/${foreignCategoryId}`).set("Authorization", `Bearer ${adminToken}`).send({ name: "Hijack" })).status).toBe(
      404
    );

    const foreignTag = await request(app).post("/api/v1/tags").set("Authorization", `Bearer ${otherOrgAdminToken}`).send({ name: "Foreign" });
    const foreignTagId = foreignTag.body.data.tag.id;
    expect((await request(app).get(`/api/v1/tags/${foreignTagId}`).set("Authorization", `Bearer ${adminToken}`)).status).toBe(404);
  });

  it("rejects unauthenticated requests", async () => {
    expect((await request(app).get("/api/v1/categories")).status).toBe(401);
    expect((await request(app).get("/api/v1/tags")).status).toBe(401);
  });

  // Phase 7 (Content Management upgrade) — category hierarchy, descriptions, counts, delete-in-use protection.
  describe("Phase 7 — hierarchy, counts, delete protection", () => {
    it("supports a parent/child category hierarchy and rejects a self/circular parent", async () => {
      const parent = await request(app).post("/api/v1/categories").set("Authorization", `Bearer ${adminToken}`).send({ name: "Parent Cat" });
      const parentId = parent.body.data.category.id;

      const child = await request(app)
        .post("/api/v1/categories")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ name: "Child Cat", parentId });
      expect(child.status).toBe(201);
      const childId = child.body.data.category.id;

      const list = await request(app).get("/api/v1/categories").set("Authorization", `Bearer ${adminToken}`);
      const found = list.body.data.categories.find((c: { id: string }) => c.id === childId);
      expect(found.parentId).toBe(parentId);
      expect(found.parent.id).toBe(parentId);

      const selfParent = await request(app).patch(`/api/v1/categories/${childId}`).set("Authorization", `Bearer ${adminToken}`).send({ parentId: childId });
      expect(selfParent.status).toBe(400);

      const circular = await request(app).patch(`/api/v1/categories/${parentId}`).set("Authorization", `Bearer ${adminToken}`).send({ parentId: childId });
      expect(circular.status).toBe(400);
    });

    it("reports real postCount on categories and tags, and blocks deleting one still in use", async () => {
      const category = await request(app).post("/api/v1/categories").set("Authorization", `Bearer ${adminToken}`).send({ name: "In Use Cat" });
      const categoryId = category.body.data.category.id;
      const tag = await request(app).post("/api/v1/tags").set("Authorization", `Bearer ${adminToken}`).send({ name: "In Use Tag", description: "d" });
      const tagId = tag.body.data.tag.id;

      await request(app)
        .post("/api/v1/posts")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ title: "Tagged Post", categoryId, tagIds: [tagId] });

      const categories = await request(app).get("/api/v1/categories").set("Authorization", `Bearer ${adminToken}`);
      expect(categories.body.data.categories.find((c: { id: string }) => c.id === categoryId).postCount).toBe(1);
      const tags = await request(app).get("/api/v1/tags").set("Authorization", `Bearer ${adminToken}`);
      const foundTag = tags.body.data.tags.find((t: { id: string }) => t.id === tagId);
      expect(foundTag.postCount).toBe(1);
      expect(foundTag.description).toBe("d");

      const blockedCategory = await request(app).delete(`/api/v1/categories/${categoryId}`).set("Authorization", `Bearer ${adminToken}`).send();
      expect(blockedCategory.status).toBe(400);
      const blockedTag = await request(app).delete(`/api/v1/tags/${tagId}`).set("Authorization", `Bearer ${adminToken}`).send();
      expect(blockedTag.status).toBe(400);
    });
  });
});
