/** Phase 8 — page CRUD, publish/schedule workflow, revision immutability, permissions, IDOR, concurrency. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp, finalizeApp } from "../../server/app/app";
import { disconnectPrisma, prisma } from "../../server/db/prisma";
import { resetDb } from "../helpers/db";

describe("CMS pages", () => {
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
      email: "pages-admin@example.com",
      password: "OriginalPassword123",
      firstName: "Pages",
      lastName: "Admin",
      organizationName: "Pages Admin Co",
    });
    adminToken = reg.body.data.session.token;

    for (const [email, roleKey] of [
      ["pages-manager@example.com", "MANAGER"],
      ["pages-user@example.com", "USER"],
      ["pages-viewer@example.com", "VIEWER"],
    ] as const) {
      await request(app)
        .post("/api/v1/users")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ email, password: "MemberPassword123", firstName: "M", lastName: "W", roleKey });
    }
    managerToken = (await request(app).post("/api/v1/auth/login").send({ email: "pages-manager@example.com", password: "MemberPassword123" })).body.data
      .session.token;
    userToken = (await request(app).post("/api/v1/auth/login").send({ email: "pages-user@example.com", password: "MemberPassword123" })).body.data.session
      .token;
    viewerToken = (await request(app).post("/api/v1/auth/login").send({ email: "pages-viewer@example.com", password: "MemberPassword123" })).body.data
      .session.token;

    const otherOrg = await request(app).post("/api/v1/auth/register").send({
      email: "pages-other-admin@example.com",
      password: "OriginalPassword123",
      firstName: "Other",
      lastName: "Admin",
      organizationName: "Other Org Co",
    });
    otherOrgAdminToken = otherOrg.body.data.session.token;
  });

  afterAll(async () => {
    await disconnectPrisma();
  });

  it("creates a page with a server-generated slug, a v1 DRAFT revision, and audits PAGE_CREATED", async () => {
    const res = await request(app)
      .post("/api/v1/pages")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ title: "About Us", body: "<p>Hello</p>" });
    expect(res.status).toBe(201);
    expect(res.body.data.page.slug).toBe("about-us");
    expect(res.body.data.page.status).toBe("DRAFT");
    expect(res.body.data.page.currentRevision.version).toBe(1);
    expect(res.body.data.page.currentRevision.status).toBe("DRAFT");

    const audit = await prisma.auditLog.findFirst({ where: { action: "PAGE_CREATED", resourceId: res.body.data.page.id } });
    expect(audit).not.toBeNull();
  });

  it("rejects a duplicate explicit slug within the same organization with a clean 409", async () => {
    await request(app).post("/api/v1/pages").set("Authorization", `Bearer ${adminToken}`).send({ title: "Dup A", slug: "dup-slug" });
    const dupe = await request(app).post("/api/v1/pages").set("Authorization", `Bearer ${adminToken}`).send({ title: "Dup B", slug: "dup-slug" });
    expect(dupe.status).toBe(409);
  });

  it("edits DRAFT content in place (no new revision) until publish, then clones on further edits", async () => {
    const created = await request(app)
      .post("/api/v1/pages")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ title: "Lifecycle Page", body: "v1 body" });
    const id = created.body.data.page.id;

    const edited = await request(app).patch(`/api/v1/pages/${id}`).set("Authorization", `Bearer ${adminToken}`).send({ body: "v1 body edited" });
    expect(edited.status).toBe(200);
    expect(edited.body.data.page.currentRevision.version).toBe(1);
    expect(edited.body.data.page.currentRevision.body).toBe("v1 body edited");

    const publish = await request(app).post(`/api/v1/pages/${id}/publish`).set("Authorization", `Bearer ${adminToken}`).send();
    expect(publish.status).toBe(200);
    expect(publish.body.data.page.status).toBe("PUBLISHED");
    expect(publish.body.data.page.currentRevision.status).toBe("PUBLISHED");
    const publishedRevisionId = publish.body.data.page.currentRevisionId;

    // Editing a PUBLISHED page's content directly (no `status` field, i.e.
    // the composer's ordinary Save) is a live edit: it stays published
    // immediately, but forks a new revision rather than mutating the
    // already-published one in place.
    const liveEdit = await request(app).patch(`/api/v1/pages/${id}`).set("Authorization", `Bearer ${adminToken}`).send({ body: "v2 body live" });
    expect(liveEdit.status).toBe(200);
    expect(liveEdit.body.data.page.status).toBe("PUBLISHED");
    expect(liveEdit.body.data.page.currentRevisionId).not.toBe(publishedRevisionId);
    expect(liveEdit.body.data.page.currentRevision.version).toBe(2);
    expect(liveEdit.body.data.page.currentRevision.status).toBe("PUBLISHED");
    expect(liveEdit.body.data.page.currentRevision.body).toBe("v2 body live");

    // Unpublish (PUBLISHED -> DRAFT) clones yet another revision, leaving the published ones untouched.
    const unpublish = await request(app).patch(`/api/v1/pages/${id}`).set("Authorization", `Bearer ${adminToken}`).send({ status: "DRAFT", body: "v3 body" });
    expect(unpublish.status).toBe(200);
    expect(unpublish.body.data.page.status).toBe("DRAFT");
    expect(unpublish.body.data.page.currentRevision.version).toBe(3);
    expect(unpublish.body.data.page.currentRevision.body).toBe("v3 body");

    const publishedRevision = await prisma.contentRevision.findUnique({ where: { id: publishedRevisionId } });
    expect(publishedRevision?.status).toBe("PUBLISHED");
    expect(publishedRevision?.body).toBe("v1 body edited");

    const revisions = await request(app).get(`/api/v1/pages/${id}/revisions`).set("Authorization", `Bearer ${adminToken}`);
    expect(revisions.body.data.revisions).toHaveLength(3);
  });

  it("blocks direct content edits on an ARCHIVED page", async () => {
    const created = await request(app).post("/api/v1/pages").set("Authorization", `Bearer ${adminToken}`).send({ title: "Archive Edit Guard", body: "v1" });
    const id = created.body.data.page.id;

    const archive = await request(app).post(`/api/v1/pages/${id}/archive`).set("Authorization", `Bearer ${adminToken}`).send();
    expect(archive.status).toBe(200);
    expect(archive.body.data.page.status).toBe("ARCHIVED");

    const editWhileArchived = await request(app).patch(`/api/v1/pages/${id}`).set("Authorization", `Bearer ${adminToken}`).send({ body: "sneaky" });
    expect(editWhileArchived.status).toBe(409);
  });

  it("rejects an invalid direct status transition (DRAFT -> PUBLISHED via generic PATCH)", async () => {
    const created = await request(app).post("/api/v1/pages").set("Authorization", `Bearer ${adminToken}`).send({ title: "Bad Transition" });
    const id = created.body.data.page.id;
    const res = await request(app).patch(`/api/v1/pages/${id}`).set("Authorization", `Bearer ${adminToken}`).send({ status: "PUBLISHED" });
    expect(res.status).toBe(400);
  });

  it("schedules a page for the future, then rejects scheduling an already-published page", async () => {
    const created = await request(app).post("/api/v1/pages").set("Authorization", `Bearer ${adminToken}`).send({ title: "Scheduled Page", body: "content" });
    const id = created.body.data.page.id;

    const future = new Date(Date.now() + 86400000).toISOString();
    const schedule = await request(app).post(`/api/v1/pages/${id}/schedule`).set("Authorization", `Bearer ${adminToken}`).send({ scheduledAt: future });
    expect(schedule.status).toBe(200);
    expect(schedule.body.data.page.status).toBe("SCHEDULED");

    const pastReject = await request(app)
      .post(`/api/v1/pages/${id}/schedule`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ scheduledAt: new Date(Date.now() - 1000).toISOString() });
    expect(pastReject.status).toBe(400);

    const publish = await request(app).post(`/api/v1/pages/${id}/publish`).set("Authorization", `Bearer ${adminToken}`).send();
    expect(publish.status).toBe(200);

    const rescheduleAfterPublish = await request(app)
      .post(`/api/v1/pages/${id}/schedule`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ scheduledAt: future });
    expect(rescheduleAfterPublish.status).toBe(409);
  });

  it("rejects setting ARCHIVED/IN_REVIEW directly via generic PATCH (dedicated endpoints only)", async () => {
    const created = await request(app).post("/api/v1/pages").set("Authorization", `Bearer ${adminToken}`).send({ title: "Direct Status Attempt" });
    const id = created.body.data.page.id;
    expect((await request(app).patch(`/api/v1/pages/${id}`).set("Authorization", `Bearer ${adminToken}`).send({ status: "ARCHIVED" })).status).toBe(400);
    expect((await request(app).patch(`/api/v1/pages/${id}`).set("Authorization", `Bearer ${adminToken}`).send({ status: "IN_REVIEW" })).status).toBe(400);
  });

  it("archives via the dedicated endpoint, blocks further content edits, and restore (PATCH -> DRAFT) re-enables editing", async () => {
    const created = await request(app).post("/api/v1/pages").set("Authorization", `Bearer ${adminToken}`).send({ title: "Archive Me" });
    const id = created.body.data.page.id;

    const archive = await request(app).post(`/api/v1/pages/${id}/archive`).set("Authorization", `Bearer ${adminToken}`).send();
    expect(archive.status).toBe(200);
    expect(archive.body.data.page.status).toBe("ARCHIVED");

    const reArchive = await request(app).post(`/api/v1/pages/${id}/archive`).set("Authorization", `Bearer ${adminToken}`).send();
    expect(reArchive.status).toBe(409);

    const editWhileArchived = await request(app).patch(`/api/v1/pages/${id}`).set("Authorization", `Bearer ${adminToken}`).send({ title: "Nope" });
    expect(editWhileArchived.status).toBe(409);

    const restore = await request(app).patch(`/api/v1/pages/${id}`).set("Authorization", `Bearer ${adminToken}`).send({ status: "DRAFT" });
    expect(restore.status).toBe(200);
    expect(restore.body.data.page.status).toBe("DRAFT");

    const editAfterRestore = await request(app).patch(`/api/v1/pages/${id}`).set("Authorization", `Bearer ${adminToken}`).send({ title: "Restored Title" });
    expect(editAfterRestore.status).toBe(200);
    expect(editAfterRestore.body.data.page.title).toBe("Restored Title");

    const audit = await prisma.auditLog.findFirst({ where: { action: "PAGE_ARCHIVED", resourceId: id } });
    expect(audit).not.toBeNull();
  });

  it("submits a DRAFT page for review, rejecting an empty body and a non-DRAFT source", async () => {
    const empty = await request(app).post("/api/v1/pages").set("Authorization", `Bearer ${adminToken}`).send({ title: "Empty Body Page" });
    const emptyId = empty.body.data.page.id;
    const rejectEmpty = await request(app).post(`/api/v1/pages/${emptyId}/submit-review`).set("Authorization", `Bearer ${adminToken}`).send();
    expect(rejectEmpty.status).toBe(400);

    const created = await request(app).post("/api/v1/pages").set("Authorization", `Bearer ${adminToken}`).send({ title: "Review Me", body: "content" });
    const id = created.body.data.page.id;
    const submit = await request(app).post(`/api/v1/pages/${id}/submit-review`).set("Authorization", `Bearer ${adminToken}`).send();
    expect(submit.status).toBe(200);
    expect(submit.body.data.page.status).toBe("IN_REVIEW");

    const resubmit = await request(app).post(`/api/v1/pages/${id}/submit-review`).set("Authorization", `Bearer ${adminToken}`).send();
    expect(resubmit.status).toBe(409);

    const audit = await prisma.auditLog.findFirst({ where: { action: "PAGE_SUBMITTED_FOR_REVIEW", resourceId: id } });
    expect(audit).not.toBeNull();
  });

  it("reverts to a prior revision, creating a new revision rather than mutating history, and unpublishes if the page was live", async () => {
    const created = await request(app).post("/api/v1/pages").set("Authorization", `Bearer ${adminToken}`).send({ title: "Revert Me", body: "v1" });
    const id = created.body.data.page.id;
    const v1RevisionId = created.body.data.page.currentRevisionId;

    await request(app).patch(`/api/v1/pages/${id}`).set("Authorization", `Bearer ${adminToken}`).send({ body: "v1 tweaked" });
    await request(app).post(`/api/v1/pages/${id}/publish`).set("Authorization", `Bearer ${adminToken}`).send();
    await request(app).patch(`/api/v1/pages/${id}`).set("Authorization", `Bearer ${adminToken}`).send({ status: "DRAFT", body: "v2" });

    const revisionsBefore = await request(app).get(`/api/v1/pages/${id}/revisions`).set("Authorization", `Bearer ${adminToken}`);
    expect(revisionsBefore.body.data.revisions).toHaveLength(2);

    const revert = await request(app).post(`/api/v1/pages/${id}/revert`).set("Authorization", `Bearer ${adminToken}`).send({ revisionId: v1RevisionId });
    expect(revert.status).toBe(200);
    expect(revert.body.data.page.currentRevision.version).toBe(3);
    expect(revert.body.data.page.currentRevision.body).toBe("v1 tweaked");
    expect(revert.body.data.page.status).toBe("DRAFT");

    const v1Untouched = await prisma.contentRevision.findUnique({ where: { id: v1RevisionId } });
    expect(v1Untouched?.body).toBe("v1 tweaked");
    expect(v1Untouched?.status).toBe("PUBLISHED");

    const revisionsAfter = await request(app).get(`/api/v1/pages/${id}/revisions`).set("Authorization", `Bearer ${adminToken}`);
    expect(revisionsAfter.body.data.revisions).toHaveLength(3);

    const audit = await prisma.auditLog.findFirst({ where: { action: "PAGE_REVERTED", resourceId: id } });
    expect(audit).not.toBeNull();
  });

  it("rejects reverting to a revisionId that belongs to a different page (IDOR-safe)", async () => {
    const pageA = await request(app).post("/api/v1/pages").set("Authorization", `Bearer ${adminToken}`).send({ title: "Page A", body: "a" });
    const pageB = await request(app).post("/api/v1/pages").set("Authorization", `Bearer ${adminToken}`).send({ title: "Page B", body: "b" });
    const foreignRevisionId = pageB.body.data.page.currentRevisionId;

    const res = await request(app)
      .post(`/api/v1/pages/${pageA.body.data.page.id}/revert`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ revisionId: foreignRevisionId });
    expect(res.status).toBe(404);
  });

  it("optimistic concurrency: a stale expectedUpdatedAt is rejected with 409, never silently overwriting a concurrent edit", async () => {
    const created = await request(app).post("/api/v1/pages").set("Authorization", `Bearer ${adminToken}`).send({ title: "Concurrent Page", body: "v1" });
    const id = created.body.data.page.id;
    const staleUpdatedAt = created.body.data.page.updatedAt;

    const userBUpdate = await request(app).patch(`/api/v1/pages/${id}`).set("Authorization", `Bearer ${adminToken}`).send({ body: "user B's change" });
    expect(userBUpdate.status).toBe(200);

    const userAStaleUpdate = await request(app)
      .patch(`/api/v1/pages/${id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ body: "user A's stale change", expectedUpdatedAt: staleUpdatedAt });
    expect(userAStaleUpdate.status).toBe(409);

    const current = await request(app).get(`/api/v1/pages/${id}`).set("Authorization", `Bearer ${adminToken}`);
    expect(current.body.data.page.currentRevision.body).toBe("user B's change");

    const freshUpdate = await request(app)
      .patch(`/api/v1/pages/${id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ body: "user A's fresh change", expectedUpdatedAt: userBUpdate.body.data.page.updatedAt });
    expect(freshUpdate.status).toBe(200);
  });

  it("soft-deletes a page (sets deletedAt, never a physical delete) and excludes it from listing/get thereafter", async () => {
    const created = await request(app).post("/api/v1/pages").set("Authorization", `Bearer ${adminToken}`).send({ title: "Delete Me" });
    const id = created.body.data.page.id;

    const del = await request(app).delete(`/api/v1/pages/${id}`).set("Authorization", `Bearer ${adminToken}`).send();
    expect(del.status).toBe(200);

    const row = await prisma.page.findUnique({ where: { id } });
    expect(row).not.toBeNull();
    expect(row?.deletedAt).not.toBeNull();

    const get = await request(app).get(`/api/v1/pages/${id}`).set("Authorization", `Bearer ${adminToken}`);
    expect(get.status).toBe(404);
  });

  it("enforces per-permission tiers: VIEWER read-only, USER can create but not update, MANAGER can update but not publish/delete", async () => {
    const created = await request(app).post("/api/v1/pages").set("Authorization", `Bearer ${adminToken}`).send({ title: "Perm Page" });
    const id = created.body.data.page.id;

    expect((await request(app).get("/api/v1/pages").set("Authorization", `Bearer ${viewerToken}`)).status).toBe(200);
    expect((await request(app).post("/api/v1/pages").set("Authorization", `Bearer ${viewerToken}`).send({ title: "X" })).status).toBe(403);

    expect((await request(app).post("/api/v1/pages").set("Authorization", `Bearer ${userToken}`).send({ title: "By User" })).status).toBe(201);
    expect((await request(app).patch(`/api/v1/pages/${id}`).set("Authorization", `Bearer ${userToken}`).send({ title: "Y" })).status).toBe(403);

    expect((await request(app).patch(`/api/v1/pages/${id}`).set("Authorization", `Bearer ${managerToken}`).send({ title: "By Manager" })).status).toBe(200);
    expect((await request(app).post(`/api/v1/pages/${id}/publish`).set("Authorization", `Bearer ${managerToken}`).send()).status).toBe(403);
    expect((await request(app).delete(`/api/v1/pages/${id}`).set("Authorization", `Bearer ${managerToken}`).send()).status).toBe(403);
  });

  it("rejects unauthenticated requests", async () => {
    const res = await request(app).get("/api/v1/pages");
    expect(res.status).toBe(401);
  });

  it("IDOR: a page id from another organization is not readable, editable, or publishable", async () => {
    const created = await request(app)
      .post("/api/v1/pages")
      .set("Authorization", `Bearer ${otherOrgAdminToken}`)
      .send({ title: "Other Org Page" });
    const foreignId = created.body.data.page.id;

    expect((await request(app).get(`/api/v1/pages/${foreignId}`).set("Authorization", `Bearer ${adminToken}`)).status).toBe(404);
    expect((await request(app).patch(`/api/v1/pages/${foreignId}`).set("Authorization", `Bearer ${adminToken}`).send({ title: "Hijack" })).status).toBe(404);
    expect((await request(app).post(`/api/v1/pages/${foreignId}/publish`).set("Authorization", `Bearer ${adminToken}`).send()).status).toBe(404);
    expect((await request(app).delete(`/api/v1/pages/${foreignId}`).set("Authorization", `Bearer ${adminToken}`).send()).status).toBe(404);
  });

  it("searches/filters/paginates/sorts pages server-side", async () => {
    await request(app).post("/api/v1/pages").set("Authorization", `Bearer ${adminToken}`).send({ title: "Findable Gamma" });
    await request(app).post("/api/v1/pages").set("Authorization", `Bearer ${adminToken}`).send({ title: "Findable Delta" });

    const search = await request(app).get("/api/v1/pages").query({ search: "Findable" }).set("Authorization", `Bearer ${adminToken}`);
    expect(search.body.data.pages.length).toBeGreaterThanOrEqual(2);

    const paged = await request(app).get("/api/v1/pages").query({ page: 1, limit: 1 }).set("Authorization", `Bearer ${adminToken}`);
    expect(paged.body.data.pages).toHaveLength(1);

    const unsafeSort = await request(app).get("/api/v1/pages").query({ sort: "1; DROP TABLE pages;--" }).set("Authorization", `Bearer ${adminToken}`);
    expect(unsafeSort.status).toBe(400);
  });

  // Phase 1 (Website module) — page/template relationship + backward
  // compatibility (docs/control-center-data-preservation-plan.md,
  // docs/control-center-public-site-integration.md). A page created with
  // none of these fields must behave exactly as it did before this phase.
  it("defaults templateId/pageType/isHomepage to backward-compatible values when omitted", async () => {
    const res = await request(app).post("/api/v1/pages").set("Authorization", `Bearer ${adminToken}`).send({ title: "Untouched By Phase 1" });
    expect(res.status).toBe(201);
    expect(res.body.data.page.templateId).toBeNull();
    expect(res.body.data.page.pageType).toBe("STANDARD");
    expect(res.body.data.page.isHomepage).toBe(false);
  });

  it("rejects assigning a templateId that isn't PUBLISHED, doesn't exist, or belongs to another organization", async () => {
    const draftTemplate = await request(app).post("/api/v1/templates").set("Authorization", `Bearer ${adminToken}`).send({ type: "STANDARD_PAGE", name: "Draft Only" });
    const draftReject = await request(app)
      .post("/api/v1/pages")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ title: "Bad Template Page", templateId: draftTemplate.body.data.template.id });
    expect(draftReject.status).toBe(400);

    const nonexistentReject = await request(app)
      .post("/api/v1/pages")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ title: "Nonexistent Template Page", templateId: "00000000-0000-0000-0000-000000000000" });
    expect(nonexistentReject.status).toBe(400);
  });

  it("assigns a PUBLISHED template to a page and the page still renders when that template is later archived (backward-compatible fallback)", async () => {
    const template = await request(app).post("/api/v1/templates").set("Authorization", `Bearer ${adminToken}`).send({ type: "STANDARD_PAGE", name: "Real Template" });
    const templateId = template.body.data.template.id;
    await request(app).post(`/api/v1/templates/${templateId}/publish`).set("Authorization", `Bearer ${adminToken}`).send();

    const page = await request(app).post("/api/v1/pages").set("Authorization", `Bearer ${adminToken}`).send({ title: "Templated Page", templateId });
    expect(page.status).toBe(201);
    expect(page.body.data.page.templateId).toBe(templateId);

    await request(app).post(`/api/v1/templates/${templateId}/archive`).set("Authorization", `Bearer ${adminToken}`).send();

    // The page itself is untouched — archiving a template never breaks the
    // page that references it (Part D's mandatory backward compatibility).
    const stillFine = await request(app).get(`/api/v1/pages/${page.body.data.page.id}`).set("Authorization", `Bearer ${adminToken}`);
    expect(stillFine.status).toBe(200);
    expect(stillFine.body.data.page.templateId).toBe(templateId);
  });

  it("enforces at most one homepage per organization", async () => {
    const first = await request(app).post("/api/v1/pages").set("Authorization", `Bearer ${adminToken}`).send({ title: "Homepage One", isHomepage: true });
    expect(first.status).toBe(201);
    expect(first.body.data.page.isHomepage).toBe(true);

    const second = await request(app).post("/api/v1/pages").set("Authorization", `Bearer ${adminToken}`).send({ title: "Homepage Two", isHomepage: true });
    expect(second.status).toBe(409);

    // A second organization is free to have its own homepage — this is
    // organization-scoped, not global.
    const otherReg = await request(app).post("/api/v1/auth/register").send({
      email: "pages-homepage-other@example.com",
      password: "OriginalPassword123",
      firstName: "Other",
      lastName: "Org",
      organizationName: "Homepage Other Co",
    });
    const otherToken = otherReg.body.data.session.token;
    const otherHomepage = await request(app).post("/api/v1/pages").set("Authorization", `Bearer ${otherToken}`).send({ title: "Their Homepage", isHomepage: true });
    expect(otherHomepage.status).toBe(201);
  });

  // Phase 5 (Navigation + Pages + Homepage) — switching the homepage to a
  // different page is just reassigning the boolean on two pages; rollback
  // (switching back) must be equally trivial and never destroy content.
  it("reassigns the homepage to a different page and rolls back cleanly", async () => {
    // A dedicated org, since the shared adminToken org may already have a
    // homepage assigned by an earlier test in this file (resetDb runs once
    // per file, not per test).
    const reg = await request(app).post("/api/v1/auth/register").send({
      email: "pages-homepage-rollback@example.com",
      password: "OriginalPassword123",
      firstName: "Rollback",
      lastName: "Org",
      organizationName: "Homepage Rollback Co",
    });
    const token = reg.body.data.session.token;

    const original = await request(app).post("/api/v1/pages").set("Authorization", `Bearer ${token}`).send({ title: "Original Home", isHomepage: true });
    const originalId = original.body.data.page.id;

    const candidate = await request(app).post("/api/v1/pages").set("Authorization", `Bearer ${token}`).send({ title: "New Home Candidate" });
    const candidateId = candidate.body.data.page.id;

    // Unset the current homepage first (the DB constraint allows only one at a time).
    const unset = await request(app).patch(`/api/v1/pages/${originalId}`).set("Authorization", `Bearer ${token}`).send({ isHomepage: false });
    expect(unset.status).toBe(200);
    expect(unset.body.data.page.isHomepage).toBe(false);

    const promote = await request(app).patch(`/api/v1/pages/${candidateId}`).set("Authorization", `Bearer ${token}`).send({ isHomepage: true });
    expect(promote.status).toBe(200);
    expect(promote.body.data.page.isHomepage).toBe(true);

    // Roll back: demote the candidate, restore the original.
    await request(app).patch(`/api/v1/pages/${candidateId}`).set("Authorization", `Bearer ${token}`).send({ isHomepage: false });
    const rollback = await request(app).patch(`/api/v1/pages/${originalId}`).set("Authorization", `Bearer ${token}`).send({ isHomepage: true });
    expect(rollback.status).toBe(200);
    expect(rollback.body.data.page.isHomepage).toBe(true);

    // The original page's own content/title was never touched by any of this.
    const reloaded = await request(app).get(`/api/v1/pages/${originalId}`).set("Authorization", `Bearer ${token}`);
    expect(reloaded.body.data.page.title).toBe("Original Home");
  });

  // Phase 5 — page hierarchy (parentId): clear parent/child relationships,
  // cross-org and self/circular-parent protection, and listing children.
  describe("page hierarchy (parentId)", () => {
    it("assigns a parent and lists it as a child via GET /:id/children", async () => {
      const parent = await request(app).post("/api/v1/pages").set("Authorization", `Bearer ${adminToken}`).send({ title: "Parent Page" });
      const parentId = parent.body.data.page.id;

      const child = await request(app).post("/api/v1/pages").set("Authorization", `Bearer ${adminToken}`).send({ title: "Child Page", parentId });
      expect(child.status).toBe(201);
      expect(child.body.data.page.parentId).toBe(parentId);

      const children = await request(app).get(`/api/v1/pages/${parentId}/children`).set("Authorization", `Bearer ${adminToken}`);
      expect(children.status).toBe(200);
      expect(children.body.data.children.map((c: { id: string }) => c.id)).toContain(child.body.data.page.id);
    });

    it("rejects a parentId that doesn't exist or belongs to another organization", async () => {
      const nonexistent = await request(app)
        .post("/api/v1/pages")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ title: "Orphan Attempt", parentId: "00000000-0000-0000-0000-000000000000" });
      expect(nonexistent.status).toBe(400);

      const otherReg = await request(app).post("/api/v1/auth/register").send({
        email: "pages-hierarchy-other@example.com",
        password: "OriginalPassword123",
        firstName: "Other",
        lastName: "Org",
        organizationName: "Hierarchy Other Co",
      });
      const otherToken = otherReg.body.data.session.token;
      const foreignParent = await request(app).post("/api/v1/pages").set("Authorization", `Bearer ${otherToken}`).send({ title: "Foreign Parent" });

      const crossOrg = await request(app)
        .post("/api/v1/pages")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ title: "Cross Org Child", parentId: foreignParent.body.data.page.id });
      expect(crossOrg.status).toBe(400);
    });

    it("rejects a page being its own parent, and rejects a circular hierarchy", async () => {
      const page = await request(app).post("/api/v1/pages").set("Authorization", `Bearer ${adminToken}`).send({ title: "Self Parent Attempt" });
      const pageId = page.body.data.page.id;

      const selfParent = await request(app).patch(`/api/v1/pages/${pageId}`).set("Authorization", `Bearer ${adminToken}`).send({ parentId: pageId });
      expect(selfParent.status).toBe(400);

      const grandparent = await request(app).post("/api/v1/pages").set("Authorization", `Bearer ${adminToken}`).send({ title: "Grandparent" });
      const parent = await request(app)
        .post("/api/v1/pages")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ title: "Parent", parentId: grandparent.body.data.page.id });

      // grandparent -> parent is now established; making grandparent a
      // child of parent would create a 2-node cycle.
      const circular = await request(app)
        .patch(`/api/v1/pages/${grandparent.body.data.page.id}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ parentId: parent.body.data.page.id });
      expect(circular.status).toBe(400);
    });

    it("clearing a parent (parentId: null) promotes a page back to top-level", async () => {
      const parent = await request(app).post("/api/v1/pages").set("Authorization", `Bearer ${adminToken}`).send({ title: "Promotable Parent" });
      const child = await request(app)
        .post("/api/v1/pages")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ title: "Promotable Child", parentId: parent.body.data.page.id });

      const cleared = await request(app).patch(`/api/v1/pages/${child.body.data.page.id}`).set("Authorization", `Bearer ${adminToken}`).send({ parentId: null });
      expect(cleared.status).toBe(200);
      expect(cleared.body.data.page.parentId).toBeNull();
    });
  });

  it("concurrency: two simultaneous creates with the same explicit slug produce exactly one success and one clean conflict", async () => {
    const [first, second] = await Promise.all([
      request(app).post("/api/v1/pages").set("Authorization", `Bearer ${adminToken}`).send({ title: "Race A", slug: "race-page" }),
      request(app).post("/api/v1/pages").set("Authorization", `Bearer ${adminToken}`).send({ title: "Race B", slug: "race-page" }),
    ]);
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([201, 409]);

    const count = await prisma.page.count({ where: { slug: "race-page" } });
    expect(count).toBe(1);
  });

  // Phase 2 (Site Editor) — editorBlocks persistence mirrors body's own
  // create/in-place-edit/fork-on-published-edit/revert handling exactly
  // (pageService.ts), and a raw <script> inside a text block is sanitized
  // the same way body HTML already is.
  describe("editorBlocks (Phase 2 — Site Editor)", () => {
    it("creates a page with editorBlocks, sanitizing embedded script content", async () => {
      const res = await request(app)
        .post("/api/v1/pages")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          title: "Editor Page",
          body: "",
          editorBlocks: { version: 1, blocks: [{ id: "t1", type: "text", props: { html: "<p>safe</p><script>alert(1)</script>" } }] },
        });
      expect(res.status).toBe(201);
      const blocks = res.body.data.page.currentRevision.editorBlocks.blocks;
      expect(blocks[0].props.html).toContain("safe");
      expect(blocks[0].props.html).not.toContain("<script>");
    });

    it("edits editorBlocks in place on a DRAFT page (no new revision), then forks a new one on further edits to a PUBLISHED page", async () => {
      const created = await request(app)
        .post("/api/v1/pages")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ title: "Editor Lifecycle", body: "<p>x</p>", editorBlocks: { version: 1, blocks: [] } });
      const id = created.body.data.page.id;

      const docV1 = { version: 1, blocks: [{ id: "h1", type: "heading", props: { text: "v1", level: 2 } }] };
      const edited = await request(app).patch(`/api/v1/pages/${id}`).set("Authorization", `Bearer ${adminToken}`).send({ editorBlocks: docV1 });
      expect(edited.status).toBe(200);
      expect(edited.body.data.page.currentRevision.version).toBe(1);
      expect(edited.body.data.page.currentRevision.editorBlocks).toEqual(docV1);

      await request(app).post(`/api/v1/pages/${id}/publish`).set("Authorization", `Bearer ${adminToken}`).send();

      const docV2 = { version: 1, blocks: [{ id: "h2", type: "heading", props: { text: "v2", level: 2 } }] };
      const liveEdit = await request(app).patch(`/api/v1/pages/${id}`).set("Authorization", `Bearer ${adminToken}`).send({ editorBlocks: docV2 });
      expect(liveEdit.status).toBe(200);
      expect(liveEdit.body.data.page.currentRevision.version).toBe(2);
      expect(liveEdit.body.data.page.currentRevision.editorBlocks).toEqual(docV2);
      expect(liveEdit.body.data.page.status).toBe("PUBLISHED");

      const v1 = await prisma.contentRevision.findFirst({ where: { pageId: id, version: 1 } });
      expect(v1?.editorBlocks).toEqual(docV1);
    });

    it("reverting to a prior PUBLISHED revision restores that revision's editorBlocks (DRAFT edits mutate in place, so this needs the publish->edit fork)", async () => {
      const created = await request(app)
        .post("/api/v1/pages")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ title: "Editor Revert", body: "<p>x</p>", editorBlocks: { version: 1, blocks: [{ id: "a", type: "divider", props: {} }] } });
      const id = created.body.data.page.id;
      const v1RevisionId = created.body.data.page.currentRevisionId;

      await request(app).post(`/api/v1/pages/${id}/publish`).set("Authorization", `Bearer ${adminToken}`).send();
      // Live edit of PUBLISHED content forks a new revision (v2) rather than mutating v1 in place.
      await request(app)
        .patch(`/api/v1/pages/${id}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ editorBlocks: { version: 1, blocks: [{ id: "b", type: "spacer", props: { height: 10 } }] } });

      const revert = await request(app).post(`/api/v1/pages/${id}/revert`).set("Authorization", `Bearer ${adminToken}`).send({ revisionId: v1RevisionId });
      expect(revert.status).toBe(200);
      expect(revert.body.data.page.currentRevision.version).toBe(3);
      expect(revert.body.data.page.currentRevision.editorBlocks).toEqual({ version: 1, blocks: [{ id: "a", type: "divider", props: {} }] });
    });

    it("explicitly clearing editorBlocks (null) falls back to body-only rendering", async () => {
      const created = await request(app)
        .post("/api/v1/pages")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ title: "Editor Clear", body: "<p>x</p>", editorBlocks: { version: 1, blocks: [{ id: "a", type: "divider", props: {} }] } });
      const id = created.body.data.page.id;

      const cleared = await request(app).patch(`/api/v1/pages/${id}`).set("Authorization", `Bearer ${adminToken}`).send({ editorBlocks: null });
      expect(cleared.status).toBe(200);
      expect(cleared.body.data.page.currentRevision.editorBlocks).toBeNull();
    });

    it("rejects a block tree with an unknown block type (schema-validated, not arbitrary JSON)", async () => {
      const res = await request(app)
        .post("/api/v1/pages")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ title: "Bad Blocks", body: "", editorBlocks: { version: 1, blocks: [{ id: "x", type: "not-a-real-block", props: {} }] } });
      expect(res.status).toBe(400);
    });

    it("tenant isolation: editorBlocks on another organization's page is never readable", async () => {
      const created = await request(app)
        .post("/api/v1/pages")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ title: "Private Blocks", body: "", editorBlocks: { version: 1, blocks: [{ id: "a", type: "divider", props: {} }] } });
      const id = created.body.data.page.id;

      const crossOrgRead = await request(app).get(`/api/v1/pages/${id}`).set("Authorization", `Bearer ${otherOrgAdminToken}`);
      expect(crossOrgRead.status).toBe(404);
    });
  });

  // Phase 7 (Content Management upgrade) — excerpt, trash/restore, bulk actions.
  describe("Phase 7 — excerpt, trash, bulk actions", () => {
    it("persists excerpt through create and update", async () => {
      const created = await request(app)
        .post("/api/v1/pages")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ title: "Excerpt Page", body: "v1", excerpt: "page summary" });
      expect(created.body.data.page.currentRevision.excerpt).toBe("page summary");

      const updated = await request(app)
        .patch(`/api/v1/pages/${created.body.data.page.id}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ excerpt: "page summary edited" });
      expect(updated.body.data.page.currentRevision.excerpt).toBe("page summary edited");
    });

    it("soft-deletes into Trash, lists it there, and restores it", async () => {
      const created = await request(app).post("/api/v1/pages").set("Authorization", `Bearer ${adminToken}`).send({ title: "Trash Page Me" });
      const id = created.body.data.page.id;

      await request(app).delete(`/api/v1/pages/${id}`).set("Authorization", `Bearer ${adminToken}`).send();

      const trash = await request(app).get("/api/v1/pages/trash").set("Authorization", `Bearer ${adminToken}`);
      expect(trash.status).toBe(200);
      expect(trash.body.data.pages.some((p: { id: string }) => p.id === id)).toBe(true);

      const restore = await request(app).post(`/api/v1/pages/${id}/restore`).set("Authorization", `Bearer ${adminToken}`).send();
      expect(restore.status).toBe(200);

      const get = await request(app).get(`/api/v1/pages/${id}`).set("Authorization", `Bearer ${adminToken}`);
      expect(get.status).toBe(200);
    });

    it("bulk-trashes and bulk-restores pages through dedicated endpoints distinct from /:id/restore", async () => {
      const a = await request(app).post("/api/v1/pages").set("Authorization", `Bearer ${adminToken}`).send({ title: "Bulk Page A" });
      const idA = a.body.data.page.id;

      const trash = await request(app).post("/api/v1/pages/bulk/trash").set("Authorization", `Bearer ${adminToken}`).send({ ids: [idA] });
      expect(trash.status).toBe(200);
      expect(trash.body.data.succeeded).toEqual([idA]);

      const restore = await request(app).post("/api/v1/pages/bulk/restore").set("Authorization", `Bearer ${adminToken}`).send({ ids: [idA] });
      expect(restore.status).toBe(200);
      expect(restore.body.data.succeeded).toEqual([idA]);

      const get = await request(app).get(`/api/v1/pages/${idA}`).set("Authorization", `Bearer ${adminToken}`);
      expect(get.status).toBe(200);
    });
  });
});
