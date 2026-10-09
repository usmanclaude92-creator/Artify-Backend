/** Step 14: role-aware Dashboard, marketing funnel, CSV export, saved views and scheduled reports (real DB, real services). */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp, finalizeApp } from "../../server/app/app";
import { disconnectPrisma, prisma } from "../../server/db/prisma";
import { resetDb } from "../helpers/db";
import { config } from "../../server/config/env";
import { compare, funnelFor, resolvePeriod, WIDGET_KEYS, WIDGET_PERMISSION, canRead } from "../../server/services/dashboard/dashboardService";
import { nextRunAfter, reportService } from "../../server/services/dashboard/reportService";

const ORG = config.publicWebsiteOrganizationId;
const DAY = 86_400_000;

describe("Step 14 dashboard, funnel and reports", () => {
  const app = createApp();
  finalizeApp(app);
  let ip = 10;
  let adminTok = "", adminId = "";
  const toks: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const call = (method: "get" | "post" | "put" | "patch" | "delete", path: string, token: string, body?: object) => {
    const r = request(app)[method](`/api/v1${path}`).set("Authorization", `Bearer ${token}`).set("X-Forwarded-For", `10.14.0.${ip++}`);
    return method === "get" || method === "delete" ? r : r.send(body ?? {});
  };
  const login = async (email: string) => (await request(app).post("/api/v1/auth/login").set("X-Forwarded-For", `10.14.1.${ip++}`).send({ email, password: "Str0ng-Passphrase-77" })).body.data.session.token as string;
  async function member(key: string) {
    const email = `qa-dash-${key.toLowerCase()}@example.com`;
    const r = await call("post", "/users", adminTok, { email, password: "Str0ng-Passphrase-77", firstName: "QA", lastName: key, roleKey: key });
    expect(r.status).toBe(201);
    ids[key] = r.body.data.user.id;
    toks[key] = await login(email);
  }
  const widgets = async (key: string, period = 28) => {
    const r = await call("get", `/dashboard?period=${period}`, toks[key]!);
    expect(r.status).toBe(200);
    return Object.fromEntries((r.body.data.widgets as any[]).map((w) => [w.key, w])) as Record<string, any>;
  };

  beforeAll(async () => {
    await resetDb();
    await prisma.dashboardReportSchedule.deleteMany({});
    await prisma.dashboardView.deleteMany({});
    await prisma.dashboardReportSetting.deleteMany({});
    expect(ORG).toBeTruthy();
    await prisma.organization.create({ data: { id: ORG, name: "QA_TEST_2026_ Dash", slug: "qa-dash" } });
    const reg = await request(app).post("/api/v1/auth/register").set("X-Forwarded-For", "10.14.2.1").send({ email: "qa-dash-admin@example.com", password: "Str0ng-Passphrase-77", firstName: "QA", lastName: "Admin", organizationName: "QA_TEST_2026_ Dash Org" });
    adminTok = reg.body.data.session.token; adminId = reg.body.data.user.id;
    await prisma.user.update({ where: { id: adminId }, data: { organizationId: ORG } });
    await prisma.session.updateMany({ where: { userId: adminId }, data: { organizationId: ORG } });
    await prisma.organizationMembership.updateMany({ where: { userId: adminId }, data: { organizationId: ORG } });
    for (const k of ["MANAGER", "USER", "VIEWER"]) await member(k);
    toks.ADMIN = adminTok; ids.ADMIN = adminId;
  });
  afterAll(async () => { await prisma.dashboardReportSchedule.deleteMany({}); await prisma.dashboardView.deleteMany({}); await prisma.dashboardReportSetting.deleteMany({}); await disconnectPrisma(); });

  it("grants reports.manage to ADMIN and SUPER_ADMIN only", async () => {
    const rows = await prisma.rolePermission.findMany({ where: { permission: { key: "reports.manage" } }, include: { role: true } });
    expect(rows.map((r) => r.role.key).sort()).toEqual(["ADMIN", "SUPER_ADMIN"]);
  });

  describe("permission matrix", () => {
    it("shows exactly the widgets each role may read, and nothing is computed for the rest", async () => {
      for (const key of ["ADMIN", "MANAGER", "USER", "VIEWER"]) {
        const perms = (await prisma.rolePermission.findMany({ where: { role: { key } }, include: { permission: true } })).map((r) => r.permission.key);
        const w = await widgets(key);
        for (const k of WIDGET_KEYS) {
          const expected = canRead({ role: { key, permissions: perms } }, WIDGET_PERMISSION[k]);
          expect(w[k].state === "forbidden", `${key}/${k}`).toBe(!expected);
          if (!expected) { expect(w[k].data).toBeUndefined(); expect(w[k].csv).toBeUndefined(); }
        }
      }
      const admin = await widgets("ADMIN");
      expect(Object.values(admin).filter((x: any) => x.state === "forbidden")).toHaveLength(0);
      const viewer = await widgets("VIEWER");
      expect(viewer.social_analytics.state).toBe("forbidden");
      expect(viewer.operations.state).toBe("forbidden");
      expect(viewer.attention_health.state).toBe("forbidden");
      const manager = await widgets("MANAGER");
      expect(manager.operations.state).toBe("forbidden");
    });
    it("refuses anonymous callers and client portal users", async () => {
      expect((await request(app).get("/api/v1/dashboard")).status).toBe(401);
      const cp = await call("post", "/users", adminTok, { email: "qa-dash-portal@example.com", password: "Str0ng-Passphrase-77", firstName: "QA", lastName: "Portal", roleKey: "CLIENT_PORTAL" });
      if (cp.status === 201) {
        const t = await login("qa-dash-portal@example.com");
        expect((await call("get", "/dashboard", t)).status).toBe(403);
        expect((await call("get", "/dashboard/views", t)).status).toBe(403);
      } else {
        // The role cannot be assigned through /users; assert the guard directly.
        const role = await prisma.role.findUniqueOrThrow({ where: { key: "CLIENT_PORTAL" } });
        const u = await prisma.user.create({ data: { organizationId: ORG, email: "qa-dash-portal@example.com", passwordHash: "x", firstName: "Q", lastName: "P", roleId: role.id } });
        await prisma.organizationMembership.create({ data: { userId: u.id, organizationId: ORG, roleId: role.id } });
        const crypto = await import("node:crypto");
        const token = "art_sess_" + crypto.randomBytes(24).toString("hex");
        await prisma.session.create({ data: { userId: u.id, organizationId: ORG, tokenHash: crypto.createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + DAY) } as never });
        expect((await call("get", "/dashboard", token)).status).toBe(403);
      }
    });
  });

  describe("empty states and as-of times", () => {
    it("says why a widget is empty instead of showing zeros", async () => {
      const w = await widgets("ADMIN");
      expect(w.website.state).toBe("empty");
      expect(w.website.emptyText).toBe("No website traffic has been recorded yet.");
      expect(w.crm.state).toBe("empty");
      expect(w.landing.emptyText).toBe("No landing page has been published.");
      expect(w.funnel.state).toBe("empty");
      expect(w.social_accounts.emptyText).toBe("No social account is connected.");
      expect(w.social_analytics.state).toBe("empty");
      expect(w.attention_approvals.emptyText).toBe("Nothing is waiting for your approval.");
      expect(w.attention_posts.state).toBe("empty");
      expect(w.operations.emptyText).toBe("Health has not been recorded yet.");
    });
    it("stamps every widget with a valid as-of time and a source", async () => {
      const r = await call("get", "/dashboard?period=7", adminTok);
      const before = Date.now();
      for (const x of r.body.data.widgets as any[]) {
        expect(Number.isNaN(Date.parse(x.asOf))).toBe(false);
        expect(Math.abs(before - Date.parse(x.asOf))).toBeLessThan(60_000);
        if (x.state !== "forbidden") expect(x.source.length).toBeGreaterThan(0);
      }
      expect(r.body.data.period.days).toBe(7);
    });
    it("rejects an unsupported period", async () => {
      expect((await call("get", "/dashboard?period=13", adminTok)).status).toBe(400);
    });
  });

  describe("numbers match their source pages", () => {
    beforeAll(async () => {
      const now = Date.now();
      // 12 page views in the last 7 days from 3 sessions, 6 on a landing page; 4 earlier (previous period); first row 20 days ago so a 7-day compare is covered.
      const ev = (path: string, session: string, ageDays: number, src: string | null) => ({ organizationId: ORG, eventType: "page_view", path, sessionId: session, utmSource: src, createdAt: new Date(now - ageDays * DAY - 3600_000) });
      const rows = [
        ...Array.from({ length: 6 }, (_, i) => ev("/", `s${i % 3}`, 1 + (i % 5), null)),
        ...Array.from({ length: 6 }, (_, i) => ev("/lp/qa-page", `l${i % 2}`, 1 + (i % 5), i < 4 ? "linkedin" : null)),
        ...Array.from({ length: 4 }, (_, i) => ev("/", `p${i}`, 8 + i, null)),
        ev("/", "old", 20, null),
      ];
      await prisma.analyticsEvent.createMany({ data: rows });
      const mk = (status: "NEW" | "QUALIFIED" | "CONVERTED" | "LOST", src: string | null, source: string | null, age: number) => ({ organizationId: ORG, companyName: `QA_TEST_2026_ ${status}${age}${src}`, status, utmSource: src, source, createdAt: new Date(now - age * DAY - 3600_000) });
      await prisma.lead.createMany({ data: [mk("NEW", "linkedin", "landing:qa-page:linkedin", 1), mk("QUALIFIED", "linkedin", "landing:qa-page:linkedin", 2), mk("CONVERTED", null, "landing:qa-page", 3), mk("NEW", null, "website", 2), mk("LOST", null, null, 20)] });
      const page = await prisma.page.create({ data: { organizationId: ORG, title: "QA_TEST_2026_ LP", slug: "qa-page", landingBuilder: true, status: "PUBLISHED" } as never });
      const form = await prisma.form.create({ data: { organizationId: ORG, name: "QA_TEST_2026_ LP form", slug: "qa-lp-form", fields: [], landingPageId: page.id } as never });
      await prisma.formSubmission.createMany({ data: [0, 1, 2].map((i) => ({ formId: form.id, organizationId: ORG, data: {}, utmSource: i < 2 ? "linkedin" : null, createdAt: new Date(now - (1 + i) * DAY) })) });
    });

    it("website numbers equal the Analytics page (same stored events)", async () => {
      const w = (await widgets("ADMIN", 7)).website;
      expect(w.data.views.current).toBe(12);
      expect(w.data.sessions.current).toBe(5); // s0,s1,s2,l0,l1
      const analytics = await call("get", `/analytics/overview?from=${resolvePeriod(7).info.from}T00:00:00.000Z&to=${new Date(resolvePeriod(7).end.getTime() - 1).toISOString()}`, adminTok);
      expect(analytics.status).toBe(200);
      expect(analytics.body.data.website.pageViews).toBe(12);
      expect(w.sourceAsOf).toBeTruthy();
      expect(w.data.topPages[0]).toEqual({ path: expect.any(String), views: 6 });
    });
    it("compares with the previous period only when it is fully covered", async () => {
      const w7 = (await widgets("ADMIN", 7)).website; // earliest event is 20 days old, prev period starts 14 days ago -> covered
      expect(w7.data.views.previous).toBe(4);
      expect(w7.data.views.changePct).toBe(200);
      const w28 = (await widgets("ADMIN", 28)).website; // prev period starts 56 days ago, data begins 20 days ago -> not covered
      expect(w28.data.views.changePct).toBeNull();
      expect(w28.data.views.note).toMatch(/Comparison needs data from/);
    });
    it("compare() never invents a percentage", () => {
      const start = new Date("2026-01-01T00:00:00Z");
      expect(compare(5, 0, new Date("2025-12-01"), start).changePct).toBeNull();
      expect(compare(5, 4, null, start).note).toMatch(/Nothing has been stored/);
      expect(compare(5, 4, new Date("2026-02-01"), start).changePct).toBeNull();
      expect(compare(6, 4, new Date("2025-12-01"), start).changePct).toBe(50);
    });
    it("CRM leads equal the CRM summary page", async () => {
      const crm = (await widgets("ADMIN", 7)).crm;
      const summary = await call("get", "/crm/summary", adminTok);
      expect(crm.data.leads.total).toBe(summary.body.data.leads.total);
      expect(crm.data.leads.byStatus.QUALIFIED).toBe(summary.body.data.leads.qualified);
      expect(crm.data.leads.createdInPeriod.current).toBe(4);
    });
    it("landing numbers equal the per-page stats", async () => {
      const l = (await widgets("ADMIN", 7)).landing;
      const page = await prisma.page.findFirstOrThrow({ where: { slug: "qa-page" } });
      const stats = await call("get", `/marketing/landing-pages/${page.id}/stats?days=7`, adminTok);
      expect(stats.status).toBe(200);
      expect(l.data.views.current).toBe(stats.body.data.stats.views);
      expect(l.data.submissions.current).toBe(stats.body.data.stats.submissions);
      expect(l.data.sessions.current).toBe(stats.body.data.stats.uniqueSessions);
      expect(l.data.conversionRate).toBe(stats.body.data.stats.conversionRate);
    });
    it("funnel counts by UTM source from our own tables", async () => {
      const f = (await widgets("ADMIN", 7)).funnel;
      expect(f.state).toBe("ok");
      const by = Object.fromEntries(f.data.rows.map((r: any) => [r.source, r]));
      expect(by.linkedin).toMatchObject({ sessions: 1, submissions: 2, leads: 2, qualified: 1, converted: 0 });
      expect(by["(direct / none)"]).toMatchObject({ sessions: 1, submissions: 1, leads: 1, converted: 1 });
      expect(f.data.totals).toMatchObject({ sessions: 2, submissions: 3, leads: 3, qualified: 1, converted: 1 });
      expect(f.data.note).toMatch(/Counts, not rates/);
    });
    it("hides the CRM funnel stages from someone without leads.read", async () => {
      const f = await funnelFor({ id: "x", organizationId: ORG, role: { key: "X", id: "", name: "", permissions: ["marketing.landing.read"] } } as never, ORG, resolvePeriod(7));
      expect((f.data as any).stages).toEqual(["sessions", "submissions"]);
      expect((f.data as any).rows[0]).not.toHaveProperty("leads");
    });
  });

  describe("CSV export and saved views", () => {
    it("exports a widget as CSV with the same numbers, audited", async () => {
      const r = await call("get", "/dashboard/export/website.csv?period=7", adminTok);
      expect(r.status).toBe(200);
      expect(r.headers["content-type"]).toMatch(/text\/csv/);
      expect(r.text).toContain('"page_views","12"');
      expect(await prisma.auditLog.count({ where: { action: "dashboard.export", actorUserId: adminId } })).toBeGreaterThan(0);
    });
    it("blocks an export the role cannot read, and unknown widgets", async () => {
      expect((await call("get", "/dashboard/export/operations.csv", toks.VIEWER!)).status).toBe(403);
      expect((await call("get", "/dashboard/export/nope.csv", adminTok)).status).toBe(404);
    });
    it("keeps saved views personal", async () => {
      const c = await call("post", "/dashboard/views", toks.MANAGER!, { name: "Weekly", period: 7 });
      expect(c.status).toBe(201);
      expect((await call("get", "/dashboard/views", toks.MANAGER!)).body.data.views).toHaveLength(1);
      expect((await call("get", "/dashboard/views", adminTok)).body.data.views).toHaveLength(0);
      expect((await call("delete", `/dashboard/views/${c.body.data.view.id}`, adminTok)).status).toBe(404);
      expect((await call("delete", `/dashboard/views/${c.body.data.view.id}`, toks.MANAGER!)).status).toBe(200);
      expect((await call("post", "/dashboard/views", adminTok, { name: "x", period: 5 })).status).toBe(400);
    });
  });

  describe("scheduled reports", () => {
    let scheduleId = "";
    const sched = (over: object = {}) => ({ name: "QA weekly", cadence: "WEEKLY", sections: ["website", "crm"], recipientIds: [ids.MANAGER], periodDays: 7, ...over });

    it("is reports.manage only", async () => {
      for (const t of [toks.MANAGER!, toks.USER!, toks.VIEWER!]) {
        expect((await call("get", "/dashboard/reports/schedules", t)).status).toBe(403);
        expect((await call("post", "/dashboard/reports/schedules", t, sched())).status).toBe(403);
        expect((await call("put", "/dashboard/reports/settings", t, { killSwitch: true })).status).toBe(403);
      }
      expect((await call("get", "/dashboard/reports/schedules", adminTok)).status).toBe(200);
    });
    it("rejects recipients who cannot read a selected section, and non-members", async () => {
      const bad = await call("post", "/dashboard/reports/schedules", adminTok, sched({ sections: ["operations"], recipientIds: [ids.MANAGER] }));
      expect(bad.status).toBe(400);
      expect(bad.body.error.message).toMatch(/does not have permission/);
      const none = await call("post", "/dashboard/reports/schedules", adminTok, sched({ recipientIds: ["00000000-0000-4000-8000-000000000000"] }));
      expect(none.status).toBe(400);
    });
    it("creates schedules in dry-run by default", async () => {
      const r = await call("post", "/dashboard/reports/schedules", adminTok, sched());
      expect(r.status).toBe(201);
      expect(r.body.data.schedule.dryRun).toBe(true);
      expect(new Date(r.body.data.schedule.nextRunAt).getUTCDay()).toBe(1);
      scheduleId = r.body.data.schedule.id;
      expect(await prisma.auditLog.count({ where: { action: "dashboard.reports.schedule_create" } })).toBe(1);
    });
    it("dry run renders per recipient but delivers nothing", async () => {
      const r = await call("post", `/dashboard/reports/schedules/${scheduleId}/run`, adminTok);
      expect(r.status).toBe(200);
      expect(r.body.data.status).toBe("DRY_RUN");
      const d = await prisma.dashboardReportDelivery.findMany({ where: { runId: r.body.data.runId } });
      expect(d).toHaveLength(1);
      expect(d[0]!.outcome).toBe("DRY_RUN");
      expect(d[0]!.html).toContain("Website");
      expect(await prisma.notification.count({ where: { userId: ids.MANAGER, type: "dashboard_report" } })).toBe(0);
      expect((await call("get", "/dashboard/reports/inbox", toks.MANAGER!)).body.data.reports).toHaveLength(0);
    });
    it("a real run delivers in-app, each recipient seeing only what they may read", async () => {
      // Created in dry-run with the section both can read, then a recipient loses access (role changed) before the real run.
      await call("patch", `/dashboard/reports/schedules/${scheduleId}`, adminTok, { dryRun: false, sections: ["website", "crm"], recipientIds: [ids.MANAGER, ids.VIEWER] });
      const viewerRole = await prisma.role.findUniqueOrThrow({ where: { key: "VIEWER" } });
      const crmPerm = await prisma.permission.findMany({ where: { key: { in: ["leads.read", "opportunities.read"] } } });
      // Remove CRM visibility from VIEWER for this test, restore afterwards.
      const removed = await prisma.rolePermission.findMany({ where: { roleId: viewerRole.id, permissionId: { in: crmPerm.map((p) => p.id) } } });
      await prisma.rolePermission.deleteMany({ where: { id: { in: removed.map((r) => r.id) } } });
      try {
        const r = await call("post", `/dashboard/reports/schedules/${scheduleId}/run`, adminTok);
        expect(r.body.data.status).toBe("SENT");
        const m = await prisma.dashboardReportDelivery.findFirstOrThrow({ where: { runId: r.body.data.runId, userId: ids.MANAGER } });
        const v = await prisma.dashboardReportDelivery.findFirstOrThrow({ where: { runId: r.body.data.runId, userId: ids.VIEWER } });
        expect(m.outcome).toBe("DELIVERED");
        expect(m.sections).toEqual(["website", "crm"]);
        expect(m.channels).toEqual(["IN_APP"]);
        expect(v.sections).toEqual(["website"]);
        expect(v.html).not.toContain("<h2>CRM</h2>");
        expect(m.html).toContain("<h2>CRM</h2>");
        expect(await prisma.notification.count({ where: { userId: ids.MANAGER, type: "dashboard_report" } })).toBe(1);
        // Download: only the recipient.
        expect((await call("get", `/dashboard/reports/deliveries/${m.id}/download`, toks.MANAGER!)).status).toBe(200);
        expect((await call("get", `/dashboard/reports/deliveries/${m.id}/download`, toks.VIEWER!)).status).toBe(404);
        expect((await call("get", `/dashboard/reports/deliveries/${m.id}/download`, adminTok)).status).toBe(404);
      } finally {
        await prisma.rolePermission.createMany({ data: removed.map((x) => ({ roleId: x.roleId, permissionId: x.permissionId })), skipDuplicates: true });
      }
    });
    it("skips a recipient who can no longer read any section", async () => {
      await prisma.dashboardReportSchedule.update({ where: { id: scheduleId }, data: { sections: ["operations"], recipientIds: [ids.MANAGER], dryRun: false } });
      const r = await reportService.run(scheduleId, "MANUAL");
      expect(r.outcomes).toEqual([{ userId: ids.MANAGER, outcome: "SKIPPED_NO_PERMISSION" }]);
      await prisma.dashboardReportSchedule.update({ where: { id: scheduleId }, data: { sections: ["website", "crm"] } });
    });
    it("kill switch stops scheduled runs and test sends, and is audited", async () => {
      expect((await call("put", "/dashboard/reports/settings", adminTok, { killSwitch: true })).body.data.killSwitch).toBe(true);
      const before = await prisma.notification.count({ where: { type: "dashboard_report" } });
      const r = await call("post", `/dashboard/reports/schedules/${scheduleId}/run`, adminTok);
      expect(r.body.data.status).toBe("KILLED");
      expect(r.body.data.outcomes).toEqual([]);
      expect((await call("post", `/dashboard/reports/schedules/${scheduleId}/send-test`, adminTok)).status).toBe(400);
      expect(await prisma.notification.count({ where: { type: "dashboard_report" } })).toBe(before);
      expect(await prisma.auditLog.count({ where: { action: "dashboard.reports.kill_switch_on" } })).toBe(1);
      await call("put", "/dashboard/reports/settings", adminTok, { killSwitch: false });
    });
    it("send-test delivers one copy to the caller only", async () => {
      const before = await prisma.notification.count({ where: { userId: ids.MANAGER, type: "dashboard_report" } });
      const r = await call("post", `/dashboard/reports/schedules/${scheduleId}/send-test`, adminTok);
      expect(r.status).toBe(200);
      expect(r.body.data.channels).toEqual(["IN_APP"]);
      expect(r.body.data.emailConfigured).toBe(false);
      expect(await prisma.notification.count({ where: { userId: ids.MANAGER, type: "dashboard_report" } })).toBe(before);
      expect(await prisma.notification.count({ where: { userId: adminId, type: "dashboard_report" } })).toBe(1);
    });
    it("the scheduler tick runs only due, enabled schedules and records a heartbeat", async () => {
      await prisma.dashboardReportSchedule.update({ where: { id: scheduleId }, data: { nextRunAt: new Date(Date.now() - 1000), dryRun: true, enabled: true } });
      expect((await reportService.tick()).ran).toBe(1);
      const s = await prisma.dashboardReportSchedule.findUniqueOrThrow({ where: { id: scheduleId } });
      expect(s.nextRunAt!.getTime()).toBeGreaterThan(Date.now());
      expect((await prisma.jobHeartbeat.findUnique({ where: { key: "dashboard_reports" } }))?.lastStatus).toBe("ok");
      expect((await reportService.tick()).ran).toBe(0);
    });
    it("nextRunAfter lands on Monday 07:00 UTC weekly and the 1st monthly", () => {
      const w = nextRunAfter("WEEKLY", new Date("2026-10-21T10:00:00Z"));
      expect([w.getUTCDay(), w.getUTCHours()]).toEqual([1, 7]);
      expect(nextRunAfter("MONTHLY", new Date("2026-10-21T10:00:00Z")).toISOString()).toBe("2026-11-01T07:00:00.000Z");
    });
    it("never reuses another workspace's schedule", async () => {
      const other = await prisma.organization.create({ data: { name: "QA_TEST_2026_ Other", slug: "qa-dash-other" } });
      const s = await prisma.dashboardReportSchedule.create({ data: { organizationId: other.id, name: "x", cadence: "WEEKLY", sections: ["website"], recipientIds: [] } });
      expect((await call("post", `/dashboard/reports/schedules/${s.id}/run`, adminTok)).status).toBe(404);
      expect((await call("delete", `/dashboard/reports/schedules/${s.id}`, adminTok)).status).toBe(404);
    });
  });
});
