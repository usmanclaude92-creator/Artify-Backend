/** Marketing → Landing Pages (Step 12). Real DB, real services. Data tagged QA_TEST_2026_. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp, finalizeApp } from "../../server/app/app";
import { disconnectPrisma, prisma } from "../../server/db/prisma";
import { config } from "../../server/config/env";
import { resetDb } from "../helpers/db";

const PUBLIC_ORG_ID = config.publicWebsiteOrganizationId;

describe("Landing pages", () => {
  const app = createApp();
  finalizeApp(app);
  let adminToken = "", managerToken = "", viewerToken = "", portalToken = "", otherAdminToken = "";
  let ip = 10;
  const api = (method: "get" | "post" | "patch", path: string, token: string, body?: object) => {
    const r = request(app)[method](`/api/v1${path}`).set("Authorization", `Bearer ${token}`).set("X-Forwarded-For", `10.9.0.${ip++}`);
    return method === "get" ? r : r.send(body ?? {});
  };
  const pub = (method: "get" | "post", path: string, body?: object, xff = `10.9.1.${ip++}`) => {
    const r = request(app)[method](`/api/v1/public${path}`).set("X-Forwarded-For", xff);
    return method === "get" ? r : r.send(body ?? {});
  };
  const makeUser = async (email: string, roleKey: string) => {
    const cu = await api("post", "/users", adminToken, { email, password: "Str0ng-Passphrase-77", firstName: "QA", lastName: roleKey, roleKey }); if (cu.status >= 300) throw new Error(JSON.stringify(cu.body));
    return (await request(app).post("/api/v1/auth/login").set("X-Forwarded-For", `10.9.0.${ip++}`).send({ email, password: "Str0ng-Passphrase-77" })).body.data.session.token as string;
  };

  const validDoc = (over: { consent?: boolean } = {}) => ({
    version: 1,
    blocks: [
      { id: "hero", type: "lp_hero", props: { headline: "QA_TEST_2026_ Plan your project", subheadline: "A <b>plain</b> subheadline", primaryCta: { label: "Talk to us", href: "#contact" } } },
      { id: "ben", type: "lp_benefits", props: { heading: "Why us", items: [{ title: "Clear scope", text: "We write it down first." }, { title: "Fixed steps", text: "You approve each step." }] } },
      { id: "form", type: "lp_form", props: {
        heading: "Contact", fields: [{ key: "name", label: "Name", type: "text", required: true }, { key: "email", label: "Email", type: "email", required: true }, { key: "message", label: "Message", type: "textarea", required: false }],
        consent: over.consent === false ? { enabled: false, text: "", privacyUrl: "" } : { enabled: true, text: "I agree that Artify may contact me about my request.", privacyUrl: "/privacy" },
        submitLabel: "Send", successMessage: "Thank you, we will reply soon.",
      } },
    ],
  });

  async function newPage(title: string, slug?: string) {
    const r = await api("post", "/marketing/landing-pages", managerToken, { title, templateKey: "lead-gen", ...(slug ? { slug } : {}) });
    expect(r.status).toBe(201);
    return r.body.data.page as { id: string; slug: string };
  }
  async function readyPage(title: string, slug: string, doc = validDoc()) {
    const p = await newPage(title, slug);
    const u = await api("patch", `/marketing/landing-pages/${p.id}`, managerToken, { document: doc, seo: { metaDescription: "QA_TEST_2026_ description" } });
    expect(u.status).toBe(200);
    return p;
  }
  async function publish(id: string) {
    const s = await api("post", `/marketing/landing-pages/${id}/submit-for-approval`, managerToken);
    expect(s.status).toBe(201);
    const list = await api("get", "/approvals?source=landing", adminToken);
    const item = list.body.data.approvals.find((a: { link: string }) => a.link.endsWith(id));
    expect(item).toBeTruthy();
    const d = await api("post", `/approvals/landing/${item.id}/decision`, adminToken, { decision: "approve" });
    return d;
  }

  beforeAll(async () => {
    await resetDb();
    expect(PUBLIC_ORG_ID).toBeTruthy();
    await prisma.organization.create({ data: { id: PUBLIC_ORG_ID, name: "QA_TEST_2026_ Public", slug: "qa-landing-public" } });
    const reg = await request(app).post("/api/v1/auth/register").set("X-Forwarded-For", "10.9.0.1").send({ email: "qa-admin@example.com", password: "Str0ng-Passphrase-77", firstName: "QA", lastName: "Admin", organizationName: "QA_TEST_2026_ Org" });
    adminToken = reg.body.data.session.token;
    // Make the admin's organization the configured public-website organization (production setup: one workspace).
    await prisma.user.update({ where: { id: reg.body.data.user.id }, data: { organizationId: PUBLIC_ORG_ID } });
    await prisma.session.updateMany({ where: { userId: reg.body.data.user.id }, data: { organizationId: PUBLIC_ORG_ID } });
    await prisma.organizationMembership.updateMany({ where: { userId: reg.body.data.user.id }, data: { organizationId: PUBLIC_ORG_ID } });
    managerToken = await makeUser("qa-manager@example.com", "MANAGER");
    viewerToken = await makeUser("qa-viewer@example.com", "VIEWER");
    portalToken = (await request(app).post("/api/v1/auth/portal/register").set("X-Forwarded-For", "10.9.0.2").send({ email: "qa-portal@example.com", password: "Str0ng-Passphrase-77", firstName: "QA", lastName: "Portal", organizationName: "QA_TEST_2026_ Portal" })).body.data.session.token;
    otherAdminToken = (await request(app).post("/api/v1/auth/register").set("X-Forwarded-For", "10.9.0.3").send({ email: "qa-other@example.com", password: "Str0ng-Passphrase-77", firstName: "QA", lastName: "Other", organizationName: "QA_TEST_2026_ Other" })).body.data.session.token;
  });
  afterAll(async () => { await disconnectPrisma(); });

  describe("permissions", () => {
    it("maps roles exactly: read (all CMS readers), edit (MANAGER+), publish (ADMIN only)", async () => {
      const keys = ["marketing.landing.read", "marketing.landing.edit", "marketing.landing.publish"];
      const rows = await prisma.rolePermission.findMany({ where: { permission: { key: { in: keys } } }, include: { role: true, permission: true } });
      const map: Record<string, string[]> = {};
      for (const r of rows) (map[r.role.key] ??= []).push(r.permission.key);
      for (const k of Object.keys(map)) map[k]!.sort();
      expect(map.ADMIN).toEqual([...keys].sort());
      expect(map.MANAGER).toEqual(["marketing.landing.edit", "marketing.landing.read"]);
      expect(map.USER).toEqual(["marketing.landing.read"]);
      expect(map.VIEWER).toEqual(["marketing.landing.read"]);
      expect(map.CLIENT_PORTAL).toBeUndefined();
    });
    it("enforces them on the API", async () => {
      expect((await api("get", "/marketing/landing-pages", viewerToken)).status).toBe(200);
      expect((await api("post", "/marketing/landing-pages", viewerToken, { title: "x page", templateKey: "lead-gen" })).status).toBe(403);
      expect((await api("get", "/marketing/landing-pages", portalToken)).status).toBe(403);
      expect((await request(app).get("/api/v1/marketing/landing-pages")).status).toBe(401);
    });
  });

  describe("builder", () => {
    it("creates from a template as DRAFT with placeholders that block approval", async () => {
      const p = await newPage("QA_TEST_2026_ Template page");
      const g = await api("get", `/marketing/landing-pages/${p.id}`, viewerToken);
      expect(g.body.data.page.status).toBe("DRAFT");
      expect(g.body.data.page.canPublishNow).toBe(false);
      expect(g.body.data.page.publishIssues.length).toBeGreaterThan(0);
      const s = await api("post", `/marketing/landing-pages/${p.id}/submit-for-approval`, managerToken);
      expect(s.status).toBe(400);
    });
    it("rejects unsafe or malformed content on save", async () => {
      const p = await newPage("QA_TEST_2026_ Bad content");
      const bad = validDoc();
      (bad.blocks[0] as { props: { primaryCta: { href: string } } }).props.primaryCta.href = "javascript:alert(1)";
      expect((await api("patch", `/marketing/landing-pages/${p.id}`, managerToken, { document: bad })).status).toBe(400);
      expect((await api("patch", `/marketing/landing-pages/${p.id}`, managerToken, { document: { version: 1, blocks: [{ id: "x", type: "html", props: { html: "<script>1</script>" } }] } })).status).toBe(400);
    });
    it("rejects an image that is not in the Media library", async () => {
      const p = await newPage("QA_TEST_2026_ Media page");
      const doc = validDoc();
      (doc.blocks[0] as { props: Record<string, unknown> }).props.image = { mediaId: "6f1c2b1e-6f0b-4b5a-9a63-0d4b0f6a9a11", alt: "Something" };
      expect((await api("patch", `/marketing/landing-pages/${p.id}`, managerToken, { document: doc })).status).toBe(400);
    });
    it("slug rules: reserved blocked, duplicates blocked, auto slug is unique", async () => {
      expect((await api("post", "/marketing/landing-pages", managerToken, { title: "QA_TEST_2026_ x", slug: "admin", templateKey: "lead-gen" })).status).toBe(400);
      await newPage("QA_TEST_2026_ Dup", "qa-dup-slug");
      expect((await api("post", "/marketing/landing-pages", managerToken, { title: "QA_TEST_2026_ y", slug: "qa-dup-slug", templateKey: "lead-gen" })).status).toBe(409);
      const a = await newPage("QA_TEST_2026_ Auto Title");
      const b = await newPage("QA_TEST_2026_ Auto Title");
      expect(a.slug).not.toBe(b.slug);
    });
    it("is invisible to the generic CMS and to other workspaces", async () => {
      const p = await newPage("QA_TEST_2026_ Isolated", "qa-isolated");
      const generic = await api("get", "/pages", adminToken);
      expect(JSON.stringify(generic.body)).not.toContain("qa-isolated");
      expect((await api("get", `/pages/${p.id}`, adminToken)).status).toBe(404);
      expect((await api("post", `/pages/${p.id}/publish`, adminToken)).status).toBe(404);
      expect((await api("get", `/marketing/landing-pages/${p.id}`, otherAdminToken)).status).toBe(404);
    });
  });

  describe("publish through approvals, public rendering, unpublish", () => {
    let page: { id: string; slug: string };
    it("only an approver can publish; managers cannot", async () => {
      page = await readyPage("QA_TEST_2026_ Live page", "qa-live-page");
      expect((await pub("get", "/landing/qa-live-page")).status).toBe(404); // draft is not public (404, never published)
      const s = await api("post", `/marketing/landing-pages/${page.id}/submit-for-approval`, managerToken);
      expect(s.status).toBe(201);
      const pending = await api("get", `/marketing/landing-pages/${page.id}`, managerToken);
      expect(pending.body.data.page.status).toBe("IN_REVIEW");
      // the pending page is locked for editing
      expect((await api("patch", `/marketing/landing-pages/${page.id}`, managerToken, { title: "QA_TEST_2026_ changed" })).status).toBe(409);
      const list = await api("get", "/approvals?source=landing", adminToken);
      const item = list.body.data.approvals.find((a: { link: string }) => a.link.endsWith(page.id));
      expect(item.source).toBe("landing");
      // not visible in the other sources
      const auto = await api("get", "/approvals?source=automation", adminToken);
      expect(JSON.stringify(auto.body)).not.toContain(page.id);
      // the generic automation decision path refuses landing approvals
      const viaAutomation = await api("post", `/automation/approvals/${item.id}/decision`, adminToken, { decision: "APPROVED" });
      expect([400, 404]).toContain(viaAutomation.status);
      expect((await api("post", `/approvals/landing/${item.id}/decision`, managerToken, { decision: "approve" })).status).toBe(403);
      expect((await pub("get", "/landing/qa-live-page")).status).toBe(404);
      const ok = await api("post", `/approvals/landing/${item.id}/decision`, adminToken, { decision: "approve" });
      expect(ok.status).toBe(200);
    });
    it("serves the live page with an explicit projection and nothing internal", async () => {
      const r = await pub("get", "/landing/qa-live-page");
      expect(r.status).toBe(200);
      const body = r.body.data.page;
      expect(Object.keys(body).sort()).toEqual(["blocks", "media", "preview", "seo", "slug", "title", "updatedAt"]);
      expect(body.preview).toBe(false);
      expect(body.blocks.map((b: { type: string }) => b.type)).toEqual(["lp_hero", "lp_benefits", "lp_form"]);
      const raw = JSON.stringify(r.body);
      for (const forbidden of ["organizationId", "createdById", "landingLiveRevisionId", "approval", "tokenHash", "@example.com"]) expect(raw).not.toContain(forbidden);
      expect(r.headers["cache-control"]).toContain("s-maxage");
    });
    it("sitemap list includes it; noindex pages are excluded; the generic page endpoints do not serve it", async () => {
      expect((await pub("get", "/landing")).body.data.pages.map((p: { slug: string }) => p.slug)).toContain("qa-live-page");
      expect((await pub("get", "/pages/qa-live-page")).status).toBe(404);
      const idx = await readyPage("QA_TEST_2026_ Noindex", "qa-noindex");
      await api("patch", `/marketing/landing-pages/${idx.id}`, managerToken, { seo: { noindex: true } });
      await publish(idx.id);
      expect((await pub("get", "/landing/qa-noindex")).body.data.page.seo.noindex).toBe(true);
      expect((await pub("get", "/landing")).body.data.pages.map((p: { slug: string }) => p.slug)).not.toContain("qa-noindex");
    });
    it("editing a live page does not change the live version until approved again", async () => {
      const u = await api("patch", `/marketing/landing-pages/${page.id}`, managerToken, { title: "QA_TEST_2026_ Live page v2" });
      expect(u.status).toBe(200);
      expect(u.body.data.page.hasUnpublishedChanges).toBe(true);
      expect(u.body.data.page.status).toBe("PUBLISHED");
      expect((await pub("get", "/landing/qa-live-page")).body.data.page.title).toBe("QA_TEST_2026_ Live page");
      await publish(page.id);
      expect((await pub("get", "/landing/qa-live-page")).body.data.page.title).toBe("QA_TEST_2026_ Live page v2");
    });
    it("version history lists revisions and restore creates a new draft (not live)", async () => {
      const revs = (await api("get", `/marketing/landing-pages/${page.id}/revisions`, viewerToken)).body.data.revisions as Array<{ id: string; version: number; isLive: boolean }>;
      expect(revs.length).toBeGreaterThanOrEqual(2);
      const first = revs[revs.length - 1]!;
      const restored = await api("post", `/marketing/landing-pages/${page.id}/restore`, managerToken, { revisionId: first.id });
      expect(restored.status).toBe(200);
      expect(restored.body.data.page.title).toBe("QA_TEST_2026_ Live page");
      expect((await pub("get", "/landing/qa-live-page")).body.data.page.title).toBe("QA_TEST_2026_ Live page v2"); // still the approved one
      const after = (await api("get", `/marketing/landing-pages/${page.id}/revisions`, viewerToken)).body.data.revisions as Array<unknown>;
      expect(after.length).toBe(revs.length + 1);
    });
    it("changing the slug of a live page needs publish rights and leaves a redirect", async () => {
      expect((await api("patch", `/marketing/landing-pages/${page.id}`, managerToken, { slug: "qa-live-renamed" })).status).toBe(403);
      expect((await api("patch", `/marketing/landing-pages/${page.id}`, adminToken, { slug: "qa-live-renamed" })).status).toBe(200);
      const old = await pub("get", "/landing/qa-live-page");
      expect(old.status).toBe(200);
      expect(old.body.data.redirect.toPath).toBe("/lp/qa-live-renamed");
      expect((await pub("get", "/landing/qa-live-renamed")).status).toBe(200);
    });
    it("unpublish needs publish rights, returns 410 and removes the page from the sitemap list", async () => {
      expect((await api("post", `/marketing/landing-pages/${page.id}/unpublish`, managerToken)).status).toBe(403);
      const un = await api("post", `/marketing/landing-pages/${page.id}/unpublish`, adminToken);
      expect(un.status).toBe(200);
      expect(un.body.data.page.status).toBe("UNPUBLISHED");
      expect((await pub("get", "/landing/qa-live-renamed")).status).toBe(410);
      expect((await pub("get", "/landing")).body.data.pages.map((p: { slug: string }) => p.slug)).not.toContain("qa-live-renamed");
      expect((await pub("post", "/landing/qa-live-renamed/submit", { data: { name: "A", email: "a@example.com" } })).status).toBe(404);
      expect((await pub("get", "/landing/never-existed-page")).status).toBe(404);
    });
    it("archiving a live page takes it offline (410)", async () => {
      const p = await readyPage("QA_TEST_2026_ Archive me", "qa-archive-me");
      await publish(p.id);
      expect((await pub("get", "/landing/qa-archive-me")).status).toBe(200);
      expect((await api("post", `/marketing/landing-pages/${p.id}/archive`, managerToken)).status).toBe(403); // live: needs publish permission
      expect((await api("post", `/marketing/landing-pages/${p.id}/archive`, adminToken)).status).toBe(200);
      expect((await pub("get", "/landing/qa-archive-me")).status).toBe(410);
    });
    it("rejecting returns the page to draft; withdrawing unlocks editing", async () => {
      const p = await readyPage("QA_TEST_2026_ Reject me", "qa-reject-me");
      await api("post", `/marketing/landing-pages/${p.id}/submit-for-approval`, managerToken);
      const item = (await api("get", "/approvals?source=landing", adminToken)).body.data.approvals.find((a: { link: string }) => a.link.endsWith(p.id));
      expect((await api("post", `/approvals/landing/${item.id}/decision`, adminToken, { decision: "reject", comment: "Needs work" })).status).toBe(200);
      expect((await api("get", `/marketing/landing-pages/${p.id}`, managerToken)).body.data.page.status).toBe("DRAFT");
      await api("post", `/marketing/landing-pages/${p.id}/submit-for-approval`, managerToken);
      expect((await api("post", `/marketing/landing-pages/${p.id}/withdraw`, managerToken)).status).toBe(200);
      expect((await api("patch", `/marketing/landing-pages/${p.id}`, managerToken, { title: "QA_TEST_2026_ Reject me again" })).status).toBe(200);
    });
  });

  describe("preview token", () => {
    it("shows the working draft privately, noindex, no-store; revocable; expiring", async () => {
      const p = await readyPage("QA_TEST_2026_ Preview", "qa-preview-page");
      const made = await api("post", `/marketing/landing-pages/${p.id}/preview`, managerToken, { ttlHours: 1 });
      expect(made.status).toBe(201);
      const { token, path } = made.body.data.preview;
      expect(path).toBe(`/lp-preview/${token}`);
      const stored = await prisma.landingPreviewToken.findMany({ where: { pageId: p.id } });
      expect(stored[0]!.tokenHash).not.toBe(token); // only a hash is stored
      expect((await pub("get", "/landing/qa-preview-page")).status).toBe(404); // not live
      const r = await pub("get", `/landing-preview/${token}`);
      expect(r.status).toBe(200);
      expect(r.body.data.page.preview).toBe(true);
      expect(r.body.data.page.seo.noindex).toBe(true);
      expect(r.headers["cache-control"]).toBe("no-store");
      expect(r.headers["x-robots-tag"]).toContain("noindex");
      expect((await pub("get", "/landing-preview/not-a-real-token-value-123456")).status).toBe(404);
      await prisma.landingPreviewToken.updateMany({ where: { pageId: p.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
      expect((await pub("get", `/landing-preview/${token}`)).status).toBe(404);
      const again = (await api("post", `/marketing/landing-pages/${p.id}/preview`, managerToken, {})).body.data.preview.token;
      expect((await api("post", `/marketing/landing-pages/${p.id}/preview/revoke`, managerToken)).body.data.revoked).toBe(1);
      expect((await pub("get", `/landing-preview/${again}`)).status).toBe(404);
      expect((await api("post", `/marketing/landing-pages/${p.id}/preview`, viewerToken, {})).status).toBe(403);
    });
  });

  describe("lead form", () => {
    let slug = "qa-form-page";
    beforeAll(async () => { const p = await readyPage("QA_TEST_2026_ Form page", slug); await publish(p.id); });

    it("validates server-side: required fields, unknown fields, consent", async () => {
      const ok = { name: "QA Lead", email: "qa-lead-1@example.com", consent: "true" };
      expect((await pub("post", `/landing/${slug}/submit`, { data: { name: "QA", consent: "true" } })).status).toBe(400);
      expect((await pub("post", `/landing/${slug}/submit`, { data: { ...ok, evil: "x" } })).status).toBe(400);
      expect((await pub("post", `/landing/${slug}/submit`, { data: { name: "QA", email: "qa-noconsent@example.com" } })).status).toBe(400);
      expect((await pub("post", `/landing/${slug}/submit`, { data: { name: "QA", email: "qa-noconsent@example.com", consent: "false" } })).status).toBe(400);
      expect(await prisma.lead.count({ where: { email: "qa-noconsent@example.com" } })).toBe(0);
    });
    it("creates a CRM lead with source, first touch and last touch, and fires the submission record", async () => {
      const first = { utmSource: "newsletter", utmMedium: "email", utmCampaign: "qa-launch", referrer: "https://mail.example/", landingPath: "/lp/qa-form-page", at: "2026-10-01T10:00:00Z" };
      const last = { utmSource: "linkedin", utmMedium: "social", utmCampaign: "qa-launch", utmContent: "post-1", referrer: "https://www.linkedin.com/", landingPath: "/lp/qa-form-page" };
      const r = await pub("post", `/landing/${slug}/submit`, { data: { name: "QA Lead", email: "qa-lead-2@example.com", message: "Hello", consent: "true" }, firstTouch: first, lastTouch: last });
      expect(r.status).toBe(201);
      expect(r.body.data.message).toBe("Thank you, we will reply soon.");
      const lead = await prisma.lead.findFirst({ where: { email: "qa-lead-2@example.com" } });
      expect(lead).not.toBeNull();
      expect(lead!.source).toBe(`landing:${slug}:linkedin`);
      expect(lead!.utmSource).toBe("linkedin");
      expect(lead!.utmMedium).toBe("social");
      expect(lead!.landingPagePath).toBe(`/lp/${slug}`);
      expect(lead!.consentGiven).toBe(true);
      expect((lead!.firstTouch as { utmSource: string }).utmSource).toBe("newsletter");
      const sub = await prisma.formSubmission.findFirst({ where: { leadId: lead!.id } });
      expect(sub?.utmSource).toBe("linkedin");
      expect((sub?.firstTouch as { utmSource: string }).utmSource).toBe("newsletter");
      // a later visit does not overwrite the first touch
      await pub("post", `/landing/${slug}/submit`, { data: { name: "QA Lead", email: "qa-lead-2@example.com", consent: "true" }, firstTouch: { utmSource: "later" }, lastTouch: { utmSource: "google" } });
      const again = await prisma.lead.findFirst({ where: { email: "qa-lead-2@example.com" } });
      expect((again!.firstTouch as { utmSource: string }).utmSource).toBe("newsletter");
    });
    it("honeypot submissions look successful but create nothing", async () => {
      const r = await pub("post", `/landing/${slug}/submit`, { data: { name: "Bot", email: "qa-bot@example.com", consent: "true" }, website: "http://spam.example" });
      expect(r.status).toBe(201);
      expect(await prisma.lead.count({ where: { email: "qa-bot@example.com" } })).toBe(0);
    });
    it("is rate limited per IP", async () => {
      const results: number[] = [];
      for (let i = 0; i < 8; i++) results.push((await pub("post", `/landing/${slug}/submit`, { data: { name: "R", email: `qa-rate-${i}@example.com`, consent: "true" } }, "203.0.113.77")).status);
      expect(results).toContain(429);
    });
    it("stats show honest zero/null values without analytics, and real counts with them", async () => {
      const p = await prisma.page.findFirstOrThrow({ where: { slug } });
      const empty = (await api("get", `/marketing/landing-pages/${p.id}/stats`, viewerToken)).body.data.stats;
      expect(empty.views).toBe(0);
      expect(empty.uniqueSessions).toBe(0);
      expect(empty.conversionRate).toBeNull();
      expect(empty.submissions).toBeGreaterThanOrEqual(1);
      await prisma.analyticsEvent.createMany({ data: ["s1", "s2", "s3", "s4"].map((sessionId, i) => ({ organizationId: PUBLIC_ORG_ID, eventType: "page_view", path: `/lp/${slug}`, sessionId: i === 3 ? "s1" : sessionId, utmSource: i === 0 ? "linkedin" : null })) });
      const s = (await api("get", `/marketing/landing-pages/${p.id}/stats`, viewerToken)).body.data.stats;
      expect(s.views).toBe(4);
      expect(s.uniqueSessions).toBe(3);
      expect(s.conversionRate).toBe(Math.round((s.submissions / 3) * 1000) / 10);
      expect(s.hasData).toBe(true);
    });
    it("UTM link helper only works for live pages and validates input", async () => {
      const p = await prisma.page.findFirstOrThrow({ where: { slug } });
      const ok = await api("get", `/marketing/landing-pages/${p.id}/utm-link?source=linkedin&medium=social&campaign=qa-launch`, viewerToken);
      expect(ok.status).toBe(200);
      expect(ok.body.data.path).toBe(`/lp/${slug}?utm_source=linkedin&utm_medium=social&utm_campaign=qa-launch`);
      expect((await api("get", `/marketing/landing-pages/${p.id}/utm-link?source=lin%20kedin&medium=social&campaign=x`, viewerToken)).status).toBe(400);
      const draft = await newPage("QA_TEST_2026_ Unlinked", "qa-unlinked");
      expect((await api("get", `/marketing/landing-pages/${draft.id}/utm-link?source=a&medium=b&campaign=c`, viewerToken)).status).toBe(409);
      expect((await api("get", "/marketing/landing-pages/live", viewerToken)).body.data.pages.map((x: { slug: string }) => x.slug)).toContain(slug);
    });
  });
});
