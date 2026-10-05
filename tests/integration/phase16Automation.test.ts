/**
 * Phase 16 — Workflow + Approvals + Tasks + Notifications
 * (docs/AUTOMATION_ARCHITECTURE.md). New real triggers, content approval
 * lifecycle (submit/approve/reject/request-changes), task comments/My
 * Work, notification entity links, and the event-chain recursion guard.
 * Does not re-test Phase 13's existing workflow engine/approval-engine
 * coverage (tests/integration/automation.test.ts) — only what's new here.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp, finalizeApp } from "../../server/app/app";
import { disconnectPrisma, prisma } from "../../server/db/prisma";
import { resetDb } from "../helpers/db";
import { automationService } from "../../server/services/automation/AutomationService";
import { taskManager } from "../../server/services/automation/TaskManager";

describe("Phase 16 — Workflow + Approvals + Tasks + Notifications", () => {
  const app = createApp();
  finalizeApp(app);

  let adminToken: string;
  let orgId: string;
  let managerToken: string;
  let viewerToken: string;
  let otherOrgAdminToken: string;

  beforeAll(async () => {
    await resetDb();
    const reg = await request(app).post("/api/v1/auth/register").send({
      email: "p16-admin@example.com",
      password: "OriginalPassword123",
      firstName: "P16",
      lastName: "Admin",
      organizationName: "Phase16 Co",
    });
    adminToken = reg.body.data.session.token;
    orgId = reg.body.data.user.organizationId;

    await request(app)
      .post("/api/v1/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ email: "p16-manager@example.com", password: "ManagerPassword123", firstName: "M", lastName: "Gr", roleKey: "MANAGER" });
    managerToken = (await request(app).post("/api/v1/auth/login").send({ email: "p16-manager@example.com", password: "ManagerPassword123" })).body.data
      .session.token;

    await request(app)
      .post("/api/v1/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ email: "p16-viewer@example.com", password: "ViewerPassword123", firstName: "V", lastName: "Wr", roleKey: "VIEWER" });
    viewerToken = (await request(app).post("/api/v1/auth/login").send({ email: "p16-viewer@example.com", password: "ViewerPassword123" })).body.data
      .session.token;

    const other = await request(app).post("/api/v1/auth/register").send({
      email: "p16-other-admin@example.com",
      password: "OriginalPassword123",
      firstName: "Other",
      lastName: "Admin",
      organizationName: "Other Phase16 Co",
    });
    otherOrgAdminToken = other.body.data.session.token;
  });

  afterAll(async () => {
    await disconnectPrisma();
  });

  describe("new real event triggers", () => {
    it("emits a real opportunity.created event when an opportunity is created", async () => {
      const client = await request(app).post("/api/v1/clients").set("Authorization", `Bearer ${adminToken}`).send({ clientCode: "P16-C1", name: "Trigger Client" });
      const res = await request(app)
        .post("/api/v1/opportunities")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ name: "Trigger Opp", clientId: client.body.data.client.id, value: 1000, currency: "USD" });
      expect(res.status).toBe(201);

      const event = await prisma.automationEvent.findFirst({ where: { organizationId: orgId, eventType: "opportunity.created", entityId: res.body.data.opportunity.id } });
      expect(event).not.toBeNull();
    });

    it("emits a real client.created event when a client is created", async () => {
      const res = await request(app).post("/api/v1/clients").set("Authorization", `Bearer ${adminToken}`).send({ clientCode: "P16-C2", name: "Created Event Client" });
      expect(res.status).toBe(201);
      const event = await prisma.automationEvent.findFirst({ where: { organizationId: orgId, eventType: "client.created", entityId: res.body.data.client.id } });
      expect(event).not.toBeNull();
    });

    it("emits a real client.onboarding_started event when onboarding begins", async () => {
      const client = await request(app).post("/api/v1/clients").set("Authorization", `Bearer ${adminToken}`).send({ clientCode: "P16-C3", name: "Onboarding Start Client" });
      const clientId = client.body.data.client.id;
      const res = await request(app).post(`/api/v1/clients/${clientId}/onboarding/start`).set("Authorization", `Bearer ${adminToken}`).send({});
      expect(res.status).toBe(201);
      const event = await prisma.automationEvent.findFirst({ where: { organizationId: orgId, eventType: "client.onboarding_started", entityId: clientId } });
      expect(event).not.toBeNull();
    });

    it("emits a real content.submitted_for_review event when a page is submitted for review", async () => {
      const page = await request(app).post("/api/v1/pages").set("Authorization", `Bearer ${adminToken}`).send({ title: "Trigger Page", body: "content" });
      const pageId = page.body.data.page.id;
      const res = await request(app).post(`/api/v1/pages/${pageId}/submit-review`).set("Authorization", `Bearer ${adminToken}`).send();
      expect(res.status).toBe(200);
      const event = await prisma.automationEvent.findFirst({ where: { organizationId: orgId, eventType: "content.submitted_for_review", entityId: pageId } });
      expect(event).not.toBeNull();
    });

    it("emits a real task.completed event when a task is marked complete", async () => {
      const created = await request(app).post("/api/v1/automation/tasks").set("Authorization", `Bearer ${adminToken}`).send({ title: "Complete Me" });
      const taskId = created.body.data.task.id;
      const res = await request(app).patch(`/api/v1/automation/tasks/${taskId}`).set("Authorization", `Bearer ${adminToken}`).send({ status: "COMPLETED" });
      expect(res.status).toBe(200);
      const event = await prisma.automationEvent.findFirst({ where: { organizationId: orgId, eventType: "task.completed", entityId: taskId } });
      expect(event).not.toBeNull();
    });

    it("recursion guard: refuses to trigger further workflows once an event chain exceeds the depth limit", async () => {
      // Craft a correlationId that already has a long causal chain of
      // executions recorded (same shape a real A-triggers-B-triggers-A
      // loop would accumulate), then prove a fresh event sharing that
      // same correlationId is refused — never silently runs away.
      const wf = await automationService.createWorkflow({ organizationId: orgId, name: "Chain Guard Workflow", triggerType: "EVENT", triggerConfig: { eventType: "chain.guard.test" }, steps: [] });
      await automationService.updateWorkflow({ id: wf.id, organizationId: orgId, status: "ACTIVE" });

      const chainCorrelationId = "chain-guard-test-correlation";
      for (let i = 0; i < 25; i++) {
        await prisma.automationExecution.create({
          data: {
            organizationId: orgId,
            workflowId: wf.id,
            workflowVersion: 1,
            status: "COMPLETED",
            triggerType: "EVENT",
            correlationId: chainCorrelationId,
          },
        });
      }

      const executionCountBefore = await prisma.automationExecution.count({ where: { organizationId: orgId, correlationId: chainCorrelationId } });
      await automationService.emitEvent({
        eventType: "chain.guard.test",
        entityType: "test",
        entityId: "test-1",
        organizationId: orgId,
        payload: {},
        correlationId: chainCorrelationId,
      });
      // Listener dispatch is awaited inside emit(), so by the time this resolves the guard has already run.
      const executionCountAfter = await prisma.automationExecution.count({ where: { organizationId: orgId, correlationId: chainCorrelationId } });
      expect(executionCountAfter).toBe(executionCountBefore);
    });
  });

  describe("content approval lifecycle", () => {
    async function createAndSubmitPage(title: string) {
      const page = await request(app).post("/api/v1/pages").set("Authorization", `Bearer ${adminToken}`).send({ title, body: "<p>content</p>" });
      const pageId = page.body.data.page.id;
      await request(app).post(`/api/v1/pages/${pageId}/submit-review`).set("Authorization", `Bearer ${adminToken}`).send();
      return pageId;
    }

    it("rejects submission of a page that isn't IN_REVIEW", async () => {
      const page = await request(app).post("/api/v1/pages").set("Authorization", `Bearer ${adminToken}`).send({ title: "Not In Review", body: "x" });
      const res = await request(app)
        .post("/api/v1/automation/content-approvals")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ contentType: "page", contentId: page.body.data.page.id });
      expect(res.status).toBe(409);
    });

    it("MANAGER (content.update, no content.publish) can submit for approval but cannot decide it", async () => {
      const pageId = await createAndSubmitPage("Manager Submit Page");
      const submit = await request(app)
        .post("/api/v1/automation/content-approvals")
        .set("Authorization", `Bearer ${managerToken}`)
        .send({ contentType: "page", contentId: pageId });
      expect(submit.status).toBe(201);
      const approvalId = submit.body.data.approvalId;

      const decideAsManager = await request(app)
        .post(`/api/v1/automation/content-approvals/${approvalId}/decide`)
        .set("Authorization", `Bearer ${managerToken}`)
        .send({ decision: "APPROVED" });
      expect(decideAsManager.status).toBe(403);
    });

    it("VIEWER (content.read only) cannot submit for approval", async () => {
      const pageId = await createAndSubmitPage("Viewer Blocked Page");
      const res = await request(app)
        .post("/api/v1/automation/content-approvals")
        .set("Authorization", `Bearer ${viewerToken}`)
        .send({ contentType: "page", contentId: pageId });
      expect(res.status).toBe(403);
    });

    it("approving a content approval publishes the real page via the existing publish code path", async () => {
      const pageId = await createAndSubmitPage("Approve Publish Page");
      const submit = await request(app)
        .post("/api/v1/automation/content-approvals")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ contentType: "page", contentId: pageId });
      const approvalId = submit.body.data.approvalId;

      const decide = await request(app)
        .post(`/api/v1/automation/content-approvals/${approvalId}/decide`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ decision: "APPROVED" });
      expect(decide.status).toBe(200);
      expect(decide.body.data.decision).toBe("APPROVED");

      const page = await request(app).get(`/api/v1/pages/${pageId}`).set("Authorization", `Bearer ${adminToken}`);
      expect(page.body.data.page.status).toBe("PUBLISHED");

      const event = await prisma.automationEvent.findFirst({ where: { organizationId: orgId, eventType: "content.approved", entityId: pageId } });
      expect(event).not.toBeNull();
    });

    it("requesting changes sends the page back to DRAFT, with a reason recorded, and allows resubmission", async () => {
      const pageId = await createAndSubmitPage("Changes Requested Page");
      const submit = await request(app)
        .post("/api/v1/automation/content-approvals")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ contentType: "page", contentId: pageId });
      const approvalId = submit.body.data.approvalId;

      const decide = await request(app)
        .post(`/api/v1/automation/content-approvals/${approvalId}/decide`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ decision: "CHANGES_REQUESTED", reason: "Fix the headline." });
      expect(decide.status).toBe(200);
      expect(decide.body.data.decision).toBe("CHANGES_REQUESTED");

      const page = await request(app).get(`/api/v1/pages/${pageId}`).set("Authorization", `Bearer ${adminToken}`);
      expect(page.body.data.page.status).toBe("DRAFT");

      const approval = await prisma.automationApproval.findUnique({ where: { id: approvalId } });
      expect(approval?.decisionReason).toBe("Fix the headline.");

      // Resubmit: submit-review again, then a fresh approval request.
      await request(app).post(`/api/v1/pages/${pageId}/submit-review`).set("Authorization", `Bearer ${adminToken}`).send();
      const resubmit = await request(app)
        .post("/api/v1/automation/content-approvals")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ contentType: "page", contentId: pageId });
      expect(resubmit.status).toBe(201);
      expect(resubmit.body.data.approvalId).not.toBe(approvalId);
    });

    it("rejects a duplicate pending approval request for the same content", async () => {
      const pageId = await createAndSubmitPage("Duplicate Guard Page");
      const first = await request(app)
        .post("/api/v1/automation/content-approvals")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ contentType: "page", contentId: pageId });
      expect(first.status).toBe(201);

      const second = await request(app)
        .post("/api/v1/automation/content-approvals")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ contentType: "page", contentId: pageId });
      expect(second.status).toBe(409);
    });

    it("never leaks another organization's content approvals (tenant isolation)", async () => {
      await createAndSubmitPage("Isolation Page");
      const res = await request(app).get("/api/v1/automation/content-approvals").set("Authorization", `Bearer ${otherOrgAdminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.total).toBe(0);
    });

    it("rejects an invalid contentType/decision as bad input", async () => {
      const badType = await request(app)
        .post("/api/v1/automation/content-approvals")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ contentType: "campaign", contentId: "whatever" });
      expect(badType.status).toBe(400);

      const pageId = await createAndSubmitPage("Bad Decision Page");
      const submit = await request(app).post("/api/v1/automation/content-approvals").set("Authorization", `Bearer ${adminToken}`).send({ contentType: "page", contentId: pageId });
      const badDecision = await request(app)
        .post(`/api/v1/automation/content-approvals/${submit.body.data.approvalId}/decide`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ decision: "MAYBE" });
      expect(badDecision.status).toBe(400);
    });
  });

  describe("tasks: comments, assignment notifications, My Work", () => {
    it("adds a comment to a task and notifies the assignee (entity-linked)", async () => {
      const assignee = await request(app)
        .post("/api/v1/users")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ email: "p16-assignee@example.com", password: "UserPassword123", firstName: "As", lastName: "Signee", roleKey: "USER" });
      const assigneeId = assignee.body.data.user.id;

      const task = await request(app)
        .post("/api/v1/automation/tasks")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ title: "Commented Task", assignedUserId: assigneeId });
      expect(task.status).toBe(201);
      const taskId = task.body.data.task.id;

      const assignedNotif = await prisma.notification.findFirst({ where: { userId: assigneeId, type: "task_assigned", entityId: taskId } });
      expect(assignedNotif).not.toBeNull();
      expect(assignedNotif?.entityType).toBe("automation_task");

      const comment = await request(app).post(`/api/v1/automation/tasks/${taskId}/comments`).set("Authorization", `Bearer ${adminToken}`).send({ text: "Please prioritize this." });
      expect(comment.status).toBe(201);
      expect(comment.body.data.task.metadata.comments).toHaveLength(1);
      expect(comment.body.data.task.metadata.comments[0].text).toBe("Please prioritize this.");

      const commentNotif = await prisma.notification.findFirst({ where: { userId: assigneeId, type: "task_commented", entityId: taskId } });
      expect(commentNotif).not.toBeNull();
    });

    it("rejects an empty comment as invalid input", async () => {
      const task = await request(app).post("/api/v1/automation/tasks").set("Authorization", `Bearer ${adminToken}`).send({ title: "Empty Comment Task" });
      const res = await request(app).post(`/api/v1/automation/tasks/${task.body.data.task.id}/comments`).set("Authorization", `Bearer ${adminToken}`).send({ text: "" });
      expect(res.status).toBe(400);
    });

    it("My Work shows only the caller's own overdue/upcoming/assigned tasks and role-eligible approvals", async () => {
      const overdueTask = await request(app)
        .post("/api/v1/automation/tasks")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ title: "My Overdue Task", assignedUserId: (await request(app).get("/api/v1/auth/me").set("Authorization", `Bearer ${adminToken}`)).body.data.user.id, dueDate: "2020-01-01T00:00:00.000Z" });
      expect(overdueTask.status).toBe(201);

      const myWork = await request(app).get("/api/v1/automation/my-work").set("Authorization", `Bearer ${adminToken}`);
      expect(myWork.status).toBe(200);
      expect(myWork.body.data.tasks.overdue.some((t: { id: string }) => t.id === overdueTask.body.data.task.id)).toBe(true);

      const managerWork = await request(app).get("/api/v1/automation/my-work").set("Authorization", `Bearer ${managerToken}`);
      expect(managerWork.status).toBe(200);
      expect(managerWork.body.data.tasks.overdue.some((t: { id: string }) => t.id === overdueTask.body.data.task.id)).toBe(false);
    });

    it("the due-date cron check is idempotent: a task is notified at most once across repeated ticks", async () => {
      const me = await request(app).get("/api/v1/auth/me").set("Authorization", `Bearer ${adminToken}`);
      const overdue = await request(app)
        .post("/api/v1/automation/tasks")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ title: "Idempotent Overdue Task", assignedUserId: me.body.data.user.id, dueDate: "2020-01-01T00:00:00.000Z" });
      const taskId = overdue.body.data.task.id;

      const before = await prisma.notification.count({ where: { userId: me.body.data.user.id, type: "task_overdue", entityId: taskId } });
      await taskManager.checkDueDates();
      await taskManager.checkDueDates();
      const after = await prisma.notification.count({ where: { userId: me.body.data.user.id, type: "task_overdue", entityId: taskId } });
      expect(after).toBe(before + 1);
    });
  });

  describe("workflow completion/failure notifications", () => {
    it("notifies the initiator and emits workflow.completed on a successful run", async () => {
      const wf = await automationService.createWorkflow({ organizationId: orgId, userId: undefined, name: "Notify Complete Workflow", triggerType: "MANUAL", steps: [] });
      await automationService.updateWorkflow({ id: wf.id, organizationId: orgId, status: "ACTIVE" });
      const me = await request(app).get("/api/v1/auth/me").set("Authorization", `Bearer ${adminToken}`);

      const trigger = await request(app).post(`/api/v1/automation/workflows/${wf.id}/trigger`).set("Authorization", `Bearer ${adminToken}`).send({});
      expect(trigger.status).toBe(202);
      const executionId = trigger.body.data.executionId;

      let status = "QUEUED";
      for (let i = 0; i < 20; i++) {
        const execRes = await request(app).get(`/api/v1/automation/executions/${executionId}`).set("Authorization", `Bearer ${adminToken}`);
        status = execRes.body.data.execution.status;
        if (status === "COMPLETED" || status === "FAILED") break;
        await new Promise((r) => setTimeout(r, 150));
      }
      expect(status).toBe("COMPLETED");

      const notif = await prisma.notification.findFirst({ where: { userId: me.body.data.user.id, type: "workflow_completed", entityId: executionId } });
      expect(notif).not.toBeNull();

      const event = await prisma.automationEvent.findFirst({ where: { organizationId: orgId, eventType: "workflow.completed", entityId: executionId } });
      expect(event).not.toBeNull();
    });
  });
});
