/** Phase 7 §49 — product catalog CRUD: create/read/update/archive, duplicate code/slug, search/filter/pagination/sorting, concurrency, permissions. Phase 10 extends this with SOLUTION type, categories/industries, revisions/rollback, relations, duplicate, bulk archive, and public rendering. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp, finalizeApp } from "../../server/app/app";
import { disconnectPrisma, prisma } from "../../server/db/prisma";
import { resetDb } from "../helpers/db";
import { config } from "../../server/config/env";

describe("product catalog", () => {
  const app = createApp();
  finalizeApp(app);

  let adminToken: string;
  let viewerToken: string;

  beforeAll(async () => {
    await resetDb();
    const reg = await request(app).post("/api/v1/auth/register").send({
      email: "product-admin@example.com",
      password: "OriginalPassword123",
      firstName: "Product",
      lastName: "Admin",
      organizationName: "Product Admin Co",
    });
    adminToken = reg.body.data.session.token;

    await request(app)
      .post("/api/v1/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ email: "product-viewer@example.com", password: "ViewerPassword123", firstName: "V", lastName: "W", roleKey: "VIEWER" });
    const viewerLogin = await request(app).post("/api/v1/auth/login").send({ email: "product-viewer@example.com", password: "ViewerPassword123" });
    viewerToken = viewerLogin.body.data.session.token;
  });

  afterAll(async () => {
    await disconnectPrisma();
  });

  it("creates a product with a server-generated slug and normalizes/uppercases the code, and audits PRODUCT_CREATED", async () => {
    const res = await request(app)
      .post("/api/v1/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ code: " hcms-01 ", name: "Artify HCMS", type: "PRODUCT", shortDescription: "HR & payroll suite" });
    expect(res.status).toBe(201);
    expect(res.body.data.product.code).toBe("HCMS-01");
    expect(res.body.data.product.slug).toBe("artify-hcms");
    expect(res.body.data.product.status).toBe("DRAFT");

    const audit = await prisma.auditLog.findFirst({ where: { action: "PRODUCT_CREATED", resourceId: res.body.data.product.id } });
    expect(audit).not.toBeNull();
  });

  it("rejects a duplicate product code with a clear 409 conflict", async () => {
    await request(app)
      .post("/api/v1/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ code: "PAYROLL-01", name: "Payroll One", type: "PRODUCT" });
    const dupe = await request(app)
      .post("/api/v1/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ code: "PAYROLL-01", name: "Payroll Two", type: "PRODUCT" });
    expect(dupe.status).toBe(409);
  });

  it("rejects a duplicate product slug with a clear 409 conflict", async () => {
    await request(app)
      .post("/api/v1/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ code: "CRM-A", name: "CRM Alpha", type: "SERVICE", slug: "shared-slug" });
    const dupe = await request(app)
      .post("/api/v1/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ code: "CRM-B", name: "CRM Beta", type: "SERVICE", slug: "shared-slug" });
    expect(dupe.status).toBe(409);
  });

  it("updates a product, validates lifecycle transitions server-side, and rejects setting ARCHIVED via generic update", async () => {
    const created = await request(app)
      .post("/api/v1/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ code: "CONSULT-01", name: "Consulting", type: "SERVICE" });
    const id = created.body.data.product.id;

    const activate = await request(app).patch(`/api/v1/products/${id}`).set("Authorization", `Bearer ${adminToken}`).send({ status: "ACTIVE" });
    expect(activate.status).toBe(200);
    expect(activate.body.data.product.status).toBe("ACTIVE");

    const badArchive = await request(app).patch(`/api/v1/products/${id}`).set("Authorization", `Bearer ${adminToken}`).send({ status: "ARCHIVED" });
    expect(badArchive.status).toBe(400);

    const deactivate = await request(app).patch(`/api/v1/products/${id}`).set("Authorization", `Bearer ${adminToken}`).send({ status: "INACTIVE" });
    expect(deactivate.status).toBe(200);

    const audit = await prisma.auditLog.findFirst({ where: { action: "PRODUCT_UPDATED", resourceId: id } });
    expect(audit).not.toBeNull();
  });

  it("archives a product via the dedicated endpoint, preserving the row and rejecting further edits", async () => {
    const created = await request(app)
      .post("/api/v1/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ code: "ARCHIVE-01", name: "Archive Me", type: "PRODUCT" });
    const id = created.body.data.product.id;

    const archive = await request(app).post(`/api/v1/products/${id}/archive`).set("Authorization", `Bearer ${adminToken}`).send();
    expect(archive.status).toBe(200);
    expect(archive.body.data.product.status).toBe("ARCHIVED");

    const stillExists = await prisma.product.findUnique({ where: { id } });
    expect(stillExists).not.toBeNull();

    const editAttempt = await request(app).patch(`/api/v1/products/${id}`).set("Authorization", `Bearer ${adminToken}`).send({ name: "Renamed" });
    expect(editAttempt.status).toBe(409);

    const reArchive = await request(app).post(`/api/v1/products/${id}/archive`).set("Authorization", `Bearer ${adminToken}`).send();
    expect(reArchive.status).toBe(409);

    const audit = await prisma.auditLog.findFirst({ where: { action: "PRODUCT_ARCHIVED", resourceId: id } });
    expect(audit).not.toBeNull();
  });

  it("searches/filters/paginates/sorts the catalog server-side", async () => {
    await request(app).post("/api/v1/products").set("Authorization", `Bearer ${adminToken}`).send({ code: "SEARCH-A", name: "Findable Alpha", type: "PRODUCT" });
    await request(app).post("/api/v1/products").set("Authorization", `Bearer ${adminToken}`).send({ code: "SEARCH-B", name: "Findable Beta", type: "SERVICE" });

    const search = await request(app).get("/api/v1/products").query({ search: "Findable" }).set("Authorization", `Bearer ${adminToken}`);
    expect(search.status).toBe(200);
    expect(search.body.data.products.length).toBeGreaterThanOrEqual(2);

    const filtered = await request(app).get("/api/v1/products").query({ type: "SERVICE", search: "Findable" }).set("Authorization", `Bearer ${adminToken}`);
    expect(filtered.body.data.products.every((p: { type: string }) => p.type === "SERVICE")).toBe(true);

    const paged = await request(app).get("/api/v1/products").query({ page: 1, limit: 1 }).set("Authorization", `Bearer ${adminToken}`);
    expect(paged.body.data.products).toHaveLength(1);
    expect(paged.body.meta.pagination.limit).toBe(1);

    const sorted = await request(app).get("/api/v1/products").query({ sort: "name", order: "asc", limit: 100 }).set("Authorization", `Bearer ${adminToken}`);
    const names = sorted.body.data.products.map((p: { name: string }) => p.name);
    // Postgres's default collation (locale-aware) and JS's Array.sort()
    // (binary/UTF-16 code-unit order) disagree on mixed-case strings — e.g.
    // "Consulting" vs "CRM Alpha". localeCompare matches the DB's ordering.
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it("rejects an unsafe sort field", async () => {
    const res = await request(app).get("/api/v1/products").query({ sort: "1; DROP TABLE products;--" }).set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(400);
  });

  it("enforces permissions: a VIEWER can read but not create/update/archive", async () => {
    const created = await request(app)
      .post("/api/v1/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ code: "PERM-01", name: "Permission Test", type: "PRODUCT" });
    const id = created.body.data.product.id;

    const list = await request(app).get("/api/v1/products").set("Authorization", `Bearer ${viewerToken}`);
    expect(list.status).toBe(200);

    const createRes = await request(app).post("/api/v1/products").set("Authorization", `Bearer ${viewerToken}`).send({ code: "PERM-02", name: "X", type: "PRODUCT" });
    expect(createRes.status).toBe(403);

    const updateRes = await request(app).patch(`/api/v1/products/${id}`).set("Authorization", `Bearer ${viewerToken}`).send({ name: "Y" });
    expect(updateRes.status).toBe(403);

    const archiveRes = await request(app).post(`/api/v1/products/${id}/archive`).set("Authorization", `Bearer ${viewerToken}`).send();
    expect(archiveRes.status).toBe(403);
  });

  it("rejects unauthenticated requests", async () => {
    const res = await request(app).get("/api/v1/products");
    expect(res.status).toBe(401);
  });

  it("concurrency: two simultaneous creates with the same product code produce exactly one success and one clean conflict", async () => {
    const payload = { code: "RACE-01", name: "Race Condition Co", type: "PRODUCT" as const };
    const [first, second] = await Promise.all([
      request(app).post("/api/v1/products").set("Authorization", `Bearer ${adminToken}`).send(payload),
      request(app).post("/api/v1/products").set("Authorization", `Bearer ${adminToken}`).send(payload),
    ]);
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([201, 409]);

    const count = await prisma.product.count({ where: { code: "RACE-01" } });
    expect(count).toBe(1);
  });

  it("concurrency: two simultaneous creates with the same explicit slug produce exactly one success and one clean conflict", async () => {
    const [first, second] = await Promise.all([
      request(app).post("/api/v1/products").set("Authorization", `Bearer ${adminToken}`).send({ code: "SLUGRACE-A", name: "A", type: "PRODUCT", slug: "race-slug" }),
      request(app).post("/api/v1/products").set("Authorization", `Bearer ${adminToken}`).send({ code: "SLUGRACE-B", name: "B", type: "PRODUCT", slug: "race-slug" }),
    ]);
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([201, 409]);

    const count = await prisma.product.count({ where: { slug: "race-slug" } });
    expect(count).toBe(1);
  });

  // --- Phase 10 (Products + Services + Solutions) ---

  it("creates a SOLUTION-type product with benefits/features/businessProblem content, and revisions it on update", async () => {
    const created = await request(app)
      .post("/api/v1/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        code: "SOL-01",
        name: "Zero-Touch Close",
        type: "SOLUTION",
        content: { benefits: ["Faster close", "Fewer errors"], features: ["Auto-reconciliation"], businessProblem: "Manual month-end close takes too long." },
      });
    expect(created.status).toBe(201);
    const id = created.body.data.product.id;
    expect(created.body.data.product.type).toBe("SOLUTION");
    expect(created.body.data.product.currentRevision.content.benefits).toEqual(["Faster close", "Fewer errors"]);
    expect(created.body.data.product.currentRevision.version).toBe(1);

    const updated = await request(app)
      .patch(`/api/v1/products/${id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ content: { benefits: ["Faster close", "Fewer errors", "Audit trail"] } });
    expect(updated.status).toBe(200);
    expect(updated.body.data.product.currentRevision.version).toBe(2);
    // Updating only `benefits` must not drop the earlier `features`/`businessProblem` (merged, not replaced).
    expect(updated.body.data.product.currentRevision.content.features).toEqual(["Auto-reconciliation"]);
    expect(updated.body.data.product.currentRevision.content.businessProblem).toBe("Manual month-end close takes too long.");

    const revisions = await request(app).get(`/api/v1/products/${id}/revisions`).set("Authorization", `Bearer ${adminToken}`);
    expect(revisions.status).toBe(200);
    expect(revisions.body.data.revisions).toHaveLength(2);

    const revertTarget = revisions.body.data.revisions.find((r: { version: number }) => r.version === 1);
    const reverted = await request(app).post(`/api/v1/products/${id}/revert`).set("Authorization", `Bearer ${adminToken}`).send({ revisionId: revertTarget.id });
    expect(reverted.status).toBe(200);
    expect(reverted.body.data.product.currentRevision.version).toBe(3);
    expect(reverted.body.data.product.currentRevision.content.benefits).toEqual(["Faster close", "Fewer errors"]);

    const audit = await prisma.auditLog.findFirst({ where: { action: "PRODUCT_REVERTED", resourceId: id } });
    expect(audit).not.toBeNull();
  });

  it("manages product categories: create/update, assignment, and refuses deletion while a product still references it", async () => {
    const category = await request(app).post("/api/v1/product-categories").set("Authorization", `Bearer ${adminToken}`).send({ name: "HR Platforms" });
    expect(category.status).toBe(201);
    const categoryId = category.body.data.category.id;
    expect(category.body.data.category.slug).toBe("hr-platforms");

    const product = await request(app)
      .post("/api/v1/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ code: "CAT-01", name: "Category Test", type: "PRODUCT", categoryId });
    expect(product.status).toBe(201);
    expect(product.body.data.product.category.id).toBe(categoryId);

    const deleteAttempt = await request(app).delete(`/api/v1/product-categories/${categoryId}`).set("Authorization", `Bearer ${adminToken}`);
    expect(deleteAttempt.status).toBe(409);

    const badCategory = await request(app)
      .post("/api/v1/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ code: "CAT-02", name: "Bad Category", type: "PRODUCT", categoryId: "00000000-0000-0000-0000-000000000000" });
    expect(badCategory.status).toBe(400);
  });

  it("manages industries: create, tag a SOLUTION product with industries, and refuses deletion while tagged", async () => {
    const industry = await request(app).post("/api/v1/industries").set("Authorization", `Bearer ${adminToken}`).send({ name: "Finance & Accounting" });
    expect(industry.status).toBe(201);
    const industryId = industry.body.data.industry.id;

    const product = await request(app)
      .post("/api/v1/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ code: "IND-01", name: "Industry Test", type: "SOLUTION", industryIds: [industryId] });
    expect(product.status).toBe(201);
    expect(product.body.data.product.industries.map((i: { industryId: string }) => i.industryId)).toEqual([industryId]);

    const deleteAttempt = await request(app).delete(`/api/v1/industries/${industryId}`).set("Authorization", `Bearer ${adminToken}`);
    expect(deleteAttempt.status).toBe(409);
  });

  it("rejects relatedProductIds that don't exist or include the product itself", async () => {
    const a = await request(app).post("/api/v1/products").set("Authorization", `Bearer ${adminToken}`).send({ code: "REL-A", name: "Related A", type: "PRODUCT" });
    const idA = a.body.data.product.id;

    const selfRelate = await request(app).patch(`/api/v1/products/${idA}`).set("Authorization", `Bearer ${adminToken}`).send({ relatedProductIds: [idA] });
    expect(selfRelate.status).toBe(400);

    const fakeRelate = await request(app)
      .patch(`/api/v1/products/${idA}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ relatedProductIds: ["00000000-0000-0000-0000-000000000000"] });
    expect(fakeRelate.status).toBe(400);

    const b = await request(app).post("/api/v1/products").set("Authorization", `Bearer ${adminToken}`).send({ code: "REL-B", name: "Related B", type: "SERVICE" });
    const idB = b.body.data.product.id;
    const realRelate = await request(app).patch(`/api/v1/products/${idA}`).set("Authorization", `Bearer ${adminToken}`).send({ relatedProductIds: [idB] });
    expect(realRelate.status).toBe(200);
    // Visible from the other side too — stored once, queried both directions.
    const detailB = await request(app).get(`/api/v1/products/${idB}`).set("Authorization", `Bearer ${adminToken}`);
    expect(detailB.body.data.product.relatedTo.map((r: { fromProductId: string }) => r.fromProductId)).toEqual([idA]);
  });

  it("duplicates a product with a fresh code/slug, DRAFT status, and the same revision content", async () => {
    const original = await request(app)
      .post("/api/v1/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ code: "DUP-01", name: "Dup Source", type: "SERVICE", status: "ACTIVE", content: { benefits: ["Real benefit"] } });
    const id = original.body.data.product.id;

    const dup = await request(app).post(`/api/v1/products/${id}/duplicate`).set("Authorization", `Bearer ${adminToken}`).send();
    expect(dup.status).toBe(201);
    expect(dup.body.data.product.id).not.toBe(id);
    expect(dup.body.data.product.code).not.toBe("DUP-01");
    expect(dup.body.data.product.slug).not.toBe(original.body.data.product.slug);
    expect(dup.body.data.product.status).toBe("DRAFT");
    expect(dup.body.data.product.currentRevision.content.benefits).toEqual(["Real benefit"]);
  });

  it("bulk-archives a mixed set of valid and already-archived product ids without failing the whole batch", async () => {
    const a = await request(app).post("/api/v1/products").set("Authorization", `Bearer ${adminToken}`).send({ code: "BULK-A", name: "Bulk A", type: "PRODUCT" });
    const b = await request(app).post("/api/v1/products").set("Authorization", `Bearer ${adminToken}`).send({ code: "BULK-B", name: "Bulk B", type: "PRODUCT" });
    const idA = a.body.data.product.id;
    const idB = b.body.data.product.id;
    await request(app).post(`/api/v1/products/${idA}/archive`).set("Authorization", `Bearer ${adminToken}`).send();

    const bulk = await request(app).post("/api/v1/products/bulk/archive").set("Authorization", `Bearer ${adminToken}`).send({ ids: [idA, idB] });
    expect(bulk.status).toBe(200);
    expect(bulk.body.data.archived).toBe(1);
    expect(bulk.body.data.skipped).toEqual([idA]);

    const refreshedB = await prisma.product.findUnique({ where: { id: idB } });
    expect(refreshedB?.status).toBe("ARCHIVED");
  });

  it("validates featuredMediaId/content.ctaFormId against real rows in the public website's organization", async () => {
    if (!config.publicWebsiteOrganizationId) return; // not configured in this env
    await prisma.organization.upsert({
      where: { id: config.publicWebsiteOrganizationId },
      update: {},
      create: { id: config.publicWebsiteOrganizationId, name: "Public Test Agency", slug: "products-test-public-agency" },
    });
    const media = await prisma.mediaAsset.create({
      data: {
        organizationId: config.publicWebsiteOrganizationId,
        originalFilename: "hero.jpg",
        storageProvider: "local",
        storageBucket: "test",
        storageKey: `products-test/${Date.now()}-hero.jpg`,
        mimeType: "image/jpeg",
        sizeBytes: 1024,
        visibility: "PUBLIC",
        status: "ACTIVE",
      },
    });

    const badMedia = await request(app)
      .post("/api/v1/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ code: "MEDIA-BAD", name: "Bad Media", type: "PRODUCT", featuredMediaId: "00000000-0000-0000-0000-000000000000" });
    expect(badMedia.status).toBe(400);

    const goodMedia = await request(app)
      .post("/api/v1/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ code: "MEDIA-GOOD", name: "Good Media", type: "PRODUCT", featuredMediaId: media.id });
    expect(goodMedia.status).toBe(201);
    expect(goodMedia.body.data.product.featuredMediaId).toBe(media.id);

    const badCta = await request(app)
      .post("/api/v1/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ code: "CTA-BAD", name: "Bad CTA", type: "SOLUTION", content: { ctaFormId: "00000000-0000-0000-0000-000000000000" } });
    expect(badCta.status).toBe(400);
  });

  it("renders a real SOLUTION product on the public API with its benefits/features/relatedProducts/industries/category, and an ARCHIVED one 404s", async () => {
    const category = await request(app).post("/api/v1/product-categories").set("Authorization", `Bearer ${adminToken}`).send({ name: "Public Category" });
    const industry = await request(app).post("/api/v1/industries").set("Authorization", `Bearer ${adminToken}`).send({ name: "Public Industry" });
    const related = await request(app).post("/api/v1/products").set("Authorization", `Bearer ${adminToken}`).send({ code: "PUB-REL", name: "Public Related", type: "PRODUCT", status: "ACTIVE" });

    const created = await request(app)
      .post("/api/v1/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        code: "PUB-SOL",
        name: "Public Solution",
        type: "SOLUTION",
        status: "ACTIVE",
        categoryId: category.body.data.category.id,
        industryIds: [industry.body.data.industry.id],
        relatedProductIds: [related.body.data.product.id],
        content: { benefits: ["Real public benefit"], businessProblem: "A real problem." },
      });
    expect(created.status).toBe(201);
    const slug = created.body.data.product.slug;

    const pub = await request(app).get(`/api/v1/public/products/${slug}`);
    expect(pub.status).toBe(200);
    expect(pub.body.data.product.benefits).toEqual(["Real public benefit"]);
    expect(pub.body.data.product.businessProblem).toBe("A real problem.");
    expect(pub.body.data.product.category.name).toBe("Public Category");
    expect(pub.body.data.product.industries.map((i: { name: string }) => i.name)).toEqual(["Public Industry"]);
    expect(pub.body.data.product.relatedProducts.map((p: { slug: string }) => p.slug)).toEqual([related.body.data.product.slug]);
    // Never a raw internal id leaked to a public caller.
    expect(pub.body.data.product.id).toBeUndefined();

    await request(app).post(`/api/v1/products/${created.body.data.product.id}/archive`).set("Authorization", `Bearer ${adminToken}`).send();
    const after = await request(app).get(`/api/v1/public/products/${slug}`);
    expect(after.status).toBe(404);
  });

  it("enforces product_categories.manage / industries.manage permissions: a VIEWER can read but not create", async () => {
    const viewerCategoryRead = await request(app).get("/api/v1/product-categories").set("Authorization", `Bearer ${viewerToken}`);
    expect(viewerCategoryRead.status).toBe(200);
    const viewerCategoryCreate = await request(app).post("/api/v1/product-categories").set("Authorization", `Bearer ${viewerToken}`).send({ name: "Nope" });
    expect(viewerCategoryCreate.status).toBe(403);

    const viewerIndustryRead = await request(app).get("/api/v1/industries").set("Authorization", `Bearer ${viewerToken}`);
    expect(viewerIndustryRead.status).toBe(200);
    const viewerIndustryCreate = await request(app).post("/api/v1/industries").set("Authorization", `Bearer ${viewerToken}`).send({ name: "Nope" });
    expect(viewerIndustryCreate.status).toBe(403);
  });
});
