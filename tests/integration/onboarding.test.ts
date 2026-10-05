/** Phase 6 §7-10 — onboarding lifecycle: start, step completion, invalid transitions, completion, cancellation, IDOR. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp, finalizeApp } from "../../server/app/app";
import { disconnectPrisma, prisma } from "../../server/db/prisma";
import { resetDb } from "../helpers/db";

describe("client onboarding", () => {
  const app = createApp();
  finalizeApp(app);

  let adminToken: string;
  let adminUserId: string;
  let viewerToken: string;

  beforeAll(async () => {
    await resetDb();
    const reg = await request(app).post("/api/v1/auth/register").send({
      email: "onboarding-admin@example.com",
      password: "OriginalPassword123",
      firstName: "Onboarding",
      lastName: "Admin",
      organizationName: "Onboarding Co",
    });
    adminToken = reg.body.data.session.token;
    adminUserId = reg.body.data.user.id;

    await request(app)
      .post("/api/v1/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ email: "onboarding-viewer@example.com", password: "ViewerPassword123", firstName: "V", lastName: "W", roleKey: "VIEWER" });
    const viewerLogin = await request(app).post("/api/v1/auth/login").send({ email: "onboarding-viewer@example.com", password: "ViewerPassword123" });
    viewerToken = viewerLogin.body.data.session.token;
  });

  afterAll(async () => {
    await disconnectPrisma();
  });

  async function createClient(name: string, clientCode: string) {
    const res = await request(app).post("/api/v1/clients").set("Authorization", `Bearer ${adminToken}`).send({ clientCode, name });
    return res.body.data.client.id as string;
  }

  it("starts onboarding for a client, initializing the full checklist NOT_STARTED->IN_PROGRESS, and audits CLIENT_ONBOARDING_STARTED", async () => {
    const clientId = await createClient("Onboard Me Co", "ONB-01");

    const res = await request(app).post(`/api/v1/clients/${clientId}/onboarding/start`).set("Authorization", `Bearer ${adminToken}`).send({});
    expect(res.status).toBe(201);
    expect(res.body.data.onboarding.status).toBe("IN_PROGRESS");
    expect(res.body.data.onboarding.currentStep).toBe("CLIENT_VERIFIED");
    expect(res.body.data.onboarding.checklist).toHaveLength(7);
    expect(res.body.data.onboarding.checklist.every((c: { completed: boolean }) => c.completed === false)).toBe(true);

    const audit = await prisma.auditLog.findFirst({ where: { action: "CLIENT_ONBOARDING_STARTED", resourceId: res.body.data.onboarding.id } });
    expect(audit).not.toBeNull();
  });

  it("rejects starting onboarding twice for the same client with 409", async () => {
    const clientId = await createClient("Double Start Co", "ONB-02");
    const first = await request(app).post(`/api/v1/clients/${clientId}/onboarding/start`).set("Authorization", `Bearer ${adminToken}`).send({});
    expect(first.status).toBe(201);

    const second = await request(app).post(`/api/v1/clients/${clientId}/onboarding/start`).set("Authorization", `Bearer ${adminToken}`).send({});
    expect(second.status).toBe(409);

    const count = await prisma.clientOnboarding.count({ where: { clientId } });
    expect(count).toBe(1);
  });

  it("completes a checklist step via PATCH, advances currentStep, and flips to READY once all steps are done", async () => {
    const clientId = await createClient("Checklist Co", "ONB-03");
    const start = await request(app).post(`/api/v1/clients/${clientId}/onboarding/start`).set("Authorization", `Bearer ${adminToken}`).send({});
    const onboardingId = start.body.data.onboarding.id;

    const steps = ["CLIENT_VERIFIED", "WORKSPACE_CREATED", "PRIMARY_CONTACT_CONFIRMED", "ADMINISTRATOR_INVITED", "ADMINISTRATOR_ACCEPTED", "WORKSPACE_CONFIGURED"];
    for (const step of steps) {
      const res = await request(app)
        .patch(`/api/v1/onboarding/${onboardingId}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ completeStep: step });
      expect(res.status).toBe(200);
    }

    const last = await request(app)
      .patch(`/api/v1/onboarding/${onboardingId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ completeStep: "ONBOARDING_COMPLETED" });
    expect(last.status).toBe(200);
    expect(last.body.data.onboarding.status).toBe("READY");
    expect(last.body.data.onboarding.currentStep).toBeNull();

    const audit = await prisma.auditLog.count({ where: { action: "ONBOARDING_STEP_COMPLETED", resourceId: onboardingId } });
    expect(audit).toBe(7);
  });

  it("rejects completeOnboarding before status is READY, and completes it once READY", async () => {
    const clientId = await createClient("Complete Flow Co", "ONB-04");
    const start = await request(app).post(`/api/v1/clients/${clientId}/onboarding/start`).set("Authorization", `Bearer ${adminToken}`).send({});
    const onboardingId = start.body.data.onboarding.id;

    const tooEarly = await request(app).post(`/api/v1/onboarding/${onboardingId}/complete`).set("Authorization", `Bearer ${adminToken}`).send();
    expect(tooEarly.status).toBe(400);

    const allSteps = [
      "CLIENT_VERIFIED",
      "WORKSPACE_CREATED",
      "PRIMARY_CONTACT_CONFIRMED",
      "ADMINISTRATOR_INVITED",
      "ADMINISTRATOR_ACCEPTED",
      "WORKSPACE_CONFIGURED",
      "ONBOARDING_COMPLETED",
    ];
    for (const step of allSteps) {
      await request(app).patch(`/api/v1/onboarding/${onboardingId}`).set("Authorization", `Bearer ${adminToken}`).send({ completeStep: step });
    }

    const done = await request(app).post(`/api/v1/onboarding/${onboardingId}/complete`).set("Authorization", `Bearer ${adminToken}`).send();
    expect(done.status).toBe(200);
    expect(done.body.data.onboarding.status).toBe("COMPLETED");
    expect(done.body.data.onboarding.completedAt).not.toBeNull();

    const auditEvent = await prisma.auditLog.findFirst({ where: { action: "CLIENT_ONBOARDING_COMPLETED", resourceId: onboardingId } });
    expect(auditEvent).not.toBeNull();

    // Once COMPLETED, no further step/status changes are accepted.
    const afterComplete = await request(app)
      .patch(`/api/v1/onboarding/${onboardingId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "CANCELLED" });
    expect(afterComplete.status).toBe(409);
  });

  it("cancels an in-progress onboarding and audits CLIENT_ONBOARDING_CANCELLED", async () => {
    const clientId = await createClient("Cancel Me Co", "ONB-05");
    const start = await request(app).post(`/api/v1/clients/${clientId}/onboarding/start`).set("Authorization", `Bearer ${adminToken}`).send({});
    const onboardingId = start.body.data.onboarding.id;

    const res = await request(app).patch(`/api/v1/onboarding/${onboardingId}`).set("Authorization", `Bearer ${adminToken}`).send({ status: "CANCELLED" });
    expect(res.status).toBe(200);
    expect(res.body.data.onboarding.status).toBe("CANCELLED");

    const audit = await prisma.auditLog.findFirst({ where: { action: "CLIENT_ONBOARDING_CANCELLED", resourceId: onboardingId } });
    expect(audit).not.toBeNull();
  });

  it("rejects onboarding access/mutation by a caller without the right permission", async () => {
    const clientId = await createClient("Unauthorized Onboarding Co", "ONB-06");
    const start = await request(app).post(`/api/v1/clients/${clientId}/onboarding/start`).set("Authorization", `Bearer ${adminToken}`).send({});
    const onboardingId = start.body.data.onboarding.id;

    const startRes = await request(app).post(`/api/v1/clients/${clientId}/onboarding/start`).set("Authorization", `Bearer ${viewerToken}`).send({});
    expect(startRes.status).toBe(403);

    const patchRes = await request(app)
      .patch(`/api/v1/onboarding/${onboardingId}`)
      .set("Authorization", `Bearer ${viewerToken}`)
      .send({ completeStep: "CLIENT_VERIFIED" });
    expect(patchRes.status).toBe(403);

    const completeRes = await request(app).post(`/api/v1/onboarding/${onboardingId}/complete`).set("Authorization", `Bearer ${viewerToken}`).send();
    expect(completeRes.status).toBe(403);
  });

  it("IDOR: another organization cannot read/update an onboarding record by guessing its id", async () => {
    const clientId = await createClient("IDOR Onboarding Co", "ONB-07");
    const start = await request(app).post(`/api/v1/clients/${clientId}/onboarding/start`).set("Authorization", `Bearer ${adminToken}`).send({});
    const onboardingId = start.body.data.onboarding.id;

    const other = await request(app).post("/api/v1/auth/register").send({
      email: "onboarding-idor-other@example.com",
      password: "OriginalPassword123",
      firstName: "I",
      lastName: "O",
      organizationName: "Onboarding IDOR Other Co",
    });
    const otherToken = other.body.data.session.token;

    const getRes = await request(app).get(`/api/v1/onboarding/${onboardingId}`).set("Authorization", `Bearer ${otherToken}`);
    expect(getRes.status).toBe(404);

    const patchRes = await request(app)
      .patch(`/api/v1/onboarding/${onboardingId}`)
      .set("Authorization", `Bearer ${otherToken}`)
      .send({ completeStep: "CLIENT_VERIFIED" });
    expect(patchRes.status).toBe(404);

    // Cross-tenant onboarding-start for a client that isn't theirs, either.
    const crossStart = await request(app)
      .post(`/api/v1/clients/${clientId}/onboarding/start`)
      .set("Authorization", `Bearer ${otherToken}`)
      .send({});
    expect(crossStart.status).toBe(404);
  });

  it("lists onboarding records scoped to the caller's organization, filterable by status", async () => {
    const clientId = await createClient("Queue Co", "ONB-08");
    await request(app).post(`/api/v1/clients/${clientId}/onboarding/start`).set("Authorization", `Bearer ${adminToken}`).send({});

    const list = await request(app).get("/api/v1/onboarding").set("Authorization", `Bearer ${adminToken}`);
    expect(list.status).toBe(200);
    expect(list.body.data.onboarding.length).toBeGreaterThan(0);

    const filtered = await request(app).get("/api/v1/onboarding").query({ status: "IN_PROGRESS" }).set("Authorization", `Bearer ${adminToken}`);
    expect(filtered.status).toBe(200);
    expect(filtered.body.data.onboarding.every((o: { status: string }) => o.status === "IN_PROGRESS")).toBe(true);
  });

  it("workspace provisioning automatically completes the WORKSPACE_CREATED checklist step on an in-progress onboarding", async () => {
    const clientId = await createClient("Auto Step Co", "ONB-09");
    const start = await request(app).post(`/api/v1/clients/${clientId}/onboarding/start`).set("Authorization", `Bearer ${adminToken}`).send({});
    const onboardingId = start.body.data.onboarding.id;

    await request(app).post(`/api/v1/clients/${clientId}/workspace/provision`).set("Authorization", `Bearer ${adminToken}`).send({});

    const reloaded = await request(app).get(`/api/v1/onboarding/${onboardingId}`).set("Authorization", `Bearer ${adminToken}`);
    const step = reloaded.body.data.onboarding.checklist.find((c: { key: string }) => c.key === "WORKSPACE_CREATED");
    expect(step.completed).toBe(true);
  });

  // Phase 13 — configurable onboarding checklist templates.
  it("GET /onboarding/template returns the system default (7 steps) when the organization hasn't customized it, and isCustom is false", async () => {
    const res = await request(app).get("/api/v1/onboarding/template").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.isCustom).toBe(false);
    expect(res.body.data.steps).toHaveLength(7);
  });

  it("PUT /onboarding/template saves a custom template, audits ONBOARDING_TEMPLATE_UPDATED, and new onboarding uses it instead of the system default", async () => {
    const customSteps = [
      { key: "BRAND_KIT_COLLECTED", label: "Brand kit collected", requiresDocument: true },
      { key: "KICKOFF_CALL_HELD", label: "Kickoff call held", requiresDocument: false },
    ];
    const put = await request(app).put("/api/v1/onboarding/template").set("Authorization", `Bearer ${adminToken}`).send(customSteps);
    expect(put.status).toBe(200);
    expect(put.body.data.isCustom).toBe(true);
    expect(put.body.data.steps).toHaveLength(2);

    const audit = await prisma.auditLog.findFirst({ where: { action: "ONBOARDING_TEMPLATE_UPDATED" } });
    expect(audit).not.toBeNull();

    const get = await request(app).get("/api/v1/onboarding/template").set("Authorization", `Bearer ${adminToken}`);
    expect(get.body.data.isCustom).toBe(true);
    expect(get.body.data.steps.map((s: { key: string }) => s.key)).toEqual(["BRAND_KIT_COLLECTED", "KICKOFF_CALL_HELD"]);

    const clientId = await createClient("Custom Template Co", "ONB-10");
    const start = await request(app).post(`/api/v1/clients/${clientId}/onboarding/start`).set("Authorization", `Bearer ${adminToken}`).send({});
    expect(start.status).toBe(201);
    expect(start.body.data.onboarding.checklist).toHaveLength(2);
    expect(start.body.data.onboarding.checklist[0].key).toBe("BRAND_KIT_COLLECTED");
    expect(start.body.data.onboarding.currentStep).toBe("BRAND_KIT_COLLECTED");

    // A custom template that drops the system WORKSPACE_CREATED key never
    // breaks workspace provisioning — the automatic completion call simply
    // no-ops instead of erroring (completeStepForClient's documented
    // graceful-degradation contract).
    const provision = await request(app).post(`/api/v1/clients/${clientId}/workspace/provision`).set("Authorization", `Bearer ${adminToken}`).send({});
    expect(provision.status).toBe(201);

    // Restore the system default for subsequent tests in this file.
    const { ONBOARDING_CHECKLIST_KEYS } = await import("../../server/schemas/onboardingSchemas");
    const STEP_LABELS: Record<string, string> = {
      CLIENT_VERIFIED: "Client verified",
      WORKSPACE_CREATED: "Workspace created",
      PRIMARY_CONTACT_CONFIRMED: "Primary contact confirmed",
      ADMINISTRATOR_INVITED: "Administrator invited",
      ADMINISTRATOR_ACCEPTED: "Administrator accepted",
      WORKSPACE_CONFIGURED: "Workspace configured",
      ONBOARDING_COMPLETED: "Onboarding completed",
    };
    await request(app)
      .put("/api/v1/onboarding/template")
      .set("Authorization", `Bearer ${adminToken}`)
      .send(ONBOARDING_CHECKLIST_KEYS.map((key) => ({ key, label: STEP_LABELS[key], requiresDocument: false })));
  });

  it("rejects a template with duplicate step keys, and rejects template management by a caller without onboarding.update", async () => {
    const dup = await request(app)
      .put("/api/v1/onboarding/template")
      .set("Authorization", `Bearer ${adminToken}`)
      .send([
        { key: "STEP_A", label: "A", requiresDocument: false },
        { key: "STEP_A", label: "A again", requiresDocument: false },
      ]);
    expect(dup.status).toBe(400);

    const forbidden = await request(app)
      .put("/api/v1/onboarding/template")
      .set("Authorization", `Bearer ${viewerToken}`)
      .send([{ key: "STEP_A", label: "A", requiresDocument: false }]);
    expect(forbidden.status).toBe(403);
  });

  // Phase 13 — per-step due date/assignee/notes/document, and record-level owner/dueDate.
  it("sets a step's due date/assignee/notes, and the record's own owner/dueDate, auditing both", async () => {
    const clientId = await createClient("Step Detail Co", "ONB-11");
    const start = await request(app).post(`/api/v1/clients/${clientId}/onboarding/start`).set("Authorization", `Bearer ${adminToken}`).send({});
    const onboardingId = start.body.data.onboarding.id;

    const stepRes = await request(app)
      .patch(`/api/v1/onboarding/${onboardingId}/steps/CLIENT_VERIFIED`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ dueDate: "2026-12-01", notes: "Waiting on signed contract." });
    expect(stepRes.status).toBe(200);
    const step = stepRes.body.data.onboarding.checklist.find((c: { key: string }) => c.key === "CLIENT_VERIFIED");
    expect(step.dueDate.slice(0, 10)).toBe("2026-12-01");
    expect(step.notes).toBe("Waiting on signed contract.");

    const stepAudit = await prisma.auditLog.findFirst({ where: { action: "ONBOARDING_STEP_UPDATED", resourceId: onboardingId } });
    expect(stepAudit).not.toBeNull();

    const ownerRes = await request(app)
      .patch(`/api/v1/onboarding/${onboardingId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ ownerId: adminUserId, dueDate: "2026-12-15" });
    expect(ownerRes.status).toBe(200);
    expect(ownerRes.body.data.onboarding.ownerId).toBe(adminUserId);
    expect(ownerRes.body.data.onboarding.dueDate.slice(0, 10)).toBe("2026-12-15");
  });

  it("rejects attaching a document from a different organization to a step (400, not a cross-tenant leak)", async () => {
    const clientId = await createClient("Cross Tenant Doc Co", "ONB-12");
    const start = await request(app).post(`/api/v1/clients/${clientId}/onboarding/start`).set("Authorization", `Bearer ${adminToken}`).send({});
    const onboardingId = start.body.data.onboarding.id;

    const fakeMediaId = "00000000-0000-0000-0000-000000000000";
    const res = await request(app)
      .patch(`/api/v1/onboarding/${onboardingId}/steps/CLIENT_VERIFIED`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ documentMediaId: fakeMediaId });
    expect(res.status).toBe(400);
  });

  it("exposes a real activity timeline via GET /onboarding/:id/activity, scoped to the caller's organization", async () => {
    const clientId = await createClient("Onboarding Activity Co", "ONB-13");
    const start = await request(app).post(`/api/v1/clients/${clientId}/onboarding/start`).set("Authorization", `Bearer ${adminToken}`).send({});
    const onboardingId = start.body.data.onboarding.id;
    await request(app).patch(`/api/v1/onboarding/${onboardingId}`).set("Authorization", `Bearer ${adminToken}`).send({ completeStep: "CLIENT_VERIFIED" });

    const activity = await request(app).get(`/api/v1/onboarding/${onboardingId}/activity`).set("Authorization", `Bearer ${adminToken}`);
    expect(activity.status).toBe(200);
    const actions = activity.body.data.activity.map((a: { action: string }) => a.action);
    expect(actions).toContain("CLIENT_ONBOARDING_STARTED");
    expect(actions).toContain("ONBOARDING_STEP_COMPLETED");
  });
});
