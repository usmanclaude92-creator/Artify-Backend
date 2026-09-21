/**
 * Phase 12 §31 — AI governance security suite: direct tool-call execution,
 * permission enforcement inside the dispatcher (not just the route),
 * tenant isolation (IDOR) on executions/approvals, org tool disablement,
 * and the financial-bypass-prevention guarantee — a HIGH-risk tool
 * (invoices.issue) must never move money without a human approval decision,
 * and rejecting a request must leave the underlying resource untouched.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp, finalizeApp } from "../../server/app/app";
import { disconnectPrisma, prisma } from "../../server/db/prisma";
import { resetDb } from "../helpers/db";

describe("AI governance security", () => {
  const app = createApp();
  finalizeApp(app);

  let adminToken: string;
  let userToken: string;
  let viewerToken: string;
  let clientId: string;
  let otherOrgAdminToken: string;

  beforeAll(async () => {
    await resetDb();
    const reg = await request(app).post("/api/v1/auth/register").send({
      email: "ai-gov-admin@example.com",
      password: "OriginalPassword123",
      firstName: "Gov",
      lastName: "Admin",
      organizationName: "AI Governance Co",
    });
    adminToken = reg.body.data.session.token;

    await request(app)
      .post("/api/v1/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ email: "ai-gov-user@example.com", password: "UserPassword123", firstName: "U", lastName: "W", roleKey: "USER" });
    userToken = (await request(app).post("/api/v1/auth/login").send({ email: "ai-gov-user@example.com", password: "UserPassword123" })).body.data.session
      .token;

    await request(app)
      .post("/api/v1/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ email: "ai-gov-viewer@example.com", password: "ViewerPassword123", firstName: "V", lastName: "W", roleKey: "VIEWER" });
    viewerToken = (await request(app).post("/api/v1/auth/login").send({ email: "ai-gov-viewer@example.com", password: "ViewerPassword123" })).body.data
      .session.token;

    const client = await request(app).post("/api/v1/clients").set("Authorization", `Bearer ${adminToken}`).send({ clientCode: "AI-GOV-1", name: "AI Gov Client" });
    clientId = client.body.data.client.id;

    const otherReg = await request(app).post("/api/v1/auth/register").send({
      email: "ai-gov-other-admin@example.com",
      password: "OriginalPassword123",
      firstName: "Other",
      lastName: "Admin",
      organizationName: "Other Gov Co",
    });
    otherOrgAdminToken = otherReg.body.data.session.token;
  });

  afterAll(async () => {
    await disconnectPrisma();
  });

  async function createDraftInvoice() {
    const res = await request(app)
      .post("/api/v1/invoices")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        clientId,
        issueDate: "2026-01-01",
        dueDate: "2026-01-31",
        items: [{ description: "Consulting", quantity: 1, unitPrice: "500.000" }],
      });
    expect(res.status).toBe(201);
    return res.body.data.invoice.id as string;
  }

  it("executes a READ_ONLY tool directly and records a COMPLETED execution", async () => {
    const res = await request(app).post("/api/v1/ai/executions/tool-call").set("Authorization", `Bearer ${userToken}`).send({ toolCode: "leads.list", input: {} });
    expect(res.status).toBe(202);
    expect(res.body.data.execution.status).toBe("COMPLETED");
    expect(res.body.data.execution.kind).toBe("TOOL_CALL");
  });

  it("denies a VIEWER (no ai.workflows.execute) at the route level", async () => {
    const res = await request(app).post("/api/v1/ai/executions/tool-call").set("Authorization", `Bearer ${viewerToken}`).send({ toolCode: "leads.list", input: {} });
    expect(res.status).toBe(403);
  });

  it("denies a caller who has ai.workflows.execute but lacks the specific tool's own required permission", async () => {
    // USER has leads.create but not clients.create — the dispatcher must reject on the
    // tool's own requiredPermission even though the route-level gate already passed.
    const res = await request(app)
      .post("/api/v1/ai/executions/tool-call")
      .set("Authorization", `Bearer ${userToken}`)
      .send({ toolCode: "clients.create", input: { clientCode: "SHOULD-FAIL", name: "Should Fail" } });
    expect(res.status).toBe(403);

    const clientRow = await prisma.client.findFirst({ where: { clientCode: "SHOULD-FAIL" } });
    expect(clientRow).toBeNull();
  });

  it("blocks tool execution when an org has disabled that tool", async () => {
    await request(app).patch("/api/v1/ai/tools/leads.create/settings").set("Authorization", `Bearer ${adminToken}`).send({ enabled: false });

    const res = await request(app)
      .post("/api/v1/ai/executions/tool-call")
      .set("Authorization", `Bearer ${userToken}`)
      .send({ toolCode: "leads.create", input: { companyName: "Blocked Co" } });
    expect(res.status).toBe(403);

    await request(app).patch("/api/v1/ai/tools/leads.create/settings").set("Authorization", `Bearer ${adminToken}`).send({ enabled: true });
  });

  it("enforces tenant isolation on execution history — another org cannot read this org's executions", async () => {
    const created = await request(app).post("/api/v1/ai/executions/tool-call").set("Authorization", `Bearer ${userToken}`).send({ toolCode: "leads.list", input: {} });
    const executionId = created.body.data.execution.id;

    const res = await request(app).get(`/api/v1/ai/executions/${executionId}`).set("Authorization", `Bearer ${otherOrgAdminToken}`);
    expect(res.status).toBe(404);
  });

  describe("financial-bypass prevention (HIGH-risk tools)", () => {
    it("never issues an invoice directly — a HIGH-risk tool call is always queued for approval, not executed", async () => {
      const invoiceId = await createDraftInvoice();

      const res = await request(app)
        .post("/api/v1/ai/executions/tool-call")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ toolCode: "invoices.issue", input: { invoiceId } });
      expect(res.status).toBe(202);
      expect(res.body.data.execution.status).toBe("AWAITING_APPROVAL");

      const invoice = await request(app).get(`/api/v1/invoices/${invoiceId}`).set("Authorization", `Bearer ${adminToken}`);
      expect(invoice.body.data.invoice.status).toBe("DRAFT");

      const approvals = await request(app).get("/api/v1/ai/approvals?status=PENDING").set("Authorization", `Bearer ${adminToken}`);
      const approval = approvals.body.data.approvals.find((a: { action: string; payload: { invoiceId: string } }) => a.action === "invoices.issue" && a.payload.invoiceId === invoiceId);
      expect(approval).toBeDefined();

      // A rejection must leave the invoice exactly as it was.
      const rejected = await request(app)
        .post(`/api/v1/ai/approvals/${approval.id}/decide`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ decision: "REJECT", rejectionReason: "Not yet." });
      expect(rejected.status).toBe(200);

      const invoiceAfterReject = await request(app).get(`/api/v1/invoices/${invoiceId}`).set("Authorization", `Bearer ${adminToken}`);
      expect(invoiceAfterReject.body.data.invoice.status).toBe("DRAFT");
    });

    it("only issues the invoice once a human with ai.approvals.decide approves the pending request", async () => {
      const invoiceId = await createDraftInvoice();

      await request(app)
        .post("/api/v1/ai/executions/tool-call")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ toolCode: "invoices.issue", input: { invoiceId } });

      const approvals = await request(app).get("/api/v1/ai/approvals?status=PENDING").set("Authorization", `Bearer ${adminToken}`);
      const approval = approvals.body.data.approvals.find((a: { action: string; payload: { invoiceId: string } }) => a.action === "invoices.issue" && a.payload.invoiceId === invoiceId);

      // A USER without ai.approvals.decide cannot approve it.
      const denied = await request(app).post(`/api/v1/ai/approvals/${approval.id}/decide`).set("Authorization", `Bearer ${userToken}`).send({ decision: "APPROVE" });
      expect(denied.status).toBe(403);

      const approved = await request(app).post(`/api/v1/ai/approvals/${approval.id}/decide`).set("Authorization", `Bearer ${adminToken}`).send({ decision: "APPROVE" });
      expect(approved.status).toBe(200);
      expect(approved.body.data.approval.status).toBe("APPROVED");

      const invoiceAfter = await request(app).get(`/api/v1/invoices/${invoiceId}`).set("Authorization", `Bearer ${adminToken}`);
      expect(invoiceAfter.body.data.invoice.status).toBe("ISSUED");

      const auditEntries = await prisma.auditLog.findMany({ where: { resourceType: "ai_approval_request", resourceId: approval.id } });
      expect(auditEntries.some((e) => e.action === "AI_APPROVAL_APPROVED")).toBe(true);
    });

    it("rejects a decision on an approval request that has already been decided", async () => {
      const invoiceId = await createDraftInvoice();
      await request(app).post("/api/v1/ai/executions/tool-call").set("Authorization", `Bearer ${adminToken}`).send({ toolCode: "invoices.issue", input: { invoiceId } });

      const approvals = await request(app).get("/api/v1/ai/approvals?status=PENDING").set("Authorization", `Bearer ${adminToken}`);
      const approval = approvals.body.data.approvals.find((a: { action: string; payload: { invoiceId: string } }) => a.action === "invoices.issue" && a.payload.invoiceId === invoiceId);

      await request(app).post(`/api/v1/ai/approvals/${approval.id}/decide`).set("Authorization", `Bearer ${adminToken}`).send({ decision: "APPROVE" });
      const secondDecision = await request(app).post(`/api/v1/ai/approvals/${approval.id}/decide`).set("Authorization", `Bearer ${adminToken}`).send({ decision: "APPROVE" });
      expect(secondDecision.status).toBe(409);
    });

    it("enforces tenant isolation on approval requests", async () => {
      const invoiceId = await createDraftInvoice();
      const created = await request(app).post("/api/v1/ai/executions/tool-call").set("Authorization", `Bearer ${adminToken}`).send({ toolCode: "invoices.issue", input: { invoiceId } });
      const approvalRequestId = created.body.data.execution.output.approvalRequestId;

      const res = await request(app).get(`/api/v1/ai/approvals/${approvalRequestId}`).set("Authorization", `Bearer ${otherOrgAdminToken}`);
      expect(res.status).toBe(404);
    });
  });
});
