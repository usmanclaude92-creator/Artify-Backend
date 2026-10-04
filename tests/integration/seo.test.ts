/** Phase 5 — redirect CRUD, auto-redirect on post slug change, chain-collapse, and the rule-based SEO audit. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp, finalizeApp } from "../../server/app/app";
import { disconnectPrisma, prisma } from "../../server/db/prisma";
import { resetDb } from "../helpers/db";

describe("SEO Control Center", () => {
  const app = createApp();
  finalizeApp(app);

  let adminToken: string;
  let viewerToken: string;
  let otherOrgAdminToken: string;

  beforeAll(async () => {
    await resetDb();
    const reg = await request(app).post("/api/v1/auth/register").send({
      email: "seo-admin@example.com",
      password: "OriginalPassword123",
      firstName: "Seo",
      lastName: "Admin",
      organizationName: "Seo Admin Co",
    });
    adminToken = reg.body.data.session.token;

    await request(app)
      .post("/api/v1/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ email: "seo-viewer@example.com", password: "ViewerPassword123", firstName: "V", lastName: "W", roleKey: "VIEWER" });
    viewerToken = (await request(app).post("/api/v1/auth/login").send({ email: "seo-viewer@example.com", password: "ViewerPassword123" })).body.data
      .session.token;

    const otherOrg = await request(app).post("/api/v1/auth/register").send({
      email: "seo-other-admin@example.com",
      password: "OriginalPassword123",
      firstName: "Other",
      lastName: "Admin",
      organizationName: "Other Seo Org",
    });
    otherOrgAdminToken = otherOrg.body.data.session.token;
  });

  afterAll(async () => {
    await disconnectPrisma();
  });

  describe("redirects CRUD", () => {
    it("creates a redirect and audits REDIRECT_CREATED", async () => {
      const res = await request(app)
        .post("/api/v1/redirects")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ fromPath: "/blog/old-slug", toPath: "/blog/new-slug" });
      expect(res.status).toBe(201);
      expect(res.body.data.redirect.fromPath).toBe("/blog/old-slug");
      expect(res.body.data.redirect.statusCode).toBe(301);

      const audit = await prisma.auditLog.findFirst({ where: { action: "REDIRECT_CREATED", resourceId: res.body.data.redirect.id } });
      expect(audit).not.toBeNull();
    });

    it("rejects a duplicate fromPath within the same organization with a clean 409", async () => {
      await request(app).post("/api/v1/redirects").set("Authorization", `Bearer ${adminToken}`).send({ fromPath: "/dup", toPath: "/target-a" });
      const dupe = await request(app).post("/api/v1/redirects").set("Authorization", `Bearer ${adminToken}`).send({ fromPath: "/dup", toPath: "/target-b" });
      expect(dupe.status).toBe(409);
    });

    it("rejects fromPath === toPath, and rejects an open-redirect payload (absolute URL / protocol-relative)", async () => {
      const same = await request(app).post("/api/v1/redirects").set("Authorization", `Bearer ${adminToken}`).send({ fromPath: "/same", toPath: "/same" });
      expect(same.status).toBe(400);

      const protocolRelative = await request(app)
        .post("/api/v1/redirects")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ fromPath: "/evil-in", toPath: "//evil.com" });
      expect(protocolRelative.status).toBe(400);

      const absoluteUrl = await request(app)
        .post("/api/v1/redirects")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ fromPath: "/evil-in-2", toPath: "/ok/https://evil.com" });
      expect(absoluteUrl.status).toBe(400);
    });

    it("updates and deletes a redirect, auditing both", async () => {
      const created = await request(app).post("/api/v1/redirects").set("Authorization", `Bearer ${adminToken}`).send({ fromPath: "/mutable", toPath: "/v1" });
      const id = created.body.data.redirect.id;

      const updated = await request(app).patch(`/api/v1/redirects/${id}`).set("Authorization", `Bearer ${adminToken}`).send({ toPath: "/v2", statusCode: 302 });
      expect(updated.status).toBe(200);
      expect(updated.body.data.redirect.toPath).toBe("/v2");
      expect(updated.body.data.redirect.statusCode).toBe(302);

      const deleted = await request(app).delete(`/api/v1/redirects/${id}`).set("Authorization", `Bearer ${adminToken}`);
      expect(deleted.status).toBe(200);

      const gone = await request(app).get(`/api/v1/redirects/${id}`).set("Authorization", `Bearer ${adminToken}`);
      expect(gone.status).toBe(404);

      const auditUpdate = await prisma.auditLog.findFirst({ where: { action: "REDIRECT_UPDATED", resourceId: id } });
      expect(auditUpdate).not.toBeNull();
      const auditDelete = await prisma.auditLog.findFirst({ where: { action: "REDIRECT_DELETED", resourceId: id } });
      expect(auditDelete).not.toBeNull();
    });

    it("rejects a redirect that would create a loop (direct and multi-hop), and supports isActive/notes", async () => {
      const direct = await request(app).post("/api/v1/redirects").set("Authorization", `Bearer ${adminToken}`).send({ fromPath: "/loop-direct", toPath: "/loop-direct-target" });
      expect(direct.status).toBe(201);
      const directSelfLoop = await request(app)
        .post("/api/v1/redirects")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ fromPath: "/loop-direct-target", toPath: "/loop-direct" });
      expect(directSelfLoop.status).toBe(409);

      await request(app).post("/api/v1/redirects").set("Authorization", `Bearer ${adminToken}`).send({ fromPath: "/loop-a", toPath: "/loop-b" });
      await request(app).post("/api/v1/redirects").set("Authorization", `Bearer ${adminToken}`).send({ fromPath: "/loop-b", toPath: "/loop-c" });
      const multiHopLoop = await request(app)
        .post("/api/v1/redirects")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ fromPath: "/loop-c", toPath: "/loop-a" });
      expect(multiHopLoop.status).toBe(409);

      const withNotes = await request(app)
        .post("/api/v1/redirects")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ fromPath: "/paused", toPath: "/paused-target", isActive: false, notes: "Temporarily disabled during migration." });
      expect(withNotes.status).toBe(201);
      expect(withNotes.body.data.redirect.isActive).toBe(false);
      expect(withNotes.body.data.redirect.notes).toBe("Temporarily disabled during migration.");

      const patched = await request(app)
        .patch(`/api/v1/redirects/${withNotes.body.data.redirect.id}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ isActive: true, notes: null });
      expect(patched.status).toBe(200);
      expect(patched.body.data.redirect.isActive).toBe(true);
      expect(patched.body.data.redirect.notes).toBeNull();

      const updateIntoLoop = await request(app)
        .patch(`/api/v1/redirects/${direct.body.data.redirect.id}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ toPath: "/loop-direct" });
      expect(updateIntoLoop.status).toBe(409);

      const inactiveOnly = await request(app).get("/api/v1/redirects").set("Authorization", `Bearer ${adminToken}`).query({ isActive: "false" });
      expect(inactiveOnly.body.data.redirects.every((r: { isActive: boolean }) => r.isActive === false)).toBe(true);
    });

    it("VIEWER can read but not create redirects; a redirect never leaks across organizations", async () => {
      const created = await request(app).post("/api/v1/redirects").set("Authorization", `Bearer ${adminToken}`).send({ fromPath: "/tenant-scoped", toPath: "/target" });
      const id = created.body.data.redirect.id;

      const viewerRead = await request(app).get(`/api/v1/redirects/${id}`).set("Authorization", `Bearer ${viewerToken}`);
      expect(viewerRead.status).toBe(200);

      const viewerCreate = await request(app).post("/api/v1/redirects").set("Authorization", `Bearer ${viewerToken}`).send({ fromPath: "/nope", toPath: "/nope-2" });
      expect(viewerCreate.status).toBe(403);

      const crossOrgRead = await request(app).get(`/api/v1/redirects/${id}`).set("Authorization", `Bearer ${otherOrgAdminToken}`);
      expect(crossOrgRead.status).toBe(404);
    });
  });

  describe("auto-redirect on post slug change", () => {
    it("creates a redirect when a PUBLISHED post's slug changes, and does not when a DRAFT post's slug changes", async () => {
      const created = await request(app).post("/api/v1/posts").set("Authorization", `Bearer ${adminToken}`).send({ title: "Slug Move", body: "v1" });
      const id = created.body.data.post.id;
      await request(app).post(`/api/v1/posts/${id}/publish`).set("Authorization", `Bearer ${adminToken}`).send();

      const renamed = await request(app).patch(`/api/v1/posts/${id}`).set("Authorization", `Bearer ${adminToken}`).send({ slug: "slug-move-renamed" });
      expect(renamed.status).toBe(200);
      expect(renamed.body.data.post.slug).toBe("slug-move-renamed");

      const list = await request(app).get("/api/v1/redirects").set("Authorization", `Bearer ${adminToken}`).query({ search: "slug-move" });
      const redirect = list.body.data.redirects.find((r: { fromPath: string }) => r.fromPath === "/blog/slug-move");
      expect(redirect).toBeTruthy();
      expect(redirect.toPath).toBe("/blog/slug-move-renamed");
      expect(redirect.resourceType).toBe("post");
      expect(redirect.resourceId).toBe(id);

      // A DRAFT post's slug is never publicly reachable, so renaming it must not create a redirect.
      const draft = await request(app).post("/api/v1/posts").set("Authorization", `Bearer ${adminToken}`).send({ title: "Never Published", body: "v1" });
      const draftId = draft.body.data.post.id;
      await request(app).patch(`/api/v1/posts/${draftId}`).set("Authorization", `Bearer ${adminToken}`).send({ slug: "never-published-renamed" });

      const noRedirect = await request(app).get("/api/v1/redirects").set("Authorization", `Bearer ${adminToken}`).query({ search: "never-published" });
      expect(noRedirect.body.data.redirects).toHaveLength(0);
    });

    it("collapses a redirect chain: renaming a post twice repoints the original redirect straight to the final slug", async () => {
      const created = await request(app).post("/api/v1/posts").set("Authorization", `Bearer ${adminToken}`).send({ title: "Chain Post", body: "v1" });
      const id = created.body.data.post.id;
      await request(app).post(`/api/v1/posts/${id}/publish`).set("Authorization", `Bearer ${adminToken}`).send();

      await request(app).patch(`/api/v1/posts/${id}`).set("Authorization", `Bearer ${adminToken}`).send({ slug: "chain-post-b" });
      await request(app).patch(`/api/v1/posts/${id}`).set("Authorization", `Bearer ${adminToken}`).send({ slug: "chain-post-c" });

      const list = await request(app).get("/api/v1/redirects").set("Authorization", `Bearer ${adminToken}`).query({ search: "chain-post", limit: 100 });
      const fromA = list.body.data.redirects.find((r: { fromPath: string }) => r.fromPath === "/blog/chain-post");
      const fromB = list.body.data.redirects.find((r: { fromPath: string }) => r.fromPath === "/blog/chain-post-b");
      // A -> C directly (repointed), not A -> B (a dead intermediate hop).
      expect(fromA.toPath).toBe("/blog/chain-post-c");
      expect(fromB.toPath).toBe("/blog/chain-post-c");
    });
  });

  describe("auto-redirect on page slug change (Phase 4)", () => {
    it("creates a redirect at the page's root-level public path when a PUBLISHED page's slug changes, and does not when a DRAFT page's slug changes", async () => {
      const created = await request(app).post("/api/v1/pages").set("Authorization", `Bearer ${adminToken}`).send({ title: "Page Slug Move", body: "v1" });
      const id = created.body.data.page.id;
      await request(app).post(`/api/v1/pages/${id}/publish`).set("Authorization", `Bearer ${adminToken}`).send();

      const renamed = await request(app).patch(`/api/v1/pages/${id}`).set("Authorization", `Bearer ${adminToken}`).send({ slug: "page-slug-move-renamed" });
      expect(renamed.status).toBe(200);
      expect(renamed.body.data.page.slug).toBe("page-slug-move-renamed");

      const list = await request(app).get("/api/v1/redirects").set("Authorization", `Bearer ${adminToken}`).query({ search: "page-slug-move" });
      const redirect = list.body.data.redirects.find((r: { fromPath: string }) => r.fromPath === "/page-slug-move");
      expect(redirect).toBeTruthy();
      expect(redirect.toPath).toBe("/page-slug-move-renamed");
      expect(redirect.resourceType).toBe("page");
      expect(redirect.resourceId).toBe(id);

      // A DRAFT page's slug is never publicly reachable, so renaming it must not create a redirect.
      const draft = await request(app).post("/api/v1/pages").set("Authorization", `Bearer ${adminToken}`).send({ title: "Never Published Page", body: "v1" });
      const draftId = draft.body.data.page.id;
      await request(app).patch(`/api/v1/pages/${draftId}`).set("Authorization", `Bearer ${adminToken}`).send({ slug: "never-published-page-renamed" });

      const noRedirect = await request(app).get("/api/v1/redirects").set("Authorization", `Bearer ${adminToken}`).query({ search: "never-published-page" });
      expect(noRedirect.body.data.redirects).toHaveLength(0);
    });
  });

  describe("public redirect lookup", () => {
    it("resolves a redirect for the configured public organization, and returns null for an unknown path", async () => {
      const { config } = await import("../../server/config/env");
      if (!config.publicWebsiteOrganizationId) return; // not configured in this env — see .env.test
      await prisma.organization.upsert({
        where: { id: config.publicWebsiteOrganizationId },
        update: {},
        create: { id: config.publicWebsiteOrganizationId, name: "Public Test Agency", slug: "seo-test-public-agency" },
      });
      await prisma.redirect.create({
        data: { organizationId: config.publicWebsiteOrganizationId, fromPath: "/blog/public-old", toPath: "/blog/public-new" },
      });

      const found = await request(app).get("/api/v1/public/redirects").query({ path: "/blog/public-old" });
      expect(found.status).toBe(200);
      expect(found.body.data.redirect).toEqual({ toPath: "/blog/public-new", statusCode: 301 });

      const missing = await request(app).get("/api/v1/public/redirects").query({ path: "/blog/never-existed" });
      expect(missing.status).toBe(200);
      expect(missing.body.data.redirect).toBeNull();

      await prisma.redirect.create({
        data: { organizationId: config.publicWebsiteOrganizationId, fromPath: "/blog/public-paused", toPath: "/blog/public-new", isActive: false },
      });
      const paused = await request(app).get("/api/v1/public/redirects").query({ path: "/blog/public-paused" });
      expect(paused.status).toBe(200);
      expect(paused.body.data.redirect).toBeNull();
    });
  });

  describe("rule-based SEO audit", () => {
    it("flags a published post with no meta title/description, and does not flag a fully-optimized one", async () => {
      const bare = await request(app).post("/api/v1/posts").set("Authorization", `Bearer ${adminToken}`).send({ title: "Bare Post", body: "v1" });
      await request(app).post(`/api/v1/posts/${bare.body.data.post.id}/publish`).set("Authorization", `Bearer ${adminToken}`).send();

      const optimized = await request(app)
        .post("/api/v1/posts")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          title: "Optimized Post",
          body: "v1",
          metadata: {
            metaTitle: "A well-sized SEO title",
            metaDescription: "A meta description that sits comfortably within the ideal fifty to one hundred sixty character range for search snippets.",
            ogImage: "https://example.com/og-image.jpg",
          },
        });
      await request(app).post(`/api/v1/posts/${optimized.body.data.post.id}/publish`).set("Authorization", `Bearer ${adminToken}`).send();

      const res = await request(app).get("/api/v1/seo/issues").set("Authorization", `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      const bareIssues = res.body.data.issues.filter((i: { resourceId: string }) => i.resourceId === bare.body.data.post.id);
      expect(bareIssues.some((i: { code: string }) => i.code === "missing_meta_title")).toBe(true);
      expect(bareIssues.some((i: { code: string }) => i.code === "missing_meta_description")).toBe(true);
      expect(
        bareIssues.filter((i: { code: string }) => i.code === "missing_meta_title" || i.code === "missing_meta_description").every((i: { severity: string }) => i.severity === "critical")
      ).toBe(true);

      const optimizedIssues = res.body.data.issues.filter((i: { resourceId: string }) => i.resourceId === optimized.body.data.post.id);
      expect(optimizedIssues).toHaveLength(0);
    });

    it("flags duplicate meta titles across two posts, and never audits an ARCHIVED post", async () => {
      const a = await request(app)
        .post("/api/v1/posts")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ title: "Dup A", body: "v1", metadata: { metaTitle: "Same SEO Title Everywhere", metaDescription: "A meta description long enough to clear the minimum useful-snippet length threshold easily." } });
      const b = await request(app)
        .post("/api/v1/posts")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ title: "Dup B", body: "v1", metadata: { metaTitle: "Same SEO Title Everywhere", metaDescription: "A meta description long enough to clear the minimum useful-snippet length threshold easily." } });

      const archived = await request(app).post("/api/v1/posts").set("Authorization", `Bearer ${adminToken}`).send({ title: "To Archive", body: "v1" });
      await request(app).post(`/api/v1/posts/${archived.body.data.post.id}/archive`).set("Authorization", `Bearer ${adminToken}`).send();

      const res = await request(app).get("/api/v1/seo/issues").set("Authorization", `Bearer ${adminToken}`);
      const ids = res.body.data.issues.map((i: { resourceId: string }) => i.resourceId);
      expect(ids).toContain(a.body.data.post.id);
      expect(ids).toContain(b.body.data.post.id);
      expect(ids).not.toContain(archived.body.data.post.id);

      const dupIssuesA = res.body.data.issues.filter((i: { resourceId: string; code: string }) => i.resourceId === a.body.data.post.id && i.code === "duplicate_meta_title");
      expect(dupIssuesA.length).toBeGreaterThan(0);
    });

    it("flags duplicate meta descriptions, invalid slug formats, and a missing social image on live content", async () => {
      const sameDescA = await request(app)
        .post("/api/v1/posts")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ title: "Desc Dup A", body: "v1", metadata: { metaTitle: "Desc Dup A Title", metaDescription: "This exact description is reused across more than one post on purpose for this test." } });
      const sameDescB = await request(app)
        .post("/api/v1/posts")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ title: "Desc Dup B", body: "v1", metadata: { metaTitle: "Desc Dup B Title", metaDescription: "This exact description is reused across more than one post on purpose for this test." } });

      const noSocialImage = await request(app)
        .post("/api/v1/posts")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ title: "No Social Image Post", body: "v1", metadata: { metaTitle: "No Social Image Post Title", metaDescription: "A meta description long enough to clear the minimum useful-snippet length threshold." } });
      await request(app).post(`/api/v1/posts/${noSocialImage.body.data.post.id}/publish`).set("Authorization", `Bearer ${adminToken}`).send();

      const res = await request(app).get("/api/v1/seo/issues").set("Authorization", `Bearer ${adminToken}`);

      const descIssuesA = res.body.data.issues.filter((i: { resourceId: string; code: string }) => i.resourceId === sameDescA.body.data.post.id && i.code === "duplicate_meta_description");
      expect(descIssuesA.length).toBeGreaterThan(0);
      const descIssuesB = res.body.data.issues.filter((i: { resourceId: string; code: string }) => i.resourceId === sameDescB.body.data.post.id && i.code === "duplicate_meta_description");
      expect(descIssuesB.length).toBeGreaterThan(0);

      const socialIssues = res.body.data.issues.filter((i: { resourceId: string; code: string }) => i.resourceId === noSocialImage.body.data.post.id && i.code === "missing_social_image");
      expect(socialIssues.length).toBeGreaterThan(0);

      // Passes the input schema's looser regex (lowercase + hyphens) but is not
      // what this system's own slugify() would ever produce (double hyphen).
      const oddSlug = await request(app)
        .post("/api/v1/posts")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ title: "Odd Slug Post", body: "v1", slug: "odd--slug" });
      const auditAfterOddSlug = await request(app).get("/api/v1/seo/issues").set("Authorization", `Bearer ${adminToken}`);
      const oddSlugIssues = auditAfterOddSlug.body.data.issues.filter((i: { resourceId: string; code: string }) => i.resourceId === oddSlug.body.data.post.id && i.code === "invalid_slug_format");
      expect(oddSlugIssues.length).toBeGreaterThan(0);
    });

    it("never leaks another organization's SEO issues", async () => {
      const otherOrgIssues = await request(app).get("/api/v1/seo/issues").set("Authorization", `Bearer ${otherOrgAdminToken}`);
      expect(otherOrgIssues.status).toBe(200);
      expect(otherOrgIssues.body.data.issues).toHaveLength(0);
    });
  });
});
