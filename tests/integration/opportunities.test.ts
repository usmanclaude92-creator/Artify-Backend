/** Phase 7 — CRM pipeline: opportunity CRUD, stage-transition guarding, win/lose, IDOR, permissions, CRM dashboard integration. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp, finalizeApp } from "../../server/app/app";
import { disconnectPrisma, prisma } from "../../server/db/prisma";
import { resetDb } from "../helpers/db";

describe("CRM opportunities", () => {
  const app = createApp();
  finalizeApp(app);

  let adminToken: string;
  let userToken: string;
  let viewerToken: string;
  let otherOrgAdminToken: string;
  let clientId: string;
  let leadId: string;
  let otherOrgClientId: string;

  beforeAll(async () => {
    await resetDb();
    const reg = await request(app).post("/api/v1/auth/register").send({
      email: "opp-admin@example.com",
      password: "OriginalPassword123",
      firstName: "Opp",
      lastName: "Admin",
      organizationName: "Opp Admin Co",
    });
    adminToken = reg.body.data.session.token;

    await request(app)
      .post("/api/v1/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ email: "opp-user@example.com", password: "MemberPassword123", firstName: "U", lastName: "W", roleKey: "USER" });
    userToken = (await request(app).post("/api/v1/auth/login").send({ email: "opp-user@example.com", password: "MemberPassword123" })).body.data.session
      .token;

    await request(app)
      .post("/api/v1/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ email: "opp-viewer@example.com", password: "ViewerPassword123", firstName: "V", lastName: "W", roleKey: "VIEWER" });
    viewerToken = (await request(app).post("/api/v1/auth/login").send({ email: "opp-viewer@example.com", password: "ViewerPassword123" })).body.data
      .session.token;

    const otherOrg = await request(app).post("/api/v1/auth/register").send({
      email: "opp-other-admin@example.com",
      password: "OriginalPassword123",
      firstName: "Other",
      lastName: "Admin",
      organizationName: "Other Opp Org",
    });
    otherOrgAdminToken = otherOrg.body.data.session.token;

    const client = await request(app)
      .post("/api/v1/clients")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ clientCode: "OPP-CLIENT", name: "Opportunity Test Client" });
    clientId = client.body.data.client.id;

    const lead = await request(app)
      .post("/api/v1/leads")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ companyName: "Origin Lead Co" });
    leadId = lead.body.data.lead.id;

    const otherClient = await request(app)
      .post("/api/v1/clients")
      .set("Authorization", `Bearer ${otherOrgAdminToken}`)
      .send({ clientCode: "OTHER-CLIENT", name: "Other Org Client" });
    otherOrgClientId = otherClient.body.data.client.id;
  });

  afterAll(async () => {
    await disconnectPrisma();
  });

  it("creates an opportunity against a client, with an optional lead, and audits OPPORTUNITY_CREATED", async () => {
    const res = await request(app)
      .post("/api/v1/opportunities")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ clientId, leadId, name: "Platform Renewal Q3", value: 15000, expectedCloseDate: "2026-09-30" });
    expect(res.status).toBe(201);
    expect(res.body.data.opportunity.stage).toBe("PROSPECTING");
    expect(res.body.data.opportunity.value).toBe("15000");
    expect(res.body.data.opportunity.currency).toBe("OMR");
    expect(res.body.data.opportunity.client.id).toBe(clientId);
    expect(res.body.data.opportunity.lead.id).toBe(leadId);

    const audit = await prisma.auditLog.findFirst({ where: { action: "OPPORTUNITY_CREATED", resourceId: res.body.data.opportunity.id } });
    expect(audit).not.toBeNull();
  });

  it("rejects a clientId/leadId that belongs to a different organization (IDOR-safe FK validation)", async () => {
    const badClient = await request(app)
      .post("/api/v1/opportunities")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ clientId: otherOrgClientId, name: "Cross-tenant attempt", value: 100 });
    expect(badClient.status).toBe(400);

    const badLead = await request(app)
      .post("/api/v1/opportunities")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ clientId, leadId: otherOrgClientId, name: "Cross-tenant lead attempt", value: 100 });
    expect(badLead.status).toBe(400);
  });

  it("moves freely between non-terminal stages via PATCH, but rejects setting a closed stage directly", async () => {
    const created = await request(app).post("/api/v1/opportunities").set("Authorization", `Bearer ${adminToken}`).send({ clientId, name: "Stage Move", value: 500 });
    const id = created.body.data.opportunity.id;

    const toProposal = await request(app).patch(`/api/v1/opportunities/${id}`).set("Authorization", `Bearer ${adminToken}`).send({ stage: "PROPOSAL" });
    expect(toProposal.status).toBe(200);
    expect(toProposal.body.data.opportunity.stage).toBe("PROPOSAL");

    const directWin = await request(app).patch(`/api/v1/opportunities/${id}`).set("Authorization", `Bearer ${adminToken}`).send({ stage: "CLOSED_WON" });
    expect(directWin.status).toBe(400);
  });

  it("wins an opportunity via the dedicated endpoint, sets actualCloseDate, and blocks further edits", async () => {
    const created = await request(app).post("/api/v1/opportunities").set("Authorization", `Bearer ${adminToken}`).send({ clientId, name: "Winnable Deal", value: 2000 });
    const id = created.body.data.opportunity.id;

    const won = await request(app).post(`/api/v1/opportunities/${id}/win`).set("Authorization", `Bearer ${adminToken}`).send();
    expect(won.status).toBe(200);
    expect(won.body.data.opportunity.stage).toBe("CLOSED_WON");
    expect(won.body.data.opportunity.actualCloseDate).not.toBeNull();

    const editAttempt = await request(app).patch(`/api/v1/opportunities/${id}`).set("Authorization", `Bearer ${adminToken}`).send({ name: "Renamed" });
    expect(editAttempt.status).toBe(409);

    const reWin = await request(app).post(`/api/v1/opportunities/${id}/win`).set("Authorization", `Bearer ${adminToken}`).send();
    expect(reWin.status).toBe(409);

    const audit = await prisma.auditLog.findFirst({ where: { action: "OPPORTUNITY_WON", resourceId: id } });
    expect(audit).not.toBeNull();
  });

  it("loses an opportunity with a reason via the dedicated endpoint, and blocks re-closing", async () => {
    const created = await request(app).post("/api/v1/opportunities").set("Authorization", `Bearer ${adminToken}`).send({ clientId, name: "Losable Deal", value: 3000 });
    const id = created.body.data.opportunity.id;

    const lost = await request(app).post(`/api/v1/opportunities/${id}/lose`).set("Authorization", `Bearer ${adminToken}`).send({ lostReason: "Went with a competitor" });
    expect(lost.status).toBe(200);
    expect(lost.body.data.opportunity.stage).toBe("CLOSED_LOST");
    expect(lost.body.data.opportunity.lostReason).toBe("Went with a competitor");

    const reLose = await request(app).post(`/api/v1/opportunities/${id}/lose`).set("Authorization", `Bearer ${adminToken}`).send();
    expect(reLose.status).toBe(409);

    const audit = await prisma.auditLog.findFirst({ where: { action: "OPPORTUNITY_LOST", resourceId: id } });
    expect(audit).not.toBeNull();
  });

  it("USER can create/update but not close or delete; VIEWER is read-only; never leaks across organizations", async () => {
    const created = await request(app).post("/api/v1/opportunities").set("Authorization", `Bearer ${adminToken}`).send({ clientId, name: "Permission Probe", value: 100 });
    const id = created.body.data.opportunity.id;

    const userUpdate = await request(app).patch(`/api/v1/opportunities/${id}`).set("Authorization", `Bearer ${userToken}`).send({ name: "User Edited" });
    expect(userUpdate.status).toBe(200);

    const userClose = await request(app).post(`/api/v1/opportunities/${id}/win`).set("Authorization", `Bearer ${userToken}`).send();
    expect(userClose.status).toBe(403);

    const userDelete = await request(app).delete(`/api/v1/opportunities/${id}`).set("Authorization", `Bearer ${userToken}`);
    expect(userDelete.status).toBe(403);

    const viewerRead = await request(app).get(`/api/v1/opportunities/${id}`).set("Authorization", `Bearer ${viewerToken}`);
    expect(viewerRead.status).toBe(200);
    const viewerUpdate = await request(app).patch(`/api/v1/opportunities/${id}`).set("Authorization", `Bearer ${viewerToken}`).send({ name: "Nope" });
    expect(viewerUpdate.status).toBe(403);

    const crossOrgRead = await request(app).get(`/api/v1/opportunities/${id}`).set("Authorization", `Bearer ${otherOrgAdminToken}`);
    expect(crossOrgRead.status).toBe(404);
  });

  it("deletes (soft) an opportunity and audits it", async () => {
    const created = await request(app).post("/api/v1/opportunities").set("Authorization", `Bearer ${adminToken}`).send({ clientId, name: "Delete Me", value: 50 });
    const id = created.body.data.opportunity.id;

    const deleted = await request(app).delete(`/api/v1/opportunities/${id}`).set("Authorization", `Bearer ${adminToken}`);
    expect(deleted.status).toBe(200);

    const gone = await request(app).get(`/api/v1/opportunities/${id}`).set("Authorization", `Bearer ${adminToken}`);
    expect(gone.status).toBe(404);

    const audit = await prisma.auditLog.findFirst({ where: { action: "OPPORTUNITY_DELETED", resourceId: id } });
    expect(audit).not.toBeNull();
  });

  it("filters by stage and searches by name server-side", async () => {
    await request(app).post("/api/v1/opportunities").set("Authorization", `Bearer ${adminToken}`).send({ clientId, name: "Findable Pipeline Deal", value: 10 });

    const search = await request(app).get("/api/v1/opportunities").set("Authorization", `Bearer ${adminToken}`).query({ search: "Findable Pipeline" });
    expect(search.body.data.opportunities.length).toBeGreaterThanOrEqual(1);

    const staged = await request(app).get("/api/v1/opportunities").set("Authorization", `Bearer ${adminToken}`).query({ stage: "CLOSED_WON" });
    expect(staged.body.data.opportunities.every((o: { stage: string }) => o.stage === "CLOSED_WON")).toBe(true);
  });

  it("surfaces opportunity pipeline stats (open count/value, by-stage breakdown) on GET /crm/summary", async () => {
    const adminSummary = await request(app).get("/api/v1/crm/summary").set("Authorization", `Bearer ${adminToken}`);
    expect(adminSummary.status).toBe(200);
    expect(adminSummary.body.data.opportunities).not.toBeNull();
    expect(typeof adminSummary.body.data.opportunities.openValue).toBe("string");
    expect(adminSummary.body.data.opportunities.byStage).toBeDefined();
  });

  // Phase 12 — a deal may now be opened directly against a Lead, before it
  // has converted to a Client ("Lead -> Qualified Lead -> Opportunity ->
  // Client"). These cover the new lead-first pipeline shape end to end.
  it("opens a deal directly against a lead (no client yet), rejects a win attempt, then wins only after linking a client", async () => {
    const created = await request(app)
      .post("/api/v1/opportunities")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ leadId, name: "Lead-First Deal", value: 4000, source: "Outbound", probability: 60 });
    expect(created.status).toBe(201);
    expect(created.body.data.opportunity.clientId).toBeNull();
    expect(created.body.data.opportunity.leadId).toBe(leadId);
    expect(created.body.data.opportunity.source).toBe("Outbound");
    expect(created.body.data.opportunity.probability).toBe(60);
    const id = created.body.data.opportunity.id;

    const prematureWin = await request(app).post(`/api/v1/opportunities/${id}/win`).set("Authorization", `Bearer ${adminToken}`).send();
    expect(prematureWin.status).toBe(400);

    const link = await request(app)
      .post(`/api/v1/opportunities/${id}/link-client`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ clientId });
    expect(link.status).toBe(200);
    expect(link.body.data.opportunity.clientId).toBe(clientId);

    const relink = await request(app)
      .post(`/api/v1/opportunities/${id}/link-client`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ clientId });
    expect(relink.status).toBe(409);

    const won = await request(app).post(`/api/v1/opportunities/${id}/win`).set("Authorization", `Bearer ${adminToken}`).send();
    expect(won.status).toBe(200);
    expect(won.body.data.opportunity.stage).toBe("CLOSED_WON");

    const linkAudit = await prisma.auditLog.findFirst({ where: { action: "OPPORTUNITY_CLIENT_LINKED", resourceId: id } });
    expect(linkAudit).not.toBeNull();
  });

  it("rejects creating an opportunity with neither clientId nor leadId", async () => {
    const res = await request(app).post("/api/v1/opportunities").set("Authorization", `Bearer ${adminToken}`).send({ name: "Orphan Deal", value: 1 });
    expect(res.status).toBe(400);
  });

  it("exposes a real activity timeline via GET /opportunities/:id/activity, scoped to the caller's organization", async () => {
    const created = await request(app).post("/api/v1/opportunities").set("Authorization", `Bearer ${adminToken}`).send({ clientId, name: "Activity Deal", value: 777 });
    const id = created.body.data.opportunity.id;
    await request(app).post(`/api/v1/opportunities/${id}/win`).set("Authorization", `Bearer ${adminToken}`).send();

    const activity = await request(app).get(`/api/v1/opportunities/${id}/activity`).set("Authorization", `Bearer ${adminToken}`);
    expect(activity.status).toBe(200);
    const actions = activity.body.data.activity.map((a: { action: string }) => a.action);
    expect(actions).toContain("OPPORTUNITY_CREATED");
    expect(actions).toContain("OPPORTUNITY_WON");

    const crossOrg = await request(app).get(`/api/v1/opportunities/${id}/activity`).set("Authorization", `Bearer ${otherOrgAdminToken}`);
    expect(crossOrg.status).toBe(404);
  });
});
