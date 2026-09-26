/**
 * Phase 13: Autonomous AI Workflows & Business Automation (imported from
 * usmanclaude92-creator/Artify-Backend---Google-AI-Studio-, commit
 * 4a1d7cd). Exercises the adaptation points made during import: the
 * `Lead.assignedTo`/`Client.accountManager` field-name fixes in
 * ActionRegistry's `assign_user` action, permission-gated routes, human
 * approval → resume flow, and cross-tenant isolation.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp, finalizeApp } from "../../server/app/app";
import { disconnectPrisma } from "../../server/db/prisma";
import { resetDb } from "../helpers/db";

describe("Automation workflows, actions, approvals", () => {
  const app = createApp();
  finalizeApp(app);

  let adminToken: string;
  let otherOrgAdminToken: string;
  let leadId: string;
  let assigneeUserId: string;

  beforeAll(async () => {
    await resetDb();

    const reg = await request(app).post("/api/v1/auth/register").send({
      email: "automation-admin@example.com",
      password: "OriginalPassword123",
      firstName: "Auto",
      lastName: "Admin",
      organizationName: "Automation Co",
    });
    adminToken = reg.body.data.session.token;

    const otherReg = await request(app).post("/api/v1/auth/register").send({
      email: "automation-other-admin@example.com",
      password: "OriginalPassword123",
      firstName: "Other",
      lastName: "Admin",
      organizationName: "Other Automation Co",
    });
    otherOrgAdminToken = otherReg.body.data.session.token;

    const assigneeRes = await request(app)
      .post("/api/v1/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ email: "automation-assignee@example.com", password: "UserPassword123", firstName: "As", lastName: "Signee", roleKey: "USER" });
    assigneeUserId = assigneeRes.body.data.user.id;

    const leadRes = await request(app)
      .post("/api/v1/leads")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ companyName: "Lead Target Co", contactName: "Lead Target", email: "lead-target@example.com", source: "WEBSITE" });
    leadId = leadRes.body.data.lead.id;
  });

  afterAll(async () => {
    await disconnectPrisma();
  });

  it("rejects workflow creation without automation.create permission", async () => {
    const viewerRes = await request(app)
      .post("/api/v1/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ email: "automation-viewer@example.com", password: "UserPassword123", firstName: "V", lastName: "Wr", roleKey: "VIEWER" });
    expect(viewerRes.status).toBe(201);
    const viewerToken = (
      await request(app).post("/api/v1/auth/login").send({ email: "automation-viewer@example.com", password: "UserPassword123" })
    ).body.data.session.token;

    const res = await request(app)
      .post("/api/v1/automation/workflows")
      .set("Authorization", `Bearer ${viewerToken}`)
      .send({ name: "Viewer Attempt", triggerType: "MANUAL" });

    expect(res.status).toBe(403);
  });

  it("creates, publishes, and executes a workflow whose BUSINESS_ACTION step assigns a real lead", async () => {
    const createRes = await request(app)
      .post("/api/v1/automation/workflows")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        name: "Lead Assignment Workflow",
        triggerType: "MANUAL",
        steps: [
          {
            id: "assign_step",
            name: "Assign Lead to Rep",
            type: "BUSINESS_ACTION",
            actionId: "assign_user",
            parameters: { entityType: "LEAD", entityId: leadId, userId: assigneeUserId },
          },
        ],
      });
    expect(createRes.status).toBe(201);
    const workflowId = createRes.body.data.workflow.id;

    const publishRes = await request(app)
      .post(`/api/v1/automation/workflows/${workflowId}/publish`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({});
    expect(publishRes.status).toBe(200);
    expect(publishRes.body.data.workflow.status).toBe("ACTIVE");

    const triggerRes = await request(app)
      .post(`/api/v1/automation/workflows/${workflowId}/trigger`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({});
    expect(triggerRes.status).toBe(202);
    const executionId = triggerRes.body.data.executionId;

    // Poll briefly for the async background execution to complete.
    let execution: { status: string } = { status: "QUEUED" };
    for (let i = 0; i < 20; i++) {
      const execRes = await request(app)
        .get(`/api/v1/automation/executions/${executionId}`)
        .set("Authorization", `Bearer ${adminToken}`);
      execution = execRes.body.data.execution;
      if (execution.status === "COMPLETED" || execution.status === "FAILED") break;
      await new Promise((r) => setTimeout(r, 150));
    }

    expect(execution.status).toBe("COMPLETED");

    const leadRes = await request(app)
      .get(`/api/v1/leads/${leadId}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(leadRes.body.data.lead.assignedTo).toBe(assigneeUserId);
  });

  it("enforces tenant isolation on workflows and executions", async () => {
    const listRes = await request(app)
      .get("/api/v1/automation/workflows")
      .set("Authorization", `Bearer ${otherOrgAdminToken}`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.data.rows).toHaveLength(0);
  });

  it("runs the approval engine's request -> decide -> resume flow", async () => {
    const createRes = await request(app)
      .post("/api/v1/automation/workflows")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        name: "Approval Gated Workflow",
        triggerType: "MANUAL",
        steps: [
          {
            id: "approval_step",
            name: "Require Human Sign-off",
            type: "APPROVAL",
            actionDescription: "Confirm this is safe to proceed.",
          },
        ],
      });
    const workflowId = createRes.body.data.workflow.id;

    await request(app)
      .post(`/api/v1/automation/workflows/${workflowId}/publish`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({});

    const triggerRes = await request(app)
      .post(`/api/v1/automation/workflows/${workflowId}/trigger`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({});
    const executionId = triggerRes.body.data.executionId;

    let approvalId: string | undefined;
    for (let i = 0; i < 20; i++) {
      const approvalsRes = await request(app)
        .get("/api/v1/automation/approvals")
        .set("Authorization", `Bearer ${adminToken}`)
        .query({ status: "PENDING" });
      const match = approvalsRes.body.data.rows.find((a: { id: string; executionId: string }) => a.executionId === executionId);
      if (match) {
        approvalId = match.id;
        break;
      }
      await new Promise((r) => setTimeout(r, 150));
    }
    expect(approvalId).toBeDefined();

    const decideRes = await request(app)
      .post(`/api/v1/automation/approvals/${approvalId}/decide`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ decision: "APPROVED" });
    expect(decideRes.status).toBe(200);
    expect(decideRes.body.data.approval.status).toBe("APPROVED");
  });

  it("lists the registered business actions catalog", async () => {
    const res = await request(app)
      .get("/api/v1/automation/actions")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const ids = res.body.data.actions.map((a: { id: string }) => a.id);
    expect(ids).toContain("assign_user");
    expect(ids).toContain("create_task");
  });
});
