/** Global Approvals center — real DB, real services (no mocks). Test data is tagged QA_TEST_2026_. */
import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp, finalizeApp } from "../../server/app/app";
import { disconnectPrisma, prisma } from "../../server/db/prisma";
import { resetDb } from "../helpers/db";
import { clearNavBadgeCache } from "../../server/services/navBadgeService";

describe("Approvals center", () => {
  const app = createApp();
  finalizeApp(app);
  let adminToken = "";
  let managerToken = "";
  let viewerToken = "";
  let portalToken = "";
  let otherAdminToken = "";
  let orgId = "";
  let adminId = "";
  let ip = 40;

  const api = (method: "get" | "post", path: string, token: string, body?: object) => {
    const r = request(app)[method](`/api/v1${path}`).set("Authorization", `Bearer ${token}`).set("X-Forwarded-For", `10.7.0.${ip++}`);
    return method === "post" ? r.send(body ?? {}) : r;
  };
  const makeUser = async (email: string, roleKey: string) => {
    await api("post", "/users", adminToken, { email, password: "Str0ng-Passphrase-77", firstName: "QA", lastName: roleKey, roleKey });
    return (await request(app).post("/api/v1/auth/login").set("X-Forwarded-For", `10.7.0.${ip++}`).send({ email, password: "Str0ng-Passphrase-77" })).body.data.session.token as string;
  };

  async function seedAi(action: string) {
    const payload = { note: "QA_TEST_2026_" };
    return prisma.aIApprovalRequest.create({
      data: { organizationId: orgId, requestedById: adminId, action, payload, payloadHash: crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex"), expiresAt: new Date(Date.now() + 3600_000) },
    });
  }
  async function seedAutomation(description: string, requiredRole?: string) {
    const workflow = await prisma.automationWorkflow.create({ data: { organizationId: orgId, name: `QA_TEST_2026_ wf ${description}`, category: "QA", status: "ACTIVE", triggerType: "MANUAL", steps: [] } });
    const execution = await prisma.automationExecution.create({ data: { organizationId: orgId, workflowId: workflow.id, workflowVersion: workflow.currentVersion, status: "WAITING_APPROVAL", triggerType: "MANUAL", correlationId: crypto.randomUUID(), initiatedById: adminId } });
    return prisma.automationApproval.create({
      data: { organizationId: orgId, executionId: execution.id, workflowId: workflow.id, stepId: "s1", action: "do_thing", description, requiredRole: requiredRole ?? null, requesterId: adminId },
    });
  }
  async function seedContent(title: string) {
    const page = await api("post", "/pages", adminToken, { title, body: "<p>x</p>" });
    const pageId = page.body.data.page.id as string;
    await api("post", `/pages/${pageId}/submit-review`, adminToken);
    const sub = await api("post", "/automation/content-approvals", adminToken, { contentType: "page", contentId: pageId });
    return { pageId, approvalId: sub.body.data.approvalId as string };
  }

  beforeAll(async () => {
    await resetDb();
    const reg = await request(app).post("/api/v1/auth/register").set("X-Forwarded-For", "10.7.0.1").send({ email: "qa-admin@example.com", password: "Str0ng-Passphrase-77", firstName: "QA", lastName: "Admin", organizationName: "QA_TEST_2026_ Org" });
    adminToken = reg.body.data.session.token;
    orgId = reg.body.data.user.organizationId;
    adminId = reg.body.data.user.id;
    managerToken = await makeUser("qa-manager@example.com", "MANAGER");
    viewerToken = await makeUser("qa-viewer@example.com", "VIEWER");
    portalToken = (await request(app).post("/api/v1/auth/portal/register").set("X-Forwarded-For", "10.7.0.2").send({ email: "qa-portal@example.com", password: "Str0ng-Passphrase-77", firstName: "QA", lastName: "Portal", organizationName: "QA_TEST_2026_ Portal" })).body.data.session.token;
    otherAdminToken = (await request(app).post("/api/v1/auth/register").set("X-Forwarded-For", "10.7.0.3").send({ email: "qa-other@example.com", password: "Str0ng-Passphrase-77", firstName: "QA", lastName: "Other", organizationName: "QA_TEST_2026_ Other" })).body.data.session.token;
  });
  afterAll(async () => {
    await disconnectPrisma();
  });

  it("a user with no approval permission is shut out (and gets no approvals badge)", async () => {
    expect((await api("get", "/approvals", portalToken)).status).toBe(403);
    expect((await api("get", "/approvals/summary", portalToken)).status).toBe(403);
    const badges = await api("get", "/nav/badges", portalToken);
    expect(badges.status).toBe(200);
    expect(badges.body.data.badges).not.toHaveProperty("approvals");
    expect(badges.body.data.badges).not.toHaveProperty("myWork");
  });

  it("normalises and merges all three sources for an admin, with correct pending counts", async () => {
    const ai = await seedAi("QA_TEST_2026_create_invoice");
    const auto = await seedAutomation("QA_TEST_2026_ approve spend");
    const content = await seedContent("QA_TEST_2026_ Pending Page");

    const list = await api("get", "/approvals?status=pending", adminToken);
    expect(list.status).toBe(200);
    const rows = list.body.data.approvals as Array<Record<string, unknown>>;
    const bySource = (s: string) => rows.filter((r) => r.source === s);
    expect(bySource("ai").map((r) => r.id)).toContain(ai.id);
    expect(bySource("automation").map((r) => r.id)).toContain(auto.id);
    expect(bySource("content").map((r) => r.id)).toContain(content.approvalId);
    expect(rows.find((r) => r.id === content.approvalId)).toMatchObject({ title: "QA_TEST_2026_ Pending Page", status: "pending", link: expect.stringContaining("/cms/pages") });
    expect(rows.find((r) => r.id === ai.id)).toMatchObject({ title: "QA_TEST_2026_create_invoice", link: "/ai/approvals", canDecide: true, requestedBy: { id: adminId, name: "QA Admin" } });
    // Content approvals must not be double-counted under "automation".
    expect(bySource("automation").map((r) => r.id)).not.toContain(content.approvalId);

    const summary = (await api("get", "/approvals/summary", adminToken)).body.data;
    expect(summary.counts).toMatchObject({ ai: 1, automation: 1, content: 1, social: 0 });
    expect(summary.total).toBe(3);

    const filtered = await api("get", "/approvals?source=ai&search=invoice", adminToken);
    expect(filtered.body.data.approvals.map((r: { source: string }) => r.source)).toEqual(["ai"]);
    expect((await api("get", "/approvals?source=social", adminToken)).body.data.approvals).toEqual([]);
    expect(list.body.meta.pagination.total).toBe(3);
  });

  it("filters sources by the caller's own permissions (viewer: no content, cannot decide)", async () => {
    const list = await api("get", "/approvals?status=pending", viewerToken);
    expect(list.status).toBe(200);
    const sources = new Set((list.body.data.approvals as Array<{ source: string }>).map((r) => r.source));
    expect(sources.has("content")).toBe(false);
    expect(list.body.data.sources).not.toContain("content");
    for (const r of list.body.data.approvals as Array<{ canDecide: boolean }>) expect(r.canDecide).toBe(false);

    const ai = await prisma.aIApprovalRequest.findFirst({ where: { organizationId: orgId, status: "PENDING" } });
    const decide = await api("post", `/approvals/ai/${ai!.id}/decision`, viewerToken, { decision: "approve" });
    expect(decide.status).toBe(403);
    expect((await api("post", `/approvals/content/${ai!.id}/decision`, viewerToken, { decision: "approve" })).status).toBe(403);
  });

  it("automation approvals respect the existing requiredRole rule for 'me'", async () => {
    const restricted = await seedAutomation("QA_TEST_2026_ admin-only step", "ADMIN");
    const mine = await api("get", "/approvals?source=automation&assignee=me", managerToken);
    expect((mine.body.data.approvals as Array<{ id: string }>).map((r) => r.id)).not.toContain(restricted.id);
    const adminMine = await api("get", "/approvals?source=automation&assignee=me", adminToken);
    expect((adminMine.body.data.approvals as Array<{ id: string }>).map((r) => r.id)).toContain(restricted.id);
  });

  it("requires a comment to reject, and rejects unknown/mismatched sources", async () => {
    const ai = await seedAi("QA_TEST_2026_needs_comment");
    expect((await api("post", `/approvals/ai/${ai.id}/decision`, adminToken, { decision: "reject" })).status).toBe(400);
    expect((await api("post", `/approvals/bogus/${ai.id}/decision`, adminToken, { decision: "approve" })).status).toBe(400);
    const auto = await seedAutomation("QA_TEST_2026_ mismatch");
    expect((await api("post", `/approvals/content/${auto.id}/decision`, adminToken, { decision: "approve" })).status).toBe(400);
    expect((await api("post", `/approvals/automation/${auto.id}/decision`, adminToken, { decision: "approve" })).status).toBe(200);
  });

  it("delegates decisions to the existing services and audits each one", async () => {
    // content: approve → the real page is published by the existing code path
    const c = await seedContent("QA_TEST_2026_ Publish Via Center");
    const approve = await api("post", `/approvals/content/${c.approvalId}/decision`, adminToken, { decision: "approve", comment: "ship it" });
    expect(approve.status).toBe(200);
    expect((await prisma.page.findUnique({ where: { id: c.pageId } }))!.status).toBe("PUBLISHED");
    expect((await prisma.automationApproval.findUnique({ where: { id: c.approvalId } }))).toMatchObject({ status: "APPROVED", approverId: adminId, decisionReason: "ship it" });

    // content: reject → back to DRAFT
    const c2 = await seedContent("QA_TEST_2026_ Reject Via Center");
    expect((await api("post", `/approvals/content/${c2.approvalId}/decision`, adminToken, { decision: "reject", comment: "needs work" })).status).toBe(200);
    expect((await prisma.page.findUnique({ where: { id: c2.pageId } }))!.status).toBe("DRAFT");

    // ai: reject records reason through aiApprovalService
    const ai = await seedAi("QA_TEST_2026_reject_me");
    expect((await api("post", `/approvals/ai/${ai.id}/decision`, adminToken, { decision: "reject", comment: "too risky" })).status).toBe(200);
    expect(await prisma.aIApprovalRequest.findUnique({ where: { id: ai.id } })).toMatchObject({ status: "REJECTED", rejectionReason: "too risky" });
    // …and a resolved request can't be decided twice
    expect((await api("post", `/approvals/ai/${ai.id}/decision`, adminToken, { decision: "approve" })).status).toBe(409);

    const audits = await prisma.auditLog.findMany({ where: { organizationId: orgId, action: "APPROVAL_CENTER_DECISION" } });
    expect(audits.map((a) => a.resourceType).sort()).toEqual(expect.arrayContaining(["ai_approval", "automation_approval", "content_approval"]));
    expect(audits.every((a) => a.actorUserId === adminId)).toBe(true);
    // The source-level audit still exists too.
    expect(await prisma.auditLog.count({ where: { organizationId: orgId, action: "AI_APPROVAL_REJECTED", resourceId: ai.id } })).toBe(1);

    const rejected = await api("get", "/approvals?status=rejected&source=ai", adminToken);
    expect(rejected.body.data.approvals[0]).toMatchObject({ id: ai.id, status: "rejected", decisionComment: "too risky" });
  });

  it("is organisation-scoped", async () => {
    const list = await api("get", "/approvals?status=pending", otherAdminToken);
    expect(list.status).toBe(200);
    expect(list.body.data.approvals).toEqual([]);
    const ai = await seedAi("QA_TEST_2026_cross_org");
    expect((await api("post", `/approvals/ai/${ai.id}/decision`, otherAdminToken, { decision: "approve" })).status).toBe(404);
  });

  it("manual matrix: AI-only custom role sees only AI; full admin sees all; none sees nothing", async () => {
    const roleKey = "QA_TEST_2026_AI_ONLY";
    const role = await prisma.role.create({ data: { key: roleKey, name: "QA_TEST_2026_AI_ONLY", isSystem: false } });
    const perms = await prisma.permission.findMany({ where: { key: { in: ["approvals.read", "ai.approvals.read", "ai.approvals.decide"] } } });
    await prisma.rolePermission.createMany({ data: perms.map((p) => ({ roleId: role.id, permissionId: p.id })) });
    const aiOnly = await makeUser("qa-ai-only@example.com", roleKey);

    const mine = await api("get", "/approvals?status=pending", aiOnly);
    expect(mine.status).toBe(200);
    expect(mine.body.data.sources).toEqual(["ai"]);
    expect(new Set((mine.body.data.approvals as Array<{ source: string }>).map((r) => r.source))).toEqual(new Set(["ai"]));
    const summary = (await api("get", "/approvals/summary", aiOnly)).body.data;
    expect(summary.counts.automation).toBe(0);
    expect(summary.counts.content).toBe(0);
    // cannot touch other sources even by id
    const content = await seedContent("QA_TEST_2026_ Hidden From AI Only");
    expect((await api("post", `/approvals/content/${content.approvalId}/decision`, aiOnly, { decision: "approve" })).status).toBe(403);
    const badges = (await api("get", "/nav/badges", aiOnly)).body.data.badges;
    expect(badges.approvals).toBe(summary.total);
    expect(badges).not.toHaveProperty("myWork"); // no automation.read

    const all = await api("get", "/approvals?status=pending", adminToken);
    expect(all.body.data.sources).toEqual(["ai", "automation", "content"]);
    expect((await api("get", "/approvals", portalToken)).status).toBe(403);
  });

  it("nav badges: counts only what the caller may see, cached ~30s, cleared by a decision", async () => {
    clearNavBadgeCache();
    const ai = await seedAi("QA_TEST_2026_badge");
    const first = (await api("get", "/nav/badges", adminToken)).body.data.badges;
    expect(first.approvals).toBeGreaterThan(0);
    expect(typeof first.notifications).toBe("number");
    expect(typeof first.myWork).toBe("number");
    await seedAi("QA_TEST_2026_badge2");
    expect((await api("get", "/nav/badges", adminToken)).body.data.badges.approvals).toBe(first.approvals); // served from cache
    await api("post", `/approvals/ai/${ai.id}/decision`, adminToken, { decision: "reject", comment: "x" });
    expect((await api("get", "/nav/badges", adminToken)).body.data.badges.approvals).toBe(first.approvals); // +1 new, -1 decided, cache cleared
    expect((await api("get", "/nav/badges", otherAdminToken)).body.data.badges.approvals).toBe(0 + (await prisma.aIApprovalRequest.count({ where: { organizationId: (await prisma.user.findFirst({ where: { email: "qa-other@example.com" } }))!.organizationId, status: "PENDING" } })));
  });
});
