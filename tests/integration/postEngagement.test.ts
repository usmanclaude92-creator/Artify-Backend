/** Reader engagement on public blog posts: one like / rating per browser, moderated comments, tenant isolation of the moderation queue. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp, finalizeApp } from "../../server/app/app";
import { disconnectPrisma, prisma } from "../../server/db/prisma";
import { config } from "../../server/config/env";
import { resetDb } from "../helpers/db";

const PUBLIC_ORG_ID = config.publicWebsiteOrganizationId;
const CLIENT_A = "client-a-0123456789abcdef";
const CLIENT_B = "client-b-0123456789abcdef";

describe("post engagement (likes, ratings, comments)", () => {
  const app = createApp();
  finalizeApp(app);

  let slug: string;
  let publicPostId: string;
  let adminToken: string;
  let adminOrgId: string;
  let adminPostId: string;

  async function publishedPost(orgId: string, postSlug: string) {
    const post = await prisma.post.create({ data: { organizationId: orgId, slug: postSlug, title: postSlug, status: "PUBLISHED", publishedAt: new Date() } });
    const rev = await prisma.contentRevision.create({ data: { postId: post.id, version: 1, status: "PUBLISHED", title: postSlug, body: "<p>x</p>", metadata: {} } });
    await prisma.post.update({ where: { id: post.id }, data: { currentRevisionId: rev.id } });
    return post;
  }

  beforeAll(async () => {
    await resetDb();
    await prisma.organization.create({ data: { id: PUBLIC_ORG_ID, name: "Public Test Agency", slug: "public-engagement-agency" } });
    const post = await publishedPost(PUBLIC_ORG_ID, "engagement-post");
    slug = post.slug;
    publicPostId = post.id;

    const reg = await request(app).post("/api/v1/auth/register").send({
      email: "engagement-admin@example.com", password: "OriginalPassword123", firstName: "En", lastName: "Gage", organizationName: "Engagement Admin Co",
    });
    adminToken = reg.body.data.session.token;
    adminOrgId = (await prisma.user.findFirstOrThrow({ where: { email: "engagement-admin@example.com" }, select: { organizationId: true } })).organizationId;
    adminPostId = (await publishedPost(adminOrgId, "admin-org-post")).id;
  });

  afterAll(async () => {
    await disconnectPrisma();
  });

  it("starts at zero: no seeded likes, ratings or comments", async () => {
    const res = await request(app).get(`/api/v1/public/posts/${slug}`);
    expect(res.status).toBe(200);
    expect(res.body.data.post.likes).toBe(0);
    expect(res.body.data.post.rating).toEqual({ average: 0, count: 0 });
    expect(res.body.data.post.commentCount).toBe(0);
    expect(res.body.data.post.comments).toEqual([]);
  });

  it("counts one like per browser, and unliking removes it", async () => {
    const like = (clientId: string, liked: boolean) => request(app).post(`/api/v1/public/posts/${slug}/like`).send({ clientId, liked });
    expect((await like(CLIENT_A, true)).body.data.likes).toBe(1);
    expect((await like(CLIENT_A, true)).body.data.likes).toBe(1); // repeat tap: still one
    expect((await like(CLIENT_B, true)).body.data.likes).toBe(2);
    expect((await like(CLIENT_A, false)).body.data.likes).toBe(1);
    const res = await request(app).get(`/api/v1/public/posts/${slug}`);
    expect(res.body.data.post.likes).toBe(1);
  });

  it("keeps one rating per browser and reports the real average", async () => {
    const rate = (clientId: string, score: number) => request(app).post(`/api/v1/public/posts/${slug}/rating`).send({ clientId, score });
    expect((await rate(CLIENT_A, 5)).body.data.rating).toEqual({ average: 5, count: 1 });
    expect((await rate(CLIENT_B, 4)).body.data.rating).toEqual({ average: 4.5, count: 2 });
    expect((await rate(CLIENT_B, 3)).body.data.rating).toEqual({ average: 4, count: 2 }); // changed mind: replaced, not added
    expect((await rate(CLIENT_A, 6)).status).toBe(400);
    const list = await request(app).get("/api/v1/public/posts");
    expect(list.body.data.posts.find((p: { slug: string }) => p.slug === slug).rating).toEqual({ average: 4, count: 2 });
  });

  it("list ?fields=card omits the article body but keeps reading time and engagement", async () => {
    const full = await request(app).get("/api/v1/public/posts");
    const card = await request(app).get("/api/v1/public/posts?fields=card");
    expect(card.status).toBe(200);
    const fullRow = full.body.data.posts.find((p: { slug: string }) => p.slug === slug);
    const cardRow = card.body.data.posts.find((p: { slug: string }) => p.slug === slug);
    expect(fullRow.body.length).toBeGreaterThan(0);
    expect(cardRow.body).toBe("");
    expect(cardRow.readingMinutes).toBe(fullRow.readingMinutes);
    expect(cardRow.readingMinutes).toBeGreaterThanOrEqual(1);
    expect(cardRow.title).toBe(fullRow.title);
    expect(cardRow.excerpt ?? "").not.toBe("");
    expect(cardRow.rating).toEqual(fullRow.rating);
    expect((await request(app).get("/api/v1/public/posts?fields=bogus")).status).toBe(400);
  });

  it("rejects malformed client ids and unknown or unpublished posts", async () => {
    expect((await request(app).post(`/api/v1/public/posts/${slug}/like`).send({ clientId: "short", liked: true })).status).toBe(400);
    expect((await request(app).post("/api/v1/public/posts/no-such-post/like").send({ clientId: CLIENT_A, liked: true })).status).toBe(404);
    await prisma.post.create({ data: { organizationId: PUBLIC_ORG_ID, slug: "draft-engagement", title: "d", status: "DRAFT" } });
    expect((await request(app).post("/api/v1/public/posts/draft-engagement/like").send({ clientId: CLIENT_A, liked: true })).status).toBe(404);
  });

  it("holds comments for moderation, strips markup, refuses links, and ignores honeypot fills", async () => {
    const send = (body: Record<string, unknown>) => request(app).post(`/api/v1/public/posts/${slug}/comments`).send(body);
    const ok = await send({ name: "Reader One", role: "CFO", body: "<b>Great</b> article about project costing." });
    expect(ok.status).toBe(201);
    expect(ok.body.data.status).toBe("pending");
    expect((await send({ name: "Spammer", body: "visit http://spam.example now" })).status).toBe(400);
    expect((await send({ name: "Bot", body: "I am a bot comment here", website: "http://bot.example" })).status).toBe(201);

    const rows = await prisma.postComment.findMany({ where: { postId: publicPostId } });
    expect(rows).toHaveLength(1); // the honeypot fill and the link comment were not stored
    expect(rows[0]!.status).toBe("PENDING");
    expect(rows[0]!.body).toBe("Great article about project costing.");

    const pub = await request(app).get(`/api/v1/public/posts/${slug}`);
    expect(pub.body.data.post.comments).toEqual([]); // pending is private
    expect(pub.body.data.post.commentCount).toBe(0);
  });

  it("notifies Administrators and Super Administrators (bell) of a new comment, grouped, and nobody else", async () => {
    const mkUser = async (email: string, roleKey: string, orgId = PUBLIC_ORG_ID) => {
      const role = await prisma.role.findUniqueOrThrow({ where: { key: roleKey } });
      return prisma.user.create({ data: { organizationId: orgId, email, passwordHash: "x", firstName: "N", lastName: roleKey, roleId: role.id, status: "ACTIVE" } });
    };
    const admin = await mkUser("bell-admin@example.com", "ADMIN");
    const superAdmin = await mkUser("bell-super@example.com", "SUPER_ADMIN");
    const viewer = await mkUser("bell-viewer@example.com", "VIEWER");
    const otherOrgAdmin = await mkUser("bell-other@example.com", "ADMIN", adminOrgId);
    await prisma.postComment.deleteMany({ where: { postId: publicPostId } });
    // Called through the service: the per-IP comment limiter (5 / 15 min) is covered by the HTTP tests above and would throttle this test.
    const { postEngagementService } = await import("../../server/services/postEngagementService");
    const send = async (body: { name: string; role?: string; body: string; website?: string }) => {
      try {
        await postEngagementService.addComment(slug, body, "203.0.113.9");
        return { status: 201 };
      } catch {
        return { status: 400 };
      }
    };
    const bell = (userId: string) => prisma.notification.findMany({ where: { userId, type: "post_comment_pending" } });

    // Spam and honeypot fills create nothing, so they notify nobody.
    await send({ name: "Spammer", body: "visit http://spam.example now" });
    await send({ name: "Bot", body: "I am a bot comment here", website: "x" });
    expect(await bell(admin.id)).toHaveLength(0);

    expect((await send({ name: "Reader One", body: "First real comment here." })).status).toBe(201);
    for (const u of [admin, superAdmin]) {
      const rows = await bell(u.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ status: "UNREAD", title: "New blog comment awaiting review", entityType: "post_comment", organizationId: PUBLIC_ORG_ID });
      expect(rows[0]!.message).toContain("Reader One");
      expect(rows[0]!.message).toContain("Blog Comments");
    }
    expect(await bell(viewer.id)).toHaveLength(0);
    expect(await bell(otherOrgAdmin.id)).toHaveLength(0);

    // A second comment updates the same unread notification to a real pending count instead of adding another.
    expect((await send({ name: "Reader Two", body: "Second real comment here." })).status).toBe(201);
    const grouped = await bell(admin.id);
    expect(grouped).toHaveLength(1);
    expect(grouped[0]!.title).toBe("Blog comments awaiting review");
    expect(grouped[0]!.message).toContain("2 comments are waiting for review");

    // The admin sees it on the bell (unread count), and the visitor request is unaffected by it.
    expect(await prisma.notification.count({ where: { userId: admin.id, status: "UNREAD" } })).toBe(1);
    await prisma.postComment.deleteMany({ where: { postId: publicPostId } });
  });

  it("shows a comment publicly only once it is approved", async () => {
    await prisma.postComment.create({ data: { organizationId: PUBLIC_ORG_ID, postId: publicPostId, authorName: "Reader One", authorRole: "CFO", body: "Great article about project costing.", status: "PENDING" } });
    await prisma.postComment.updateMany({ where: { postId: publicPostId }, data: { status: "APPROVED" } });
    const pub = await request(app).get(`/api/v1/public/posts/${slug}`);
    expect(pub.body.data.post.commentCount).toBe(1);
    expect(pub.body.data.post.comments[0]).toMatchObject({ authorName: "Reader One", authorRole: "CFO", body: "Great article about project costing." });
    expect(Object.keys(pub.body.data.post.comments[0]).sort()).toEqual(["authorName", "authorRole", "body", "createdAt", "id"]); // no ip hash / status leakage
  });

  it("moderation: lists pending, approves and rejects, counts pending, and cannot touch another organization's comments", async () => {
    const mk = (body: string) => prisma.postComment.create({ data: { organizationId: adminOrgId, postId: adminPostId, authorName: "Someone", body, status: "PENDING" } });
    const c1 = await mk("first comment to moderate");
    const c2 = await mk("second comment to moderate");
    const auth = { Authorization: `Bearer ${adminToken}` };

    const pending = await request(app).get("/api/v1/post-comments").set(auth);
    expect(pending.status).toBe(200);
    expect(pending.body.data.comments.map((c: { id: string }) => c.id).sort()).toEqual([c1.id, c2.id].sort());
    expect((await request(app).get("/api/v1/post-comments/pending-count").set(auth)).body.data.count).toBe(2);

    expect((await request(app).patch(`/api/v1/post-comments/${c1.id}`).set(auth).send({ status: "APPROVED" })).body.data.comment.status).toBe("APPROVED");
    expect((await request(app).patch(`/api/v1/post-comments/${c2.id}`).set(auth).send({ status: "REJECTED" })).body.data.comment.status).toBe("REJECTED");
    expect((await request(app).get("/api/v1/post-comments/pending-count").set(auth)).body.data.count).toBe(0);
    expect((await request(app).get("/api/v1/post-comments").query({ status: "APPROVED" }).set(auth)).body.data.comments).toHaveLength(1);

    const foreign = await prisma.postComment.create({ data: { organizationId: PUBLIC_ORG_ID, postId: publicPostId, authorName: "Other", body: "other org comment", status: "PENDING" } });
    expect((await request(app).patch(`/api/v1/post-comments/${foreign.id}`).set(auth).send({ status: "APPROVED" })).status).toBe(404);
    expect((await request(app).get("/api/v1/post-comments")).status).toBe(401);
  });
});
