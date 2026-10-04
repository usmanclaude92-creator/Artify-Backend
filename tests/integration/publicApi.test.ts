/**
 * Phase 11 §19 — public website API: published-only CMS projection, active-only
 * product catalog, public lead intake, rate limiting, output projection
 * (no private/internal field leakage), tenant isolation.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp, finalizeApp } from "../../server/app/app";
import { disconnectPrisma, prisma } from "../../server/db/prisma";
import { config } from "../../server/config/env";
import { resetDb } from "../helpers/db";

const PUBLIC_ORG_ID = config.publicWebsiteOrganizationId;

describe("public website API", () => {
  const app = createApp();
  finalizeApp(app);

  let publishedPageSlug: string;
  let draftPageSlug: string;
  let publishedPostSlug: string;
  let draftPostSlug: string;
  let scheduledPostSlug: string;
  let archivedPostSlug: string;
  let categorySlug: string;
  let activeProductSlug: string;
  let draftProductSlug: string;
  let archivedProductSlug: string;
  let otherOrgPageSlug: string;
  let publishedCaseStudySlug: string;
  let draftCaseStudySlug: string;
  let caseStudyIndustrySlug: string;
  let caseStudyProductSlug: string;

  beforeAll(async () => {
    await resetDb();
    expect(PUBLIC_ORG_ID).toBeTruthy(); // .env.test must configure this — see .env.test

    await prisma.organization.create({ data: { id: PUBLIC_ORG_ID, name: "Public Test Agency", slug: "public-test-agency" } });
    const otherOrg = await prisma.organization.create({ data: { name: "Other Agency", slug: "other-agency-public-test" } });

    // A published page.
    const page = await prisma.page.create({ data: { organizationId: PUBLIC_ORG_ID, slug: "about-us", title: "About Us", status: "DRAFT" } });
    const pageRevision = await prisma.contentRevision.create({
      data: { pageId: page.id, version: 1, status: "PUBLISHED", title: "About Us", body: "<p>We build things.</p>", metadata: { metaTitle: "About Artify" } },
    });
    await prisma.page.update({ where: { id: page.id }, data: { status: "PUBLISHED", currentRevisionId: pageRevision.id, publishedAt: new Date() } });
    publishedPageSlug = page.slug;

    // A draft page — must never be publicly reachable.
    const draftPage = await prisma.page.create({ data: { organizationId: PUBLIC_ORG_ID, slug: "secret-draft-page", title: "Secret Draft", status: "DRAFT" } });
    draftPageSlug = draftPage.slug;

    // A page belonging to a DIFFERENT organization, same-looking slug — must never leak through the public org.
    const otherPage = await prisma.page.create({ data: { organizationId: otherOrg.id, slug: "other-org-page", title: "Other Org Page", status: "PUBLISHED" } });
    otherOrgPageSlug = otherPage.slug;

    const category = await prisma.category.create({ data: { organizationId: PUBLIC_ORG_ID, slug: "engineering", name: "Engineering" } });
    categorySlug = category.slug;

    // A published post with category/tags.
    const tag = await prisma.tag.create({ data: { organizationId: PUBLIC_ORG_ID, slug: "ai", name: "AI" } });
    const post = await prisma.post.create({
      data: { organizationId: PUBLIC_ORG_ID, slug: "hello-world", title: "Hello World", status: "DRAFT", categoryId: category.id },
    });
    const postRevision = await prisma.contentRevision.create({
      data: { postId: post.id, version: 1, status: "PUBLISHED", title: "Hello World", body: "<p>First post.</p>", metadata: {} },
    });
    await prisma.post.update({ where: { id: post.id }, data: { status: "PUBLISHED", currentRevisionId: postRevision.id, publishedAt: new Date() } });
    await prisma.postTag.create({ data: { postId: post.id, tagId: tag.id } });
    publishedPostSlug = post.slug;

    // Never-publicly-reachable posts: DRAFT, IN_REVIEW→SCHEDULED, ARCHIVED.
    const draftPost = await prisma.post.create({ data: { organizationId: PUBLIC_ORG_ID, slug: "draft-post", title: "Draft Post", status: "DRAFT" } });
    draftPostSlug = draftPost.slug;
    const scheduledPost = await prisma.post.create({
      data: { organizationId: PUBLIC_ORG_ID, slug: "scheduled-post", title: "Scheduled Post", status: "SCHEDULED", scheduledAt: new Date(Date.now() + 86400000) },
    });
    scheduledPostSlug = scheduledPost.slug;
    const archivedPost = await prisma.post.create({ data: { organizationId: PUBLIC_ORG_ID, slug: "archived-post", title: "Archived Post", status: "ARCHIVED" } });
    archivedPostSlug = archivedPost.slug;

    // Products: ACTIVE (visible), DRAFT (hidden), ARCHIVED (hidden).
    const activeProduct = await prisma.product.create({ data: { code: "PUB-ACTIVE", name: "Public Active Product", slug: "public-active-product", type: "PRODUCT", status: "ACTIVE" } });
    activeProductSlug = activeProduct.slug;
    await prisma.productModule.create({ data: { productId: activeProduct.id, code: "MOD-1", name: "Core Module", slug: "core-module", status: "ACTIVE", displayOrder: 0 } });
    await prisma.productModule.create({ data: { productId: activeProduct.id, code: "MOD-2", name: "Hidden Draft Module", slug: "hidden-draft-module", status: "DRAFT", displayOrder: 1 } });

    const draftProduct = await prisma.product.create({ data: { code: "PUB-DRAFT", name: "Public Draft Product", slug: "public-draft-product", type: "PRODUCT", status: "DRAFT" } });
    draftProductSlug = draftProduct.slug;
    const archivedProduct = await prisma.product.create({ data: { code: "PUB-ARCHIVED", name: "Public Archived Product", slug: "public-archived-product", type: "PRODUCT", status: "ARCHIVED" } });
    archivedProductSlug = archivedProduct.slug;

    // Phase 11 — Case Studies: a PUBLISHED one with real relationships (industry/product/related page/related post), and a DRAFT one that must never be publicly reachable.
    const csIndustry = await prisma.industry.create({ data: { slug: "finance-accounting-public-test", name: "Finance & Accounting" } });
    caseStudyIndustrySlug = csIndustry.slug;
    const csProduct = await prisma.product.create({ data: { code: "PUB-CS-PROD", name: "Zero-Touch Close", slug: "zero-touch-close-public-test", type: "SOLUTION", status: "ACTIVE" } });
    caseStudyProductSlug = csProduct.slug;

    const caseStudy = await prisma.caseStudy.create({
      data: { organizationId: PUBLIC_ORG_ID, slug: "acme-zero-touch-close", title: "Acme Zero-Touch Close", status: "DRAFT", clientName: "Acme Corp", industryId: csIndustry.id },
    });
    const csRevision = await prisma.contentRevision.create({
      data: {
        caseStudyId: caseStudy.id,
        version: 1,
        status: "PUBLISHED",
        title: "Acme Zero-Touch Close",
        body: "<p>How Acme closed the books in 1 day.</p>",
        metadata: { metaTitle: "Acme Case Study", challenge: "Manual close took 10 days.", technologies: ["React"] },
      },
    });
    await prisma.caseStudy.update({ where: { id: caseStudy.id }, data: { status: "PUBLISHED", currentRevisionId: csRevision.id, publishedAt: new Date() } });
    await prisma.caseStudyProduct.create({ data: { caseStudyId: caseStudy.id, productId: csProduct.id } });
    await prisma.caseStudyRelatedPage.create({ data: { caseStudyId: caseStudy.id, pageId: page.id } });
    await prisma.caseStudyRelatedPost.create({ data: { caseStudyId: caseStudy.id, postId: post.id } });
    publishedCaseStudySlug = caseStudy.slug;

    const draftCaseStudy = await prisma.caseStudy.create({
      data: { organizationId: PUBLIC_ORG_ID, slug: "secret-draft-case-study", title: "Secret Draft Case Study", status: "DRAFT" },
    });
    draftCaseStudySlug = draftCaseStudy.slug;
  });

  afterAll(async () => {
    await disconnectPrisma();
  });

  it("GET /public/site reports configured=true when PUBLIC_WEBSITE_ORGANIZATION_ID is set", async () => {
    const res = await request(app).get("/api/v1/public/site");
    expect(res.status).toBe(200);
    expect(res.body.data.configured).toBe(true);
  });

  it("returns a published page by slug, with body/seo/featuredMedia projection, no internal fields", async () => {
    const res = await request(app).get(`/api/v1/public/pages/${publishedPageSlug}`);
    expect(res.status).toBe(200);
    expect(res.body.data.page.title).toBe("About Us");
    expect(res.body.data.page.body).toContain("We build things");
    // metaTitle is the page's own; metaDescription was never set on this
    // page, so it falls back to the organization's Site Identity default
    // (Phase 8 global -> content SEO precedence) instead of being absent.
    expect(res.body.data.page.seo.metaTitle).toBe("About Artify");
    expect(res.body.data.page.seo.metaDescription).toBe(
      "Your Business. Reimagined by AI. We engineer intelligent software systems that understand your business, automate processes, and connect your data."
    );
    expect(res.body.data.page).not.toHaveProperty("organizationId");
    expect(res.body.data.page).not.toHaveProperty("id");
    expect(res.body.data.page).not.toHaveProperty("createdById");
  });

  it("falls back to the organization's Site Identity defaults for metaTitle/metaDescription when content has none, but a content-level value always wins", async () => {
    const { siteSettingsService } = await import("../../server/services/siteSettingsService");
    const identity = await siteSettingsService.getPublishedSiteIdentity(PUBLIC_ORG_ID);
    expect(identity.defaultMetaTitle).toBeTruthy();

    const bareRes = await request(app).get(`/api/v1/public/posts/${publishedPostSlug}`);
    expect(bareRes.status).toBe(200);
    expect(bareRes.body.data.post.seo.metaTitle).toBe(identity.defaultMetaTitle);
    expect(bareRes.body.data.post.seo.metaDescription).toBe(identity.defaultMetaDescription);

    // A page with its own metaTitle keeps it — defaults only fill genuinely unset fields.
    const ownTitleRes = await request(app).get(`/api/v1/public/pages/${publishedPageSlug}`);
    expect(ownTitleRes.body.data.page.seo.metaTitle).toBe("About Artify");
  });

  it("a page with no editor composition reports editorBlocks: null — pure body-HTML rendering, unchanged from before Phase 2", async () => {
    const res = await request(app).get(`/api/v1/public/pages/${publishedPageSlug}`);
    expect(res.status).toBe(200);
    expect(res.body.data.page.editorBlocks).toBeNull();
  });

  it("surfaces editorBlocks only once the current revision has a genuinely non-empty saved block document (Phase 2 safe-fallback)", async () => {
    const page = await prisma.page.create({ data: { organizationId: PUBLIC_ORG_ID, slug: "block-built-page", title: "Block Built Page", status: "DRAFT" } });
    const doc = { version: 1, blocks: [{ id: "h1", type: "heading", props: { text: "Hi", level: 2 } }] };
    const revision = await prisma.contentRevision.create({
      data: { pageId: page.id, version: 1, status: "PUBLISHED", title: "Block Built Page", body: "<h2>Hi</h2>", metadata: {}, editorBlocks: doc },
    });
    await prisma.page.update({ where: { id: page.id }, data: { status: "PUBLISHED", currentRevisionId: revision.id, publishedAt: new Date() } });

    const res = await request(app).get("/api/v1/public/pages/block-built-page");
    expect(res.status).toBe(200);
    expect(res.body.data.page.editorBlocks).toEqual(doc);
    // The flattened body fallback is still present too — a renderer that
    // doesn't yet understand editorBlocks shows this instead.
    expect(res.body.data.page.body).toContain("<h2>Hi</h2>");
  });

  // Phase 1 (Website module) — the public page projection additively
  // surfaces pageType/isHomepage/template
  // (docs/control-center-public-site-integration.md). A page with no
  // template assigned (the case above, and every page that existed before
  // this phase) is completely unaffected: pageType "STANDARD",
  // isHomepage false, template null.
  it("a page with no template assigned reports pageType STANDARD, isHomepage false, template null — pre-Phase-1 behavior, unchanged", async () => {
    const res = await request(app).get(`/api/v1/public/pages/${publishedPageSlug}`);
    expect(res.status).toBe(200);
    expect(res.body.data.page.pageType).toBe("STANDARD");
    expect(res.body.data.page.isHomepage).toBe(false);
    expect(res.body.data.page.template).toBeNull();
  });

  it("surfaces template structure only when both the template and its current revision are genuinely PUBLISHED", async () => {
    const template = await prisma.template.create({ data: { organizationId: PUBLIC_ORG_ID, type: "STANDARD_PAGE", slug: "public-template", name: "Public Template", status: "DRAFT" } });
    const revision = await prisma.templateRevision.create({ data: { templateId: template.id, version: 1, status: "DRAFT", name: "Public Template", structure: { regions: ["a"] } } });
    await prisma.template.update({ where: { id: template.id }, data: { currentRevisionId: revision.id } });

    const page = await prisma.page.create({ data: { organizationId: PUBLIC_ORG_ID, slug: "templated-page", title: "Templated Page", status: "DRAFT", templateId: template.id } });
    const pageRevision = await prisma.contentRevision.create({ data: { pageId: page.id, version: 1, status: "PUBLISHED", title: "Templated Page", body: "<p>x</p>", metadata: {} } });
    await prisma.page.update({ where: { id: page.id }, data: { status: "PUBLISHED", currentRevisionId: pageRevision.id, publishedAt: new Date() } });

    // Template still DRAFT — must not be surfaced as usable.
    const draftTemplateRes = await request(app).get("/api/v1/public/pages/templated-page");
    expect(draftTemplateRes.body.data.page.template).toBeNull();

    // Publish the template's revision but not the template row itself.
    await prisma.templateRevision.update({ where: { id: revision.id }, data: { status: "PUBLISHED", publishedAt: new Date() } });
    const halfPublishedRes = await request(app).get("/api/v1/public/pages/templated-page");
    expect(halfPublishedRes.body.data.page.template).toBeNull();

    // Publish the template row too — now it's genuinely usable.
    await prisma.template.update({ where: { id: template.id }, data: { status: "PUBLISHED" } });
    const fullyPublishedRes = await request(app).get("/api/v1/public/pages/templated-page");
    expect(fullyPublishedRes.body.data.page.template).toEqual({ type: "STANDARD_PAGE", slug: "public-template", structure: { regions: ["a"] }, regions: {} });
  });

  // Phase 4 — the public API resolves each region's assigned Template Part
  // to its own content, applying the same PUBLISHED-status safety check
  // recursively so a region pointing at a draft/archived/foreign-org part
  // never leaks unpublished content or a broken reference.
  it("resolves a region's Template Part content only when that part is itself genuinely PUBLISHED", async () => {
    const part = await prisma.templatePart.create({ data: { organizationId: PUBLIC_ORG_ID, type: "HEADER", slug: "public-header", name: "Public Header", status: "DRAFT" } });
    const partRevision = await prisma.templatePartRevision.create({
      data: { templatePartId: part.id, version: 1, status: "DRAFT", name: "Public Header", content: { version: 1, blocks: [{ id: "b1", type: "heading", props: { text: "Hi" } }] } },
    });
    await prisma.templatePart.update({ where: { id: part.id }, data: { currentRevisionId: partRevision.id } });

    const template = await prisma.template.create({ data: { organizationId: PUBLIC_ORG_ID, type: "STANDARD_PAGE", slug: "region-template", name: "Region Template", status: "PUBLISHED" } });
    const revision = await prisma.templateRevision.create({
      data: { templateId: template.id, version: 1, status: "PUBLISHED", name: "Region Template", structure: { regions: [{ key: "header", templatePartId: part.id }] }, publishedAt: new Date() },
    });
    await prisma.template.update({ where: { id: template.id }, data: { currentRevisionId: revision.id } });

    const page = await prisma.page.create({ data: { organizationId: PUBLIC_ORG_ID, slug: "region-page", title: "Region Page", status: "DRAFT", templateId: template.id } });
    const pageRevision = await prisma.contentRevision.create({ data: { pageId: page.id, version: 1, status: "PUBLISHED", title: "Region Page", body: "<p>x</p>", metadata: {} } });
    await prisma.page.update({ where: { id: page.id }, data: { status: "PUBLISHED", currentRevisionId: pageRevision.id, publishedAt: new Date() } });

    // Part still DRAFT — region must resolve to null, never leak draft content.
    const draftPartRes = await request(app).get("/api/v1/public/pages/region-page");
    expect(draftPartRes.body.data.page.template.regions.header).toBeNull();

    // Publish the part's revision but not the part row itself.
    await prisma.templatePartRevision.update({ where: { id: partRevision.id }, data: { status: "PUBLISHED", publishedAt: new Date() } });
    const halfPublishedRes = await request(app).get("/api/v1/public/pages/region-page");
    expect(halfPublishedRes.body.data.page.template.regions.header).toBeNull();

    // Publish the part row too — now it resolves to real content.
    await prisma.templatePart.update({ where: { id: part.id }, data: { status: "PUBLISHED" } });
    const fullyPublishedRes = await request(app).get("/api/v1/public/pages/region-page");
    expect(fullyPublishedRes.body.data.page.template.regions.header).toEqual({
      type: "HEADER",
      slug: "public-header",
      content: { version: 1, blocks: [{ id: "b1", type: "heading", props: { text: "Hi" } }] },
    });

    // Template region resolution is completely unaffected by SEO default
    // fallback — this page has no metaTitle/metaDescription of its own, so
    // it still gets the organization's Site Identity defaults, same as
    // any other bare content.
    expect(fullyPublishedRes.body.data.page.title).toBe("Region Page");
    expect(fullyPublishedRes.body.data.page.seo.metaTitle).toBeTruthy();
  });

  it("rejects a DRAFT page with a clean 404 — never leaks unpublished content", async () => {
    const res = await request(app).get(`/api/v1/public/pages/${draftPageSlug}`);
    expect(res.status).toBe(404);
  });

  // Phase 5 (Navigation + Pages + Homepage) — the homepage resolves
  // dynamically, with the exact same safe-fallback contract as `template`
  // above: never an error, `page: null` whenever nothing qualifies yet.
  it("GET /public/homepage returns null until a PUBLISHED page is designated the homepage", async () => {
    const none = await request(app).get("/api/v1/public/homepage");
    expect(none.status).toBe(200);
    expect(none.body.data.page).toBeNull();

    const draftHome = await prisma.page.create({ data: { organizationId: PUBLIC_ORG_ID, slug: "draft-home", title: "Draft Home", status: "DRAFT", isHomepage: true } });
    const stillNone = await request(app).get("/api/v1/public/homepage");
    expect(stillNone.body.data.page).toBeNull();

    const revision = await prisma.contentRevision.create({ data: { pageId: draftHome.id, version: 1, status: "PUBLISHED", title: "Draft Home", body: "<p>home</p>", metadata: {} } });
    await prisma.page.update({ where: { id: draftHome.id }, data: { status: "PUBLISHED", currentRevisionId: revision.id, publishedAt: new Date() } });

    const nowPublished = await request(app).get("/api/v1/public/homepage");
    expect(nowPublished.status).toBe(200);
    expect(nowPublished.body.data.page.slug).toBe("draft-home");
    expect(nowPublished.body.data.page.isHomepage).toBe(true);
  });

  // Phase 5 — navigation menu resolution: each item's link target is
  // resolved to a real URL, and an item whose target doesn't resolve is
  // silently dropped (never a broken link, never a thrown error).
  it("GET /public/navigation-menus/:type resolves item link targets and drops broken ones", async () => {
    const linkedPage = await prisma.page.create({ data: { organizationId: PUBLIC_ORG_ID, slug: "nav-target-page", title: "Nav Target", status: "DRAFT" } });
    const linkedRevision = await prisma.contentRevision.create({
      data: { pageId: linkedPage.id, version: 1, status: "PUBLISHED", title: "Nav Target", body: "<p>x</p>", metadata: {} },
    });
    await prisma.page.update({ where: { id: linkedPage.id }, data: { status: "PUBLISHED", currentRevisionId: linkedRevision.id, publishedAt: new Date() } });

    const menu = await prisma.navigationMenu.create({ data: { organizationId: PUBLIC_ORG_ID, type: "PRIMARY", slug: "public-primary-menu", name: "Public Primary Menu", status: "PUBLISHED" } });
    const menuRevision = await prisma.navigationMenuRevision.create({
      data: {
        navigationMenuId: menu.id,
        version: 1,
        status: "PUBLISHED",
        name: "Public Primary Menu",
        publishedAt: new Date(),
        items: [
          { id: "i1", label: "Nav Target", linkType: "page", targetId: linkedPage.id, openInNewTab: false, children: [] },
          { id: "i2", label: "Broken", linkType: "page", targetId: "00000000-0000-0000-0000-000000000000", openInNewTab: false, children: [] },
          { id: "i3", label: "External", linkType: "custom", url: "https://example.com", openInNewTab: true, children: [] },
        ],
      },
    });
    await prisma.navigationMenu.update({ where: { id: menu.id }, data: { currentRevisionId: menuRevision.id } });

    const res = await request(app).get("/api/v1/public/navigation-menus/PRIMARY");
    expect(res.status).toBe(200);
    expect(res.body.data.menu.type).toBe("PRIMARY");
    expect(res.body.data.menu.items).toHaveLength(2);
    expect(res.body.data.menu.items.find((i: { label: string }) => i.label === "Broken")).toBeUndefined();
    expect(res.body.data.menu.items.find((i: { label: string }) => i.label === "Nav Target").url).toBe("/nav-target-page");
    expect(res.body.data.menu.items.find((i: { label: string }) => i.label === "External")).toEqual({
      label: "External",
      url: "https://example.com",
      openInNewTab: true,
      children: [],
    });

    const noneForUnusedLocation = await request(app).get("/api/v1/public/navigation-menus/FOOTER");
    expect(noneForUnusedLocation.body.data.menu).toBeNull();

    const badType = await request(app).get("/api/v1/public/navigation-menus/NOT_A_TYPE");
    expect(badType.status).toBe(400);
  });

  it("never leaks a page belonging to a different organization even with a matching-looking slug", async () => {
    const res = await request(app).get(`/api/v1/public/pages/${otherOrgPageSlug}`);
    expect(res.status).toBe(404);
  });

  it("returns a 404 for a nonexistent page slug (no stack trace, no raw error)", async () => {
    const res = await request(app).get("/api/v1/public/pages/does-not-exist");
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.message).not.toMatch(/prisma|stack|at Object/i);
  });

  it("lists only PUBLISHED posts, with category/tags/author projection", async () => {
    const res = await request(app).get("/api/v1/public/posts");
    expect(res.status).toBe(200);
    const slugs = res.body.data.posts.map((p: { slug: string }) => p.slug);
    expect(slugs).toContain(publishedPostSlug);
    expect(slugs).not.toContain(draftPostSlug);
    expect(slugs).not.toContain(scheduledPostSlug);
    expect(slugs).not.toContain(archivedPostSlug);

    const found = res.body.data.posts.find((p: { slug: string }) => p.slug === publishedPostSlug);
    expect(found.category.slug).toBe(categorySlug);
    expect(found.tags[0].slug).toBe("ai");
  });

  it("filters posts by category slug", async () => {
    const res = await request(app).get("/api/v1/public/posts").query({ category: categorySlug });
    expect(res.status).toBe(200);
    expect(res.body.data.posts.every((p: { category: { slug: string } | null }) => p.category?.slug === categorySlug)).toBe(true);
  });

  it("returns a published post by slug and rejects DRAFT/SCHEDULED/ARCHIVED by slug with 404", async () => {
    const ok = await request(app).get(`/api/v1/public/posts/${publishedPostSlug}`);
    expect(ok.status).toBe(200);
    expect(ok.body.data.post.title).toBe("Hello World");
    expect(ok.body.data.post).not.toHaveProperty("organizationId");

    for (const slug of [draftPostSlug, scheduledPostSlug, archivedPostSlug]) {
      const res = await request(app).get(`/api/v1/public/posts/${slug}`);
      expect(res.status).toBe(404);
    }
  });

  it("lists categories and tags", async () => {
    const categories = await request(app).get("/api/v1/public/categories");
    expect(categories.status).toBe(200);
    expect(categories.body.data.categories.some((c: { slug: string }) => c.slug === categorySlug)).toBe(true);

    const tags = await request(app).get("/api/v1/public/tags");
    expect(tags.status).toBe(200);
    expect(tags.body.data.tags.some((t: { slug: string }) => t.slug === "ai")).toBe(true);
  });

  it("lists only ACTIVE products, excluding DRAFT/ARCHIVED", async () => {
    const res = await request(app).get("/api/v1/public/products");
    expect(res.status).toBe(200);
    const slugs = res.body.data.products.map((p: { slug: string }) => p.slug);
    expect(slugs).toContain(activeProductSlug);
    expect(slugs).not.toContain(draftProductSlug);
    expect(slugs).not.toContain(archivedProductSlug);
  });

  it("returns an ACTIVE product by slug and rejects DRAFT/ARCHIVED by slug with 404", async () => {
    const ok = await request(app).get(`/api/v1/public/products/${activeProductSlug}`);
    expect(ok.status).toBe(200);
    expect(ok.body.data.product.name).toBe("Public Active Product");

    for (const slug of [draftProductSlug, archivedProductSlug]) {
      const res = await request(app).get(`/api/v1/public/products/${slug}`);
      expect(res.status).toBe(404);
    }
  });

  it("returns only ACTIVE modules for a product, excluding DRAFT modules", async () => {
    const res = await request(app).get(`/api/v1/public/products/${activeProductSlug}/modules`);
    expect(res.status).toBe(200);
    const slugs = res.body.data.modules.map((m: { slug: string }) => m.slug);
    expect(slugs).toContain("core-module");
    expect(slugs).not.toContain("hidden-draft-module");
  });

  // Each lead-intake test below sets a distinct simulated client IP
  // (X-Forwarded-For, honored via `trust proxy` — server/middleware/security.ts)
  // so they don't share a rate-limit bucket with each other or with the
  // dedicated rate-limiting test, which deliberately exhausts its own.
  it("creates a real CRM lead from a valid public submission, under the configured organization only", async () => {
    const res = await request(app)
      .post("/api/v1/public/leads")
      .set("X-Forwarded-For", "203.0.113.10")
      .send({
        name: "Jane Prospect",
        company: "Prospect Co",
        email: "jane@prospect-co.example",
        message: "We'd like a quote for an AI automation project.",
        source: "contact_form",
        consent: true,
      });
    expect(res.status).toBe(201);

    const lead = await prisma.lead.findFirst({ where: { email: "jane@prospect-co.example" } });
    expect(lead).not.toBeNull();
    expect(lead!.organizationId).toBe(PUBLIC_ORG_ID);
    expect(lead!.companyName).toBe("Prospect Co");
    expect(lead!.status).toBe("NEW");
    expect(lead!.assignedTo).toBeNull();
  });

  it("rejects an invalid lead submission (missing required fields, bad email, missing consent)", async () => {
    const missingFields = await request(app).post("/api/v1/public/leads").set("X-Forwarded-For", "203.0.113.11").send({ name: "X" });
    expect(missingFields.status).toBe(400);

    const badEmail = await request(app)
      .post("/api/v1/public/leads")
      .set("X-Forwarded-For", "203.0.113.11")
      .send({ name: "X", email: "not-an-email", message: "hello there", consent: true });
    expect(badEmail.status).toBe(400);

    const noConsent = await request(app)
      .post("/api/v1/public/leads")
      .set("X-Forwarded-For", "203.0.113.11")
      .send({ name: "X", email: "x@example.com", message: "hello there", consent: false });
    expect(noConsent.status).toBe(400);
  });

  it("rejects a malicious/oversized payload cleanly", async () => {
    const res = await request(app)
      .post("/api/v1/public/leads")
      .set("X-Forwarded-For", "203.0.113.12")
      .send({ name: "X", email: "x@example.com", message: "a".repeat(10000), consent: true });
    expect(res.status).toBe(400);
  });

  it("discards a honeypot-triggered submission without creating a lead, but returns the same success response", async () => {
    const res = await request(app)
      .post("/api/v1/public/leads")
      .set("X-Forwarded-For", "203.0.113.13")
      .send({
        name: "Bot",
        email: "bot@example.com",
        message: "I am a bot filling every field",
        consent: true,
        website: "http://spam.example",
      });
    expect(res.status).toBe(201);

    const lead = await prisma.lead.findFirst({ where: { email: "bot@example.com" } });
    expect(lead).toBeNull();
  });

  it("rate-limits public lead submissions per IP", async () => {
    const attempts = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        request(app)
          .post("/api/v1/public/leads")
          .set("X-Forwarded-For", "203.0.113.99")
          .send({ name: "Rate Test", email: `rate-${i}@example.com`, message: "hello there rate limit test", consent: true })
      )
    );
    expect(attempts.some((r) => r.status === 429)).toBe(true);
  });

  it("never exposes storage credentials, internal ids, or organization data through any public response", async () => {
    const responses = await Promise.all([
      request(app).get(`/api/v1/public/pages/${publishedPageSlug}`),
      request(app).get(`/api/v1/public/posts/${publishedPostSlug}`),
      request(app).get(`/api/v1/public/products/${activeProductSlug}`),
    ]);
    for (const res of responses) {
      const body = JSON.stringify(res.body);
      expect(body).not.toMatch(/storageKey|storageBucket|storageProvider|passwordHash|sessionToken/i);
    }
  });

  // Phase 11 (Case Studies + Content Relationships)
  describe("case studies", () => {
    it("GET /public/case-studies lists only PUBLISHED case studies, with real content relationships", async () => {
      const res = await request(app).get("/api/v1/public/case-studies");
      expect(res.status).toBe(200);
      const slugs = res.body.data.caseStudies.map((c: { slug: string }) => c.slug);
      expect(slugs).toContain(publishedCaseStudySlug);
      expect(slugs).not.toContain(draftCaseStudySlug);
    });

    it("GET /public/case-studies/:slug returns the full projection — industry, structured content, related product/page/post", async () => {
      const res = await request(app).get(`/api/v1/public/case-studies/${publishedCaseStudySlug}`);
      expect(res.status).toBe(200);
      const caseStudy = res.body.data.caseStudy;
      expect(caseStudy.title).toBe("Acme Zero-Touch Close");
      expect(caseStudy.clientName).toBe("Acme Corp");
      expect(caseStudy.industry.slug).toBe(caseStudyIndustrySlug);
      expect(caseStudy.challenge).toBe("Manual close took 10 days.");
      expect(caseStudy.technologies).toEqual(["React"]);
      expect(caseStudy.relatedProducts).toHaveLength(1);
      expect(caseStudy.relatedProducts[0].slug).toBe(caseStudyProductSlug);
      expect(caseStudy.relatedPages).toHaveLength(1);
      expect(caseStudy.relatedPages[0].slug).toBe(publishedPageSlug);
      expect(caseStudy.relatedPosts).toHaveLength(1);
      expect(caseStudy.relatedPosts[0].slug).toBe(publishedPostSlug);
    });

    it("GET /public/case-studies/:slug 404s for a DRAFT case study", async () => {
      const res = await request(app).get(`/api/v1/public/case-studies/${draftCaseStudySlug}`);
      expect(res.status).toBe(404);
    });

    it("filters the public case-study list by industrySlug/productSlug", async () => {
      const byIndustry = await request(app).get("/api/v1/public/case-studies").query({ industrySlug: caseStudyIndustrySlug });
      expect(byIndustry.body.data.caseStudies.map((c: { slug: string }) => c.slug)).toContain(publishedCaseStudySlug);

      const byProduct = await request(app).get("/api/v1/public/case-studies").query({ productSlug: caseStudyProductSlug });
      expect(byProduct.body.data.caseStudies.map((c: { slug: string }) => c.slug)).toContain(publishedCaseStudySlug);

      const byUnknownIndustry = await request(app).get("/api/v1/public/case-studies").query({ industrySlug: "nonexistent-industry" });
      expect(byUnknownIndustry.body.data.caseStudies).toHaveLength(0);
    });

    it("never exposes internal ids or organization data through the public case study response", async () => {
      const res = await request(app).get(`/api/v1/public/case-studies/${publishedCaseStudySlug}`);
      const body = JSON.stringify(res.body);
      expect(body).not.toMatch(/storageKey|storageBucket|storageProvider|passwordHash|sessionToken|organizationId/i);
    });
  });
});
