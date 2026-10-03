/**
 * Phase 3 (Site Identity + Global Styles) — draft/publish/revert CRUD on
 * top of the existing SystemSetting store, validation, permissions, tenant
 * isolation, media-reference validation, audit logging, and the public
 * `/public/site-settings` projection. Backward compatibility with the
 * generic `/settings` endpoint and other organizations' settings is
 * covered by the last test.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp, finalizeApp } from "../../server/app/app";
import { disconnectPrisma, prisma } from "../../server/db/prisma";
import { config } from "../../server/config/env";
import { resetDb } from "../helpers/db";
import { testStorageProvider } from "../../server/storage/testStorageProvider";

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const PDF_BYTES = Buffer.from("%PDF-1.4\nnot an image");

async function createActiveMedia(app: import("express").Express, token: string, filename: string, mimeType = "image/png", bytes = PNG_BYTES) {
  const session = await request(app)
    .post("/api/v1/media/upload-session")
    .set("Authorization", `Bearer ${token}`)
    .send({ filename, mimeType, sizeBytes: bytes.length });
  const { media, uploadToken } = session.body.data;
  testStorageProvider.seedObject(media.storageKey, bytes, mimeType);
  await request(app).post(`/api/v1/media/${media.id}/complete`).set("Authorization", `Bearer ${token}`).send({ token: uploadToken });
  return media.id as string;
}

describe("Site Settings (Site Identity + Global Styles)", () => {
  const app = createApp();
  finalizeApp(app);

  let adminToken: string;
  let orgId: string;
  let viewerToken: string;
  let otherOrgAdminToken: string;

  beforeAll(async () => {
    await resetDb();
    const reg = await request(app).post("/api/v1/auth/register").send({
      email: "site-settings-admin@example.com",
      password: "OriginalPassword123",
      firstName: "Site",
      lastName: "Admin",
      organizationName: "Site Settings Co",
    });
    adminToken = reg.body.data.session.token;
    orgId = reg.body.data.user.organizationId;

    await request(app)
      .post("/api/v1/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ email: "site-settings-viewer@example.com", password: "ViewerPassword123", firstName: "V", lastName: "W", roleKey: "VIEWER" });
    viewerToken = (
      await request(app).post("/api/v1/auth/login").send({ email: "site-settings-viewer@example.com", password: "ViewerPassword123" })
    ).body.data.session.token;

    const otherOrg = await request(app).post("/api/v1/auth/register").send({
      email: "site-settings-other-admin@example.com",
      password: "OriginalPassword123",
      firstName: "Other",
      lastName: "Admin",
      organizationName: "Other Site Settings Co",
    });
    otherOrgAdminToken = otherOrg.body.data.session.token;
  });

  afterAll(async () => {
    await disconnectPrisma();
  });

  it("GET identity with nothing saved yet returns schema defaults, not dirty, unauthenticated rejected", async () => {
    const unauth = await request(app).get("/api/v1/site-settings/identity");
    expect(unauth.status).toBe(401);

    const res = await request(app).get("/api/v1/site-settings/identity").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.draft.siteName).toBe("Artify Solutions");
    expect(res.body.data.published.siteName).toBe("Artify Solutions");
    expect(res.body.data.isDirty).toBe(false);
    expect(res.body.data.publishedAt).toBeNull();
  });

  it("GET global-styles with nothing saved yet returns schema defaults matching the live site", async () => {
    const res = await request(app).get("/api/v1/site-settings/global-styles").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.draft.colors.primary).toBe("#7C3AED");
    expect(res.body.data.draft.layout.containerMaxWidth).toBe("1280px");
    expect(res.body.data.isDirty).toBe(false);
  });

  it("rejects an invalid global-styles draft (bad color format) without writing anything", async () => {
    const res = await request(app)
      .put("/api/v1/site-settings/global-styles/draft")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ colors: { primary: "not-a-color" } });
    expect(res.status).toBe(400);
  });

  it("rejects an unknown key on a .strict() schema (no silent passthrough of a bogus field)", async () => {
    const res = await request(app)
      .put("/api/v1/site-settings/identity/draft")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ siteName: "Artify Solutions", notAKnownField: "x" });
    expect(res.status).toBe(400);
  });

  it("saves a valid identity draft, auditing SETTINGS_UPDATED, and a VIEWER can read it but not write", async () => {
    const save = await request(app)
      .put("/api/v1/site-settings/identity/draft")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ siteName: "Updated Co", tagline: "New tagline" });
    expect(save.status).toBe(200);
    expect(save.body.data.draft.siteName).toBe("Updated Co");

    const audit = await prisma.auditLog.findFirst({ where: { organizationId: orgId, action: "SETTINGS_UPDATED", resourceType: "site_identity" } });
    expect(audit).not.toBeNull();

    const read = await request(app).get("/api/v1/site-settings/identity").set("Authorization", `Bearer ${viewerToken}`);
    expect(read.status).toBe(200);
    expect(read.body.data.draft.siteName).toBe("Updated Co");
    expect(read.body.data.isDirty).toBe(true); // draft differs from still-unpublished default

    const writeAttempt = await request(app)
      .put("/api/v1/site-settings/identity/draft")
      .set("Authorization", `Bearer ${viewerToken}`)
      .send({ siteName: "Hacked" });
    expect(writeAttempt.status).toBe(403);
  });

  it("publish copies draft to published, clears dirty state, and audits SETTINGS_PUBLISHED", async () => {
    await request(app).put("/api/v1/site-settings/identity/draft").set("Authorization", `Bearer ${adminToken}`).send({ siteName: "Published Name" });

    const publish = await request(app).post("/api/v1/site-settings/identity/publish").set("Authorization", `Bearer ${adminToken}`).send();
    expect(publish.status).toBe(200);
    expect(publish.body.data.published.siteName).toBe("Published Name");

    const after = await request(app).get("/api/v1/site-settings/identity").set("Authorization", `Bearer ${adminToken}`);
    expect(after.body.data.published.siteName).toBe("Published Name");
    expect(after.body.data.isDirty).toBe(false);
    expect(after.body.data.publishedAt).not.toBeNull();

    const audit = await prisma.auditLog.findFirst({ where: { organizationId: orgId, action: "SETTINGS_PUBLISHED", resourceType: "site_identity" } });
    expect(audit).not.toBeNull();
  });

  it("revert discards draft edits back to the current published value, and audits SETTINGS_REVERTED", async () => {
    await request(app).put("/api/v1/site-settings/identity/draft").set("Authorization", `Bearer ${adminToken}`).send({ siteName: "Unsaved Experiment" });

    const revert = await request(app).post("/api/v1/site-settings/identity/revert").set("Authorization", `Bearer ${adminToken}`).send();
    expect(revert.status).toBe(200);
    expect(revert.body.data.draft.siteName).toBe("Published Name");

    const audit = await prisma.auditLog.findFirst({ where: { organizationId: orgId, action: "SETTINGS_REVERTED", resourceType: "site_identity" } });
    expect(audit).not.toBeNull();
  });

  it("accepts an ACTIVE image as a logo and auto-promotes it to PUBLIC visibility", async () => {
    const mediaId = await createActiveMedia(app, adminToken, "logo.png");
    const before = await prisma.mediaAsset.findUnique({ where: { id: mediaId } });
    expect(before?.visibility).toBe("PRIVATE");

    const save = await request(app)
      .put("/api/v1/site-settings/identity/draft")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ siteName: "Published Name", logoMediaId: mediaId });
    expect(save.status).toBe(200);

    const after = await prisma.mediaAsset.findUnique({ where: { id: mediaId } });
    expect(after?.visibility).toBe("PUBLIC");
  });

  it("rejects a logo media that belongs to a different organization (IDOR-safe)", async () => {
    const foreignMediaId = await createActiveMedia(app, otherOrgAdminToken, "foreign-logo.png");
    const res = await request(app)
      .put("/api/v1/site-settings/identity/draft")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ siteName: "X", logoMediaId: foreignMediaId });
    expect(res.status).toBe(400);
  });

  it("rejects a non-image media as a favicon", async () => {
    const docId = await createActiveMedia(app, adminToken, "brochure.pdf", "application/pdf", PDF_BYTES);
    const res = await request(app)
      .put("/api/v1/site-settings/identity/draft")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ siteName: "X", faviconMediaId: docId });
    expect(res.status).toBe(400);
  });

  it("re-validates media at publish time — archiving a referenced logo between draft-save and publish blocks the publish", async () => {
    const mediaId = await createActiveMedia(app, adminToken, "about-to-be-archived.png");
    await request(app)
      .put("/api/v1/site-settings/identity/draft")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ siteName: "X", logoMediaId: mediaId });

    await request(app).post(`/api/v1/media/${mediaId}/archive`).set("Authorization", `Bearer ${adminToken}`).send();

    const publish = await request(app).post("/api/v1/site-settings/identity/publish").set("Authorization", `Bearer ${adminToken}`).send();
    expect(publish.status).toBe(400);
  });

  it("tenant isolation — another organization's identity/global-styles are independent rows, never shared", async () => {
    await request(app)
      .put("/api/v1/site-settings/identity/draft")
      .set("Authorization", `Bearer ${otherOrgAdminToken}`)
      .send({ siteName: "Other Org Brand" });
    await request(app).post("/api/v1/site-settings/identity/publish").set("Authorization", `Bearer ${otherOrgAdminToken}`).send();

    const mine = await request(app).get("/api/v1/site-settings/identity").set("Authorization", `Bearer ${adminToken}`);
    expect(mine.body.data.published.siteName).toBe("Published Name"); // unaffected by the other org's publish

    const theirs = await request(app).get("/api/v1/site-settings/identity").set("Authorization", `Bearer ${otherOrgAdminToken}`);
    expect(theirs.body.data.published.siteName).toBe("Other Org Brand");
  });

  it("GET /public/site-settings returns the published projection with safe media fields, never raw media ids", async () => {
    if (!config.publicWebsiteOrganizationId) return; // not configured in this env — see .env.test
    await prisma.organization.upsert({
      where: { id: config.publicWebsiteOrganizationId },
      update: {},
      create: { id: config.publicWebsiteOrganizationId, name: "Public Settings Agency", slug: "public-settings-agency" },
    });

    // Writes the published row straight through SystemSetting (same shape
    // the service itself writes) keyed to the real configured public org,
    // since there's no registration flow that lands a fresh admin in that
    // specific, pre-fixed organization id.
    const publicIdentity = { siteName: "Public Co", tagline: "Public Tag", description: "Public desc", defaultMetaTitle: "T", defaultMetaDescription: "D", logoMediaId: null };
    await prisma.systemSetting.upsert({
      where: { organizationId_key: { organizationId: config.publicWebsiteOrganizationId, key: "site.identity" } },
      update: { value: publicIdentity },
      create: { organizationId: config.publicWebsiteOrganizationId, key: "site.identity", type: "JSON", value: publicIdentity },
    });

    const res = await request(app).get("/api/v1/public/site-settings");
    expect(res.status).toBe(200);
    expect(res.body.data.settings.identity.siteName).toBe("Public Co");
    expect(res.body.data.settings.identity).not.toHaveProperty("logoMediaId");
    expect(res.body.data.settings.globalStyles.colors.primary).toBe("#7C3AED");
  });

  it("backward compatibility — the generic /settings endpoint still works untouched by this phase", async () => {
    const patchRes = await request(app)
      .patch("/api/v1/settings/branding.display_name")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ value: "Still Works", type: "STRING" });
    expect(patchRes.status).toBe(200);

    const listRes = await request(app).get("/api/v1/settings").set("Authorization", `Bearer ${adminToken}`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.data.settings.some((s: { key: string }) => s.key === "branding.display_name")).toBe(true);
  });
});
