/** Private blog post previews: a draft renders on the public site via a hashed, expiring, revocable token; never leaks otherwise. */
import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp, finalizeApp } from "../../server/app/app";
import { disconnectPrisma, prisma } from "../../server/db/prisma";
import { config } from "../../server/config/env";
import { hashToken } from "../../server/utils/crypto";
import { resetDb } from "../helpers/db";

const PUBLIC_ORG_ID = config.publicWebsiteOrganizationId;

describe("post preview links", () => {
  const app = createApp();
  finalizeApp(app);

  let adminToken: string;
  let viewerToken: string;
  let otherOrgToken: string;
  let adminPostId: string;
  let publicDraftId: string;

  async function draftPost(orgId: string, slug: string, body: string) {
    const post = await prisma.post.create({ data: { organizationId: orgId, slug, title: `Title ${slug}`, status: "DRAFT" } });
    const rev = await prisma.contentRevision.create({ data: { postId: post.id, version: 1, status: "DRAFT", title: `Title ${slug}`, body, metadata: {} } });
    await prisma.post.update({ where: { id: post.id }, data: { currentRevisionId: rev.id } });
    return post;
  }
  async function tokenFor(postId: string, opts: { ttlMs?: number; revoked?: boolean } = {}) {
    const token = crypto.randomBytes(32).toString("base64url");
    await prisma.postPreviewToken.create({
      data: { postId, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + (opts.ttlMs ?? 3600_000)), revokedAt: opts.revoked ? new Date() : null },
    });
    return token;
  }

  beforeAll(async () => {
    await resetDb();
    await prisma.organization.create({ data: { id: PUBLIC_ORG_ID, name: "Public Preview Agency", slug: "public-preview-agency" } });
    publicDraftId = (await draftPost(PUBLIC_ORG_ID, "secret-draft", "<p>unpublished words</p>")).id;

    const reg = await request(app).post("/api/v1/auth/register").send({
      email: "preview-admin@example.com", password: "OriginalPassword123", firstName: "Pre", lastName: "View", organizationName: "Preview Admin Co",
    });
    adminToken = reg.body.data.session.token;
    await request(app).post("/api/v1/users").set("Authorization", `Bearer ${adminToken}`).send({
      email: "preview-viewer@example.com", password: "ViewerPassword123", firstName: "V", lastName: "W", roleKey: "VIEWER",
    });
    viewerToken = (await request(app).post("/api/v1/auth/login").send({ email: "preview-viewer@example.com", password: "ViewerPassword123" })).body.data.session.token;
    otherOrgToken = (
      await request(app).post("/api/v1/auth/register").send({
        email: "preview-other@example.com", password: "OriginalPassword123", firstName: "Oth", lastName: "Er", organizationName: "Other Preview Co",
      })
    ).body.data.session.token;
    const adminOrg = (await prisma.user.findFirstOrThrow({ where: { email: "preview-admin@example.com" }, select: { organizationId: true } })).organizationId;
    adminPostId = (await draftPost(adminOrg, "admin-draft", "<p>admin draft</p>")).id;
  });

  afterAll(async () => {
    await disconnectPrisma();
  });

  it("creates a link for an editor, stores only the hash, and keeps the post a draft", async () => {
    const res = await request(app).post(`/api/v1/posts/${adminPostId}/preview`).set("Authorization", `Bearer ${adminToken}`).send({});
    expect(res.status).toBe(201);
    const { token, path, expiresAt } = res.body.data.preview as { token: string; path: string; expiresAt: string };
    expect(path).toBe(`/blog/admin-draft?preview=${token}`);
    expect(new Date(expiresAt).getTime()).toBeGreaterThan(Date.now() + 23 * 3600_000);
    const rows = await prisma.postPreviewToken.findMany({ where: { postId: adminPostId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tokenHash).toBe(hashToken(token));
    expect(JSON.stringify(rows[0])).not.toContain(token);
    expect((await prisma.post.findUniqueOrThrow({ where: { id: adminPostId } })).status).toBe("DRAFT");
  });

  it("denies viewers and other organizations", async () => {
    expect((await request(app).post(`/api/v1/posts/${adminPostId}/preview`).set("Authorization", `Bearer ${viewerToken}`).send({})).status).toBe(403);
    expect((await request(app).post(`/api/v1/posts/${adminPostId}/preview`).set("Authorization", `Bearer ${otherOrgToken}`).send({})).status).toBe(404);
    expect((await request(app).post(`/api/v1/posts/${adminPostId}/preview`).send({})).status).toBe(401);
  });

  it("serves the draft through a valid token, uncached and noindex, with no engagement data", async () => {
    const token = await tokenFor(publicDraftId);
    const res = await request(app).get(`/api/v1/public/post-preview/${token}`);
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["x-robots-tag"]).toContain("noindex");
    const post = res.body.data.post;
    expect(post.slug).toBe("secret-draft");
    expect(post.body).toContain("unpublished words");
    expect(post.previewStatus).toBe("DRAFT");
    expect(post.comments).toEqual([]);
    expect(post.likes).toBe(0);
  });

  it("the normal public endpoint still never returns the draft", async () => {
    expect((await request(app).get("/api/v1/public/posts/secret-draft")).status).toBe(404);
  });

  it("rejects unknown, malformed, expired and revoked tokens with the same 404", async () => {
    const expired = await tokenFor(publicDraftId, { ttlMs: -1000 });
    const revoked = await tokenFor(publicDraftId, { revoked: true });
    for (const t of ["x".repeat(43), "short", expired, revoked]) {
      expect((await request(app).get(`/api/v1/public/post-preview/${t}`)).status).toBe(404);
    }
  });

  it("a token for a post outside the public website organization never resolves", async () => {
    const token = await tokenFor(adminPostId);
    expect((await request(app).get(`/api/v1/public/post-preview/${token}`)).status).toBe(404);
  });

  it("revoking disables existing links", async () => {
    const created = await request(app).post(`/api/v1/posts/${adminPostId}/preview`).set("Authorization", `Bearer ${adminToken}`).send({});
    expect(created.status).toBe(201);
    const revoke = await request(app).post(`/api/v1/posts/${adminPostId}/preview/revoke`).set("Authorization", `Bearer ${adminToken}`).send({});
    expect(revoke.status).toBe(200);
    expect(revoke.body.data.revoked).toBeGreaterThanOrEqual(1);
    expect(await prisma.postPreviewToken.count({ where: { postId: adminPostId, revokedAt: null, expiresAt: { gt: new Date() } } })).toBe(0);
  });
});
