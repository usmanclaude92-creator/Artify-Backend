/** Phase 5 — Client CRUD, search/pagination, duplicate protection, permission denial, tenant isolation, soft delete. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp, finalizeApp } from "../../server/app/app";
import { disconnectPrisma, prisma } from "../../server/db/prisma";
import { resetDb } from "../helpers/db";

describe("clients", () => {
  const app = createApp();
  finalizeApp(app);

  let adminToken: string;
  let orgId: string;
  let viewerToken: string;

  beforeAll(async () => {
    await resetDb();
    const reg = await request(app).post("/api/v1/auth/register").send({
      email: "clients-admin@example.com",
      password: "OriginalPassword123",
      firstName: "Clients",
      lastName: "Admin",
      organizationName: "Clients Co",
    });
    adminToken = reg.body.data.session.token;
    orgId = reg.body.data.user.organizationId;

    await request(app)
      .post("/api/v1/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ email: "clients-viewer@example.com", password: "ViewerPassword123", firstName: "V", lastName: "W", roleKey: "VIEWER" });
    const viewerLogin = await request(app).post("/api/v1/auth/login").send({ email: "clients-viewer@example.com", password: "ViewerPassword123" });
    viewerToken = viewerLogin.body.data.session.token;
  });

  afterAll(async () => {
    await disconnectPrisma();
  });

  it("rejects unauthenticated access and unauthorized create", async () => {
    const unauth = await request(app).get("/api/v1/clients");
    expect(unauth.status).toBe(401);

    const forbidden = await request(app)
      .post("/api/v1/clients")
      .set("Authorization", `Bearer ${viewerToken}`)
      .send({ clientCode: "ACME", name: "Acme" });
    expect(forbidden.status).toBe(403);
  });

  it("creates a client with server-side validation", async () => {
    const bad = await request(app).post("/api/v1/clients").set("Authorization", `Bearer ${adminToken}`).send({ name: "No Code Co" });
    expect(bad.status).toBe(400);

    const res = await request(app)
      .post("/api/v1/clients")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ clientCode: "ACME-01", name: "Acme Corporation", email: "hello@acme.com", website: "https://acme.example" });
    expect(res.status).toBe(201);
    expect(res.body.data.client.status).toBe("PROSPECT");
    expect(res.body.data.client.organizationId).toBe(orgId);

    const audit = await prisma.auditLog.findFirst({ where: { action: "CLIENT_CREATED", resourceId: res.body.data.client.id } });
    expect(audit).not.toBeNull();
  });

  // Phase 13 — Client Management: source/industry/accountManager profile fields.
  it("creates and updates a client's source, industry, and account manager, returning the real industry relation", async () => {
    const industry = await prisma.industry.create({ data: { slug: "clients-test-industry", name: "Clients Test Industry" } });

    const created = await request(app)
      .post("/api/v1/clients")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ clientCode: "PROFILE-01", name: "Profile Fields Co", source: "referral", industryId: industry.id });
    expect(created.status).toBe(201);
    const clientId = created.body.data.client.id;

    const get = await request(app).get(`/api/v1/clients/${clientId}`).set("Authorization", `Bearer ${adminToken}`);
    expect(get.body.data.client.source).toBe("referral");
    expect(get.body.data.client.industry).toMatchObject({ id: industry.id, name: "Clients Test Industry" });

    const otherIndustry = await prisma.industry.create({ data: { slug: "clients-test-industry-2", name: "Second Industry" } });
    const updated = await request(app)
      .patch(`/api/v1/clients/${clientId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ source: "converted_lead", industryId: otherIndustry.id });
    expect(updated.status).toBe(200);
    expect(updated.body.data.client.source).toBe("converted_lead");
    expect(updated.body.data.client.industryId).toBe(otherIndustry.id);
  });

  it("rejects a client create/update with an unknown industryId (400, not a raw FK error)", async () => {
    const created = await request(app)
      .post("/api/v1/clients")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ clientCode: "BAD-INDUSTRY-CLIENT-01", name: "Bad Industry Client Co", industryId: "00000000-0000-0000-0000-000000000000" });
    expect(created.status).toBe(400);

    const existing = await request(app)
      .post("/api/v1/clients")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ clientCode: "BAD-INDUSTRY-CLIENT-02", name: "Bad Industry Client Co 2" });
    const updated = await request(app)
      .patch(`/api/v1/clients/${existing.body.data.client.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ industryId: "00000000-0000-0000-0000-000000000000" });
    expect(updated.status).toBe(400);
  });

  it("rejects a duplicate clientCode and a duplicate name within the same organization", async () => {
    const dupCode = await request(app)
      .post("/api/v1/clients")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ clientCode: "ACME-01", name: "A Different Name" });
    expect(dupCode.status).toBe(409);

    const dupName = await request(app)
      .post("/api/v1/clients")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ clientCode: "ACME-02", name: "acme corporation" }); // case-insensitive match
    expect(dupName.status).toBe(409);
  });

  it("two DIFFERENT organizations may use the same client name — tenant-scoped duplicate check only", async () => {
    const other = await request(app).post("/api/v1/auth/register").send({
      email: "clients-other-org@example.com",
      password: "OriginalPassword123",
      firstName: "Other",
      lastName: "Org",
      organizationName: "Other Clients Co",
    });
    const res = await request(app)
      .post("/api/v1/clients")
      .set("Authorization", `Bearer ${other.body.data.session.token}`)
      .send({ clientCode: "ACME-01", name: "Acme Corporation" }); // same code+name as orgId's client, different org
    expect(res.status).toBe(201);
  });

  it("updates status and profile fields", async () => {
    const created = await request(app)
      .post("/api/v1/clients")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ clientCode: "UPD-01", name: "Update Target Co" });
    const id = created.body.data.client.id;

    const res = await request(app)
      .patch(`/api/v1/clients/${id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "ACTIVE", phone: "555-0199" });
    expect(res.status).toBe(200);
    expect(res.body.data.client.status).toBe("ACTIVE");
    expect(res.body.data.client.phone).toBe("555-0199");
  });

  it("archives (soft-deletes) a client — historical FKs are preserved, row is not physically removed", async () => {
    const created = await request(app)
      .post("/api/v1/clients")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ clientCode: "ARC-01", name: "Archive Target Co" });
    const id = created.body.data.client.id;

    const del = await request(app).delete(`/api/v1/clients/${id}`).set("Authorization", `Bearer ${adminToken}`);
    expect(del.status).toBe(200);

    const get = await request(app).get(`/api/v1/clients/${id}`).set("Authorization", `Bearer ${adminToken}`);
    expect(get.status).toBe(404);

    const row = await prisma.client.findUnique({ where: { id } });
    expect(row).not.toBeNull();
    expect(row?.deletedAt).not.toBeNull();
  });

  it("search and pagination work server-side", async () => {
    for (let i = 0; i < 3; i++) {
      await request(app)
        .post("/api/v1/clients")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ clientCode: `SRCH-${i}`, name: `Searchable Client ${i}` });
    }
    const res = await request(app)
      .get("/api/v1/clients")
      .query({ search: "Searchable Client", limit: 2 })
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.clients.length).toBeLessThanOrEqual(2);
    expect(res.body.meta.pagination.total).toBeGreaterThanOrEqual(3);
  });

  it("IDOR: a user in another organization cannot read/update/delete a client by guessing its id", async () => {
    const created = await request(app)
      .post("/api/v1/clients")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ clientCode: "IDOR-01", name: "IDOR Target Co" });
    const clientId = created.body.data.client.id;

    const other = await request(app).post("/api/v1/auth/register").send({
      email: "clients-idor-other@example.com",
      password: "OriginalPassword123",
      firstName: "I",
      lastName: "O",
      organizationName: "IDOR Other Co",
    });
    const otherToken = other.body.data.session.token;

    const getRes = await request(app).get(`/api/v1/clients/${clientId}`).set("Authorization", `Bearer ${otherToken}`);
    expect(getRes.status).toBe(404);

    const patchRes = await request(app)
      .patch(`/api/v1/clients/${clientId}`)
      .set("Authorization", `Bearer ${otherToken}`)
      .send({ notes: "hijacked" });
    expect(patchRes.status).toBe(404);

    const delRes = await request(app).delete(`/api/v1/clients/${clientId}`).set("Authorization", `Bearer ${otherToken}`);
    expect(delRes.status).toBe(404);
  });

  it("exposes a real activity timeline via GET /clients/:id/activity, scoped to the caller's organization", async () => {
    const created = await request(app)
      .post("/api/v1/clients")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ clientCode: "ACTIVITY-01", name: "Activity Client Co" });
    const clientId = created.body.data.client.id;
    await request(app).patch(`/api/v1/clients/${clientId}`).set("Authorization", `Bearer ${adminToken}`).send({ notes: "Updated." });

    const activity = await request(app).get(`/api/v1/clients/${clientId}/activity`).set("Authorization", `Bearer ${adminToken}`);
    expect(activity.status).toBe(200);
    const actions = activity.body.data.activity.map((a: { action: string }) => a.action);
    expect(actions).toContain("CLIENT_CREATED");
    expect(actions).toContain("CLIENT_UPDATED");

    const other = await request(app).post("/api/v1/auth/register").send({
      email: "clients-activity-other@example.com",
      password: "OriginalPassword123",
      firstName: "A",
      lastName: "O",
      organizationName: "Activity Other Co",
    });
    const crossOrg = await request(app).get(`/api/v1/clients/${clientId}/activity`).set("Authorization", `Bearer ${other.body.data.session.token}`);
    expect(crossOrg.status).toBe(404);
  });
});
