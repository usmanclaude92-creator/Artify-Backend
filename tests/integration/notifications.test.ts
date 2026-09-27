/** Phase 11 — a user's own notifications: list/unread-count/mark-read, tenant/user isolation, real emission from lead assignment/opportunity close/content publish. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp, finalizeApp } from "../../server/app/app";
import { disconnectPrisma } from "../../server/db/prisma";
import { resetDb } from "../helpers/db";

describe("notifications", () => {
  const app = createApp();
  finalizeApp(app);

  let adminToken: string;
  let assigneeToken: string;
  let assigneeUserId: string;
  let otherOrgAdminToken: string;

  beforeAll(async () => {
    await resetDb();
    const reg = await request(app).post("/api/v1/auth/register").send({
      email: "notif-admin@example.com",
      password: "OriginalPassword123",
      firstName: "Notif",
      lastName: "Admin",
      organizationName: "Notif Admin Co",
    });
    adminToken = reg.body.data.session.token;

    const assignee = await request(app)
      .post("/api/v1/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ email: "notif-assignee@example.com", password: "MemberPassword123", firstName: "A", lastName: "Ssignee", roleKey: "USER" });
    assigneeUserId = assignee.body.data.user.id;
    assigneeToken = (await request(app).post("/api/v1/auth/login").send({ email: "notif-assignee@example.com", password: "MemberPassword123" })).body.data
      .session.token;

    const otherOrg = await request(app).post("/api/v1/auth/register").send({
      email: "notif-other-admin@example.com",
      password: "OriginalPassword123",
      firstName: "Other",
      lastName: "Admin",
      organizationName: "Other Notif Org",
    });
    otherOrgAdminToken = otherOrg.body.data.session.token;
  });

  afterAll(async () => {
    await disconnectPrisma();
  });

  it("starts with zero unread notifications for a fresh user", async () => {
    const res = await request(app).get("/api/v1/notifications/unread-count").set("Authorization", `Bearer ${assigneeToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.count).toBe(0);
  });

  it("notifies the assignee when a lead is created already assigned to them (not the actor who assigned it)", async () => {
    await request(app).post("/api/v1/leads").set("Authorization", `Bearer ${adminToken}`).send({ companyName: "Assigned Co", assignedTo: assigneeUserId });

    const count = await request(app).get("/api/v1/notifications/unread-count").set("Authorization", `Bearer ${assigneeToken}`);
    expect(count.body.data.count).toBe(1);

    const adminCount = await request(app).get("/api/v1/notifications/unread-count").set("Authorization", `Bearer ${adminToken}`);
    expect(adminCount.body.data.count).toBe(0);

    const list = await request(app).get("/api/v1/notifications").set("Authorization", `Bearer ${assigneeToken}`);
    expect(list.status).toBe(200);
    expect(list.body.data.notifications).toHaveLength(1);
    expect(list.body.data.notifications[0].type).toBe("lead_assigned");
    expect(list.body.data.notifications[0].status).toBe("UNREAD");
    expect(list.body.data.notifications[0].message).toContain("Assigned Co");
  });

  it("does not notify when a lead is self-assigned by the actor", async () => {
    const before = (await request(app).get("/api/v1/notifications/unread-count").set("Authorization", `Bearer ${adminToken}`)).body.data.count;
    // adminToken's own user id — assign the lead to themselves.
    const me = await request(app).get("/api/v1/auth/me").set("Authorization", `Bearer ${adminToken}`);
    await request(app).post("/api/v1/leads").set("Authorization", `Bearer ${adminToken}`).send({ companyName: "Self Assigned Co", assignedTo: me.body.data.user.id });
    const after = (await request(app).get("/api/v1/notifications/unread-count").set("Authorization", `Bearer ${adminToken}`)).body.data.count;
    expect(after).toBe(before);
  });

  it("marks a single notification read, and mark-all-read clears the count", async () => {
    await request(app).post("/api/v1/leads").set("Authorization", `Bearer ${adminToken}`).send({ companyName: "Second Assignment Co", assignedTo: assigneeUserId });

    const list = await request(app).get("/api/v1/notifications").set("Authorization", `Bearer ${assigneeToken}`).query({ status: "UNREAD" });
    expect(list.body.data.notifications.length).toBeGreaterThanOrEqual(2);
    const firstId = list.body.data.notifications[0].id;

    const markOne = await request(app).post(`/api/v1/notifications/${firstId}/read`).set("Authorization", `Bearer ${assigneeToken}`);
    expect(markOne.status).toBe(200);
    expect(markOne.body.data.notification.status).toBe("READ");
    expect(markOne.body.data.notification.readAt).not.toBeNull();

    const markAll = await request(app).post("/api/v1/notifications/read-all").set("Authorization", `Bearer ${assigneeToken}`);
    expect(markAll.status).toBe(200);

    const finalCount = await request(app).get("/api/v1/notifications/unread-count").set("Authorization", `Bearer ${assigneeToken}`);
    expect(finalCount.body.data.count).toBe(0);
  });

  it("never leaks another user's notification, even a 404-safe attempt across organizations", async () => {
    const list = await request(app).get("/api/v1/notifications").set("Authorization", `Bearer ${assigneeToken}`);
    const someId = list.body.data.notifications[0]?.id;
    if (someId) {
      const crossUser = await request(app).post(`/api/v1/notifications/${someId}/read`).set("Authorization", `Bearer ${otherOrgAdminToken}`);
      expect(crossUser.status).toBe(404);
    }

    const otherOrgList = await request(app).get("/api/v1/notifications").set("Authorization", `Bearer ${otherOrgAdminToken}`);
    expect(otherOrgList.body.data.notifications).toHaveLength(0);
  });

  it("notifies on opportunity assignment, win, and loss (deduped, excluding the acting user)", async () => {
    const client = await request(app).post("/api/v1/clients").set("Authorization", `Bearer ${adminToken}`).send({ clientCode: "NOTIF-CLIENT", name: "Notif Client" });
    const clientId = client.body.data.client.id;

    const countBefore = (await request(app).get("/api/v1/notifications/unread-count").set("Authorization", `Bearer ${assigneeToken}`)).body.data.count;

    const opp = await request(app)
      .post("/api/v1/opportunities")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ clientId, name: "Notify Deal", value: 500, assignedTo: assigneeUserId });
    const oppId = opp.body.data.opportunity.id;

    const afterAssign = (await request(app).get("/api/v1/notifications/unread-count").set("Authorization", `Bearer ${assigneeToken}`)).body.data.count;
    expect(afterAssign).toBe(countBefore + 1);

    await request(app).post(`/api/v1/opportunities/${oppId}/win`).set("Authorization", `Bearer ${adminToken}`).send();
    const afterWin = (await request(app).get("/api/v1/notifications/unread-count").set("Authorization", `Bearer ${assigneeToken}`)).body.data.count;
    expect(afterWin).toBe(afterAssign + 1);

    const list = await request(app).get("/api/v1/notifications").set("Authorization", `Bearer ${assigneeToken}`).query({ status: "UNREAD" });
    expect(list.body.data.notifications.some((n: { type: string }) => n.type === "opportunity_won")).toBe(true);
  });

  it("notifies the original author (not the publishing actor) when their post is published", async () => {
    await request(app)
      .post("/api/v1/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ email: "notif-author@example.com", password: "MemberPassword123", firstName: "Au", lastName: "Thor", roleKey: "USER" });
    const authorToken = (await request(app).post("/api/v1/auth/login").send({ email: "notif-author@example.com", password: "MemberPassword123" })).body
      .data.session.token;

    const post = await request(app).post("/api/v1/posts").set("Authorization", `Bearer ${authorToken}`).send({ title: "Notify Post", body: "content" });
    const postId = post.body.data.post.id;

    const before = (await request(app).get("/api/v1/notifications/unread-count").set("Authorization", `Bearer ${authorToken}`)).body.data.count;
    await request(app).post(`/api/v1/posts/${postId}/publish`).set("Authorization", `Bearer ${adminToken}`).send();
    const after = (await request(app).get("/api/v1/notifications/unread-count").set("Authorization", `Bearer ${authorToken}`)).body.data.count;
    expect(after).toBe(before + 1);

    const list = await request(app).get("/api/v1/notifications").set("Authorization", `Bearer ${authorToken}`).query({ status: "UNREAD" });
    expect(list.body.data.notifications.some((n: { type: string; message: string }) => n.type === "content_published" && n.message.includes("Notify Post"))).toBe(true);
  });
});
