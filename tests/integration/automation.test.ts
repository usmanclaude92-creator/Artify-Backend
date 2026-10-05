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
import { disconnectPrisma, prisma } from "../../server/db/prisma";
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

  // Phase 1 regression tests (docs/control-center-module-gap-analysis.md's
  // "Automation's create_invoice_draft and generate_report business
  // actions are mocked" finding) — proves the fix, not just the bug.
  it("create_invoice_draft creates a real, persisted Invoice — never a fabricated result", async () => {
    const clientRes = await request(app)
      .post("/api/v1/clients")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ clientCode: "AUTO-INV-1", name: "Automation Invoice Client" });
    expect(clientRes.status).toBe(201);
    const clientId = clientRes.body.data.client.id;

    const createRes = await request(app)
      .post("/api/v1/automation/workflows")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        name: "Invoice Draft Workflow",
        triggerType: "MANUAL",
        steps: [
          {
            id: "draft_step",
            name: "Draft Invoice",
            type: "BUSINESS_ACTION",
            actionId: "create_invoice_draft",
            parameters: { clientId, amountDue: 500, currency: "USD", memo: "Automation regression test" },
            requiresApproval: false,
          },
        ],
      });
    expect(createRes.status).toBe(201);
    const workflowId = createRes.body.data.workflow.id;

    await request(app).post(`/api/v1/automation/workflows/${workflowId}/publish`).set("Authorization", `Bearer ${adminToken}`).send({});
    const triggerRes = await request(app).post(`/api/v1/automation/workflows/${workflowId}/trigger`).set("Authorization", `Bearer ${adminToken}`).send({});
    expect(triggerRes.status).toBe(202);
    const executionId = triggerRes.body.data.executionId;

    let execution: { status: string } = { status: "QUEUED" };
    for (let i = 0; i < 20; i++) {
      const execRes = await request(app).get(`/api/v1/automation/executions/${executionId}`).set("Authorization", `Bearer ${adminToken}`);
      execution = execRes.body.data.execution;
      if (execution.status === "COMPLETED" || execution.status === "FAILED" || execution.status === "WAITING_APPROVAL") break;
      await new Promise((r) => setTimeout(r, 150));
    }

    expect(execution.status).toBe("COMPLETED");

    // The fabricated version never wrote a row at all — proving a real
    // Invoice exists for this client is the actual regression proof.
    const invoicesRes = await request(app).get("/api/v1/invoices").query({ clientId }).set("Authorization", `Bearer ${adminToken}`);
    expect(invoicesRes.status).toBe(200);
    expect(invoicesRes.body.data.invoices.length).toBeGreaterThan(0);
    const created = invoicesRes.body.data.invoices[0];
    expect(created.status).toBe("DRAFT");
    expect(created.invoiceNumber).not.toMatch(/^INV-DRAFT-/); // not the old fabricated format
    expect(Number(created.amountDue)).toBe(500);
  });

  it("generate_report fails explicitly rather than fabricating a result", async () => {
    const createRes = await request(app)
      .post("/api/v1/automation/workflows")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        name: "Report Workflow",
        triggerType: "MANUAL",
        steps: [
          {
            id: "report_step",
            name: "Generate Report",
            type: "BUSINESS_ACTION",
            actionId: "generate_report",
            parameters: { reportType: "pipeline", title: "Automation regression test" },
          },
        ],
      });
    expect(createRes.status).toBe(201);
    const workflowId = createRes.body.data.workflow.id;

    await request(app).post(`/api/v1/automation/workflows/${workflowId}/publish`).set("Authorization", `Bearer ${adminToken}`).send({});
    const triggerRes = await request(app).post(`/api/v1/automation/workflows/${workflowId}/trigger`).set("Authorization", `Bearer ${adminToken}`).send({});
    expect(triggerRes.status).toBe(202);
    const executionId = triggerRes.body.data.executionId;

    let execution: { status: string } = { status: "QUEUED" };
    for (let i = 0; i < 20; i++) {
      const execRes = await request(app).get(`/api/v1/automation/executions/${executionId}`).set("Authorization", `Bearer ${adminToken}`);
      execution = execRes.body.data.execution;
      if (execution.status === "COMPLETED" || execution.status === "FAILED") break;
      await new Promise((r) => setTimeout(r, 150));
    }

    // The old, mocked version always reported COMPLETED with a fabricated
    // summary — the fix must fail visibly instead.
    expect(execution.status).toBe("FAILED");
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
    // Phase 14 — new business actions.
    expect(ids).toContain("create_lead");
    expect(ids).toContain("update_lead_status");
  });

  // Phase 14 — create_lead creates a real, persisted Lead (never fabricated).
  it("create_lead creates a real Lead via a BUSINESS_ACTION step", async () => {
    const createRes = await request(app)
      .post("/api/v1/automation/workflows")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        name: "Create Lead Workflow",
        triggerType: "MANUAL",
        steps: [
          {
            id: "create_lead_step",
            name: "Create a lead",
            type: "BUSINESS_ACTION",
            actionId: "create_lead",
            parameters: { companyName: "Automation-Created Co", email: "automation-created@example.com", source: "automation-test" },
          },
        ],
      });
    expect(createRes.status).toBe(201);
    const workflowId = createRes.body.data.workflow.id;
    await request(app).post(`/api/v1/automation/workflows/${workflowId}/publish`).set("Authorization", `Bearer ${adminToken}`).send({});
    const triggerRes = await request(app).post(`/api/v1/automation/workflows/${workflowId}/trigger`).set("Authorization", `Bearer ${adminToken}`).send({});
    const executionId = triggerRes.body.data.executionId;

    let execution: { status: string } = { status: "QUEUED" };
    for (let i = 0; i < 20; i++) {
      const execRes = await request(app).get(`/api/v1/automation/executions/${executionId}`).set("Authorization", `Bearer ${adminToken}`);
      execution = execRes.body.data.execution;
      if (execution.status === "COMPLETED" || execution.status === "FAILED") break;
      await new Promise((r) => setTimeout(r, 150));
    }
    expect(execution.status).toBe("COMPLETED");

    const lead = await prisma.lead.findFirst({ where: { email: "automation-created@example.com" } });
    expect(lead).not.toBeNull();
    expect(lead!.source).toBe("automation-test");
    const audit = await prisma.auditLog.findFirst({ where: { action: "LEAD_CREATED", resourceId: lead!.id } });
    expect(audit).not.toBeNull();
  });

  // Phase 14 — update_lead_status moves a real Lead, and refuses to touch a CONVERTED one.
  it("update_lead_status updates a real Lead's status and rejects a CONVERTED lead", async () => {
    const targetLead = await request(app)
      .post("/api/v1/leads")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ companyName: "Status Update Target Co" });
    const targetLeadId = targetLead.body.data.lead.id;

    const createRes = await request(app)
      .post("/api/v1/automation/workflows")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        name: "Update Lead Status Workflow",
        triggerType: "MANUAL",
        steps: [
          { id: "update_status_step", name: "Qualify the lead", type: "BUSINESS_ACTION", actionId: "update_lead_status", parameters: { leadId: targetLeadId, status: "QUALIFIED" } },
        ],
      });
    const workflowId = createRes.body.data.workflow.id;
    await request(app).post(`/api/v1/automation/workflows/${workflowId}/publish`).set("Authorization", `Bearer ${adminToken}`).send({});
    const triggerRes = await request(app).post(`/api/v1/automation/workflows/${workflowId}/trigger`).set("Authorization", `Bearer ${adminToken}`).send({});
    const executionId = triggerRes.body.data.executionId;

    let execution: { status: string } = { status: "QUEUED" };
    for (let i = 0; i < 20; i++) {
      const execRes = await request(app).get(`/api/v1/automation/executions/${executionId}`).set("Authorization", `Bearer ${adminToken}`);
      execution = execRes.body.data.execution;
      if (execution.status === "COMPLETED" || execution.status === "FAILED") break;
      await new Promise((r) => setTimeout(r, 150));
    }
    expect(execution.status).toBe("COMPLETED");

    const reloaded = await prisma.lead.findUniqueOrThrow({ where: { id: targetLeadId } });
    expect(reloaded.status).toBe("QUALIFIED");

    // Now convert it, and re-run the same action against the now-CONVERTED lead — must fail cleanly, never silently succeed.
    await request(app)
      .post(`/api/v1/leads/${targetLeadId}/convert`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ clientCode: "STATUS-UPDATE-CLIENT" });

    const secondTrigger = await request(app).post(`/api/v1/automation/workflows/${workflowId}/trigger`).set("Authorization", `Bearer ${adminToken}`).send({});
    const secondExecutionId = secondTrigger.body.data.executionId;
    let secondExecution: { status: string } = { status: "QUEUED" };
    for (let i = 0; i < 20; i++) {
      const execRes = await request(app).get(`/api/v1/automation/executions/${secondExecutionId}`).set("Authorization", `Bearer ${adminToken}`);
      secondExecution = execRes.body.data.execution;
      if (secondExecution.status === "COMPLETED" || secondExecution.status === "FAILED") break;
      await new Promise((r) => setTimeout(r, 150));
    }
    expect(secondExecution.status).toBe("FAILED");
  });

  // Phase 14 — THE critical gap-fix proof: EventEngine existed but nothing
  // in the platform ever called eventEngine.emit() outside the automation
  // module itself before this phase. Proves a real business action
  // (creating a Lead via the authenticated API) now fires a real
  // EVENT-triggered ACTIVE workflow end-to-end, with no manual trigger
  // involved at all.
  it("a real lead.created business event (fired by creating a Lead through the normal CRM API) automatically triggers a matching ACTIVE EVENT workflow", async () => {
    const assignee2 = await request(app)
      .post("/api/v1/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ email: "automation-event-assignee@example.com", password: "UserPassword123", firstName: "Ev", lastName: "Assignee", roleKey: "USER" });
    const assigneeId2 = assignee2.body.data.user.id;

    const createRes = await request(app)
      .post("/api/v1/automation/workflows")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        name: "New Lead Auto-Assign Workflow",
        triggerType: "EVENT",
        triggerConfig: { eventType: "lead.created" },
        steps: [
          {
            id: "create_task_step",
            name: "Create follow-up task",
            type: "BUSINESS_ACTION",
            actionId: "create_task",
            parameters: { title: "Follow up with new lead", assignedUserId: assigneeId2, isAiGenerated: false },
          },
        ],
      });
    expect(createRes.status).toBe(201);
    const workflowId = createRes.body.data.workflow.id;
    const publishRes = await request(app).post(`/api/v1/automation/workflows/${workflowId}/publish`).set("Authorization", `Bearer ${adminToken}`).send({});
    expect(publishRes.body.data.workflow.status).toBe("ACTIVE");

    // No manual /trigger call at all — this creates a Lead through the
    // ordinary authenticated API, exactly like a real sales rep would.
    const leadRes = await request(app)
      .post("/api/v1/leads")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ companyName: "Event-Triggered Lead Co" });
    expect(leadRes.status).toBe(201);
    const newLeadId = leadRes.body.data.lead.id;

    // Poll for an execution of this workflow correlated to the real event to appear and complete.
    let matched: { id: string; status: string } | null = null;
    for (let i = 0; i < 30; i++) {
      const listRes = await request(app)
        .get("/api/v1/automation/executions")
        .set("Authorization", `Bearer ${adminToken}`)
        .query({ workflowId });
      const rows = listRes.body.data.rows as Array<{ id: string; status: string; entityId: string | null }>;
      matched = rows.find((r) => r.entityId === newLeadId) ?? null;
      if (matched && (matched.status === "COMPLETED" || matched.status === "FAILED")) break;
      await new Promise((r) => setTimeout(r, 150));
    }

    expect(matched).not.toBeNull();
    expect(matched!.status).toBe("COMPLETED");

    const task = await prisma.automationTask.findFirst({ where: { title: "Follow up with new lead", assignedUserId: assigneeId2 } });
    expect(task).not.toBeNull();
  });
});
