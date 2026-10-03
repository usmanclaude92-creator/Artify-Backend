/**
 * Phase 7 (Content Management upgrade) — verifies the real scheduled-publish
 * cron job (contentSchedulingService.publishDueScheduled, wired into
 * GET /api/v1/automation/internal/tick) actually promotes due SCHEDULED
 * Posts/Pages to PUBLISHED, and that its per-item failure handling is real:
 * content edited down to empty before the due time is skipped (left
 * SCHEDULED for a human to fix) rather than silently publishing empty
 * content, and one organization's due items are processed independently
 * of another's in the same tick.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp, finalizeApp } from "../../server/app/app";
import { disconnectPrisma, prisma } from "../../server/db/prisma";
import { resetDb } from "../helpers/db";
import { contentSchedulingService } from "../../server/services/contentSchedulingService";

describe("contentSchedulingService — real scheduled publishing + failure handling", () => {
  const app = createApp();
  finalizeApp(app);

  let orgAToken: string;
  let orgBToken: string;

  beforeAll(async () => {
    await resetDb();
    const a = await request(app).post("/api/v1/auth/register").send({
      email: "scheduler-a@example.com",
      password: "OriginalPassword123",
      firstName: "A",
      lastName: "Admin",
      organizationName: "Scheduler Org A",
    });
    orgAToken = a.body.data.session.token;

    const b = await request(app).post("/api/v1/auth/register").send({
      email: "scheduler-b@example.com",
      password: "OriginalPassword123",
      firstName: "B",
      lastName: "Admin",
      organizationName: "Scheduler Org B",
    });
    orgBToken = b.body.data.session.token;
  });

  afterAll(async () => {
    await disconnectPrisma();
  });

  async function scheduleAndBackdate(token: string, resourceKind: "posts" | "pages", title: string, body: string): Promise<string> {
    const created = await request(app).post(`/api/v1/${resourceKind}`).set("Authorization", `Bearer ${token}`).send({ title, body });
    const id = created.body.data[resourceKind === "posts" ? "post" : "page"].id;
    const future = new Date(Date.now() + 3_600_000).toISOString();
    const schedule = await request(app).post(`/api/v1/${resourceKind}/${id}/schedule`).set("Authorization", `Bearer ${token}`).send({ scheduledAt: future });
    expect(schedule.status).toBe(200);

    // Backdate directly in the DB — the schedule endpoint itself requires a
    // future timestamp, but the cron tick's own job is to catch items whose
    // time has since passed.
    const past = new Date(Date.now() - 60_000);
    if (resourceKind === "posts") await prisma.post.update({ where: { id }, data: { scheduledAt: past } });
    else await prisma.page.update({ where: { id }, data: { scheduledAt: past } });
    return id;
  }

  it("publishes a due SCHEDULED post and records a SYSTEM-actor audit entry", async () => {
    const id = await scheduleAndBackdate(orgAToken, "posts", "Due Post", "real content");

    const result = await contentSchedulingService.publishDueScheduled();
    expect(result.postsPublished).toBeGreaterThanOrEqual(1);

    const row = await prisma.post.findUnique({ where: { id } });
    expect(row?.status).toBe("PUBLISHED");
    expect(row?.scheduledAt).toBeNull();

    const audit = await prisma.auditLog.findFirst({ where: { action: "POST_PUBLISHED", resourceId: id, actorType: "SYSTEM" } });
    expect(audit).not.toBeNull();
    expect(audit?.actorUserId).toBeNull();
  });

  it("publishes a due SCHEDULED page the same way", async () => {
    const id = await scheduleAndBackdate(orgAToken, "pages", "Due Page", "real content");

    const result = await contentSchedulingService.publishDueScheduled();
    expect(result.pagesPublished).toBeGreaterThanOrEqual(1);

    const row = await prisma.page.findUnique({ where: { id } });
    expect(row?.status).toBe("PUBLISHED");
  });

  it("skips (never publishes empty content) a due post whose body was edited down to empty before the tick ran", async () => {
    const id = await scheduleAndBackdate(orgAToken, "posts", "Emptied Post", "will be cleared");
    await prisma.contentRevision.updateMany({ where: { postId: id }, data: { body: "", title: "" } });

    const result = await contentSchedulingService.publishDueScheduled();
    expect(result.skipped).toBeGreaterThanOrEqual(1);

    const row = await prisma.post.findUnique({ where: { id } });
    expect(row?.status).toBe("SCHEDULED");
  });

  it("processes due items across two different organizations independently in one tick", async () => {
    const idA = await scheduleAndBackdate(orgAToken, "posts", "Org A Due", "content a");
    const idB = await scheduleAndBackdate(orgBToken, "posts", "Org B Due", "content b");

    await contentSchedulingService.publishDueScheduled();

    const rowA = await prisma.post.findUnique({ where: { id: idA } });
    const rowB = await prisma.post.findUnique({ where: { id: idB } });
    expect(rowA?.status).toBe("PUBLISHED");
    expect(rowB?.status).toBe("PUBLISHED");
  });

  it("is idempotent: running the tick again with nothing newly due publishes nothing further", async () => {
    const before = await contentSchedulingService.publishDueScheduled();
    expect(before.postsPublished).toBe(0);
    expect(before.pagesPublished).toBe(0);
  });
});
