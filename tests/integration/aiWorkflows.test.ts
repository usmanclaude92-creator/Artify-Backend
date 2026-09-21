/** Phase 12 §31 — AI workflows: CRUD, bounded-step validation, publish, execution (multi-step governed dispatch), tenant isolation. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp, finalizeApp } from "../../server/app/app";
import { disconnectPrisma } from "../../server/db/prisma";
import { resetDb } from "../helpers/db";

describe("AI workflows", () => {
  const app = createApp();
  finalizeApp(app);

  let adminToken: string;
  let userToken: string;
  let otherOrgAdminToken: string;

  beforeAll(async () => {
    await resetDb();
    const reg = await request(app).post("/api/v1/auth/register").send({
      email: "ai-workflow-admin@example.com",
      password: "OriginalPassword123",
      firstName: "WF",
      lastName: "Admin",
      organizationName: "AI Workflow Co",
    });
    adminToken = reg.body.data.session.token;

    await request(app)
      .post("/api/v1/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ email: "ai-workflow-user@example.com", password: "UserPassword123", firstName: "U", lastName: "W", roleKey: "USER" });
    userToken = (await request(app).post("/api/v1/auth/login").send({ email: "ai-workflow-user@example.com", password: "UserPassword123" })).body.data
      .session.token;

    const otherReg = await request(app).post("/api/v1/auth/register").send({
      email: "ai-workflow-other-admin@example.com",
      password: "OriginalPassword123",
      firstName: "Other",
      lastName: "Admin",
      organizationName: "Other Workflow Co",
    });
    otherOrgAdminToken = otherReg.body.data.session.token;
  });

  afterAll(async () => {
    await disconnectPrisma();
  });

  async function createWorkflow(overrides: Record<string, unknown> = {}) {
    return request(app)
      .post("/api/v1/ai/workflows")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        key: "lead-intake",
        name: "Lead Intake",
        steps: [
          { order: 0, toolCode: "leads.list" },
          { order: 1, toolCode: "leads.create" },
        ],
        ...overrides,
      });
  }

  it("denies a USER (no ai.workflows.create) from creating a workflow", async () => {
    const res = await request(app)
      .post("/api/v1/ai/workflows")
      .set("Authorization", `Bearer ${userToken}`)
      .send({ key: "x", name: "X", steps: [{ order: 0, toolCode: "leads.list" }] });
    expect(res.status).toBe(403);
  });

  it("rejects a workflow step referencing an unregistered tool code", async () => {
    const res = await createWorkflow({ key: "bad-workflow", steps: [{ order: 0, toolCode: "not.a.real.tool" }] });
    expect(res.status).toBe(400);
  });

  it("rejects a workflow whose step count exceeds its own maxSteps", async () => {
    const res = await createWorkflow({ key: "too-many-steps", maxSteps: 1 });
    expect(res.status).toBe(400);
  });

  it("creates a DRAFT workflow and refuses to execute it before publishing", async () => {
    const created = await createWorkflow();
    expect(created.status).toBe(201);
    expect(created.body.data.workflow.status).toBe("DRAFT");

    const execAttempt = await request(app)
      .post(`/api/v1/ai/workflows/${created.body.data.workflow.id}/execute`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ stepInputs: {} });
    expect(execAttempt.status).toBe(400);
  });

  it("publishes a workflow and executes it end to end, recording one tool execution per step", async () => {
    const created = await createWorkflow({ key: "lead-intake-2" });
    const workflowId = created.body.data.workflow.id;

    const publish = await request(app).post(`/api/v1/ai/workflows/${workflowId}/publish`).set("Authorization", `Bearer ${adminToken}`).send();
    expect(publish.status).toBe(200);
    expect(publish.body.data.workflow.status).toBe("ACTIVE");

    const exec = await request(app)
      .post(`/api/v1/ai/workflows/${workflowId}/execute`)
      .set("Authorization", `Bearer ${userToken}`)
      .send({ stepInputs: { "1": { companyName: "Workflow-Created Co" } } });
    expect(exec.status).toBe(202);
    expect(exec.body.data.execution.status).toBe("COMPLETED");

    const detail = await request(app).get(`/api/v1/ai/executions/${exec.body.data.execution.id}`).set("Authorization", `Bearer ${adminToken}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.execution.toolExecutions).toHaveLength(2);
    expect(detail.body.data.execution.toolExecutions.every((te: { status: string }) => te.status === "COMPLETED")).toBe(true);
  });

  it("enforces tenant isolation — another organization's admin cannot see or execute this workflow", async () => {
    const created = await createWorkflow({ key: "isolated-workflow" });
    const workflowId = created.body.data.workflow.id;

    const getAttempt = await request(app).get(`/api/v1/ai/workflows/${workflowId}`).set("Authorization", `Bearer ${otherOrgAdminToken}`);
    expect(getAttempt.status).toBe(404);

    const execAttempt = await request(app)
      .post(`/api/v1/ai/workflows/${workflowId}/execute`)
      .set("Authorization", `Bearer ${otherOrgAdminToken}`)
      .send({ stepInputs: {} });
    expect(execAttempt.status).toBe(404);
  });
});
