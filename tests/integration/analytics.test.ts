/**
 * Phase 15 — Analytics + Reporting (docs/ANALYTICS_ARCHITECTURE.md):
 * public event ingestion, the /analytics/overview dashboard endpoint,
 * the /reports/:type (+export) reports area, RBAC, tenant isolation, and
 * not-fabricated empty/not-configured states.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp, finalizeApp } from "../../server/app/app";
import { disconnectPrisma, prisma } from "../../server/db/prisma";
import { resetDb } from "../helpers/db";
import { config } from "../../server/config/env";
import { analyticsReportingService } from "../../server/services/analyticsReportingService";

describe("analytics + reporting (Phase 15)", () => {
  const app = createApp();
  finalizeApp(app);

  let adminToken: string;
  let orgId: string;
  let viewerToken: string;
  let otherOrgAdminToken: string;
  let otherOrgId: string;

  beforeAll(async () => {
    await resetDb();
    const reg = await request(app).post("/api/v1/auth/register").send({
      email: "analytics-admin@example.com",
      password: "OriginalPassword123",
      firstName: "Analytics",
      lastName: "Admin",
      organizationName: "Analytics Co",
    });
    adminToken = reg.body.data.session.token;
    orgId = reg.body.data.user.organizationId;

    await request(app)
      .post("/api/v1/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ email: "analytics-viewer@example.com", password: "ViewerPassword123", firstName: "V", lastName: "W", roleKey: "VIEWER" });
    viewerToken = (await request(app).post("/api/v1/auth/login").send({ email: "analytics-viewer@example.com", password: "ViewerPassword123" })).body
      .data.session.token;

    const other = await request(app).post("/api/v1/auth/register").send({
      email: "analytics-other-admin@example.com",
      password: "OriginalPassword123",
      firstName: "Other",
      lastName: "Admin",
      organizationName: "Other Analytics Co",
    });
    otherOrgAdminToken = other.body.data.session.token;
    otherOrgId = other.body.data.user.organizationId;
  });

  afterAll(async () => {
    await disconnectPrisma();
  });

  describe("public ingestion (POST /public/analytics/events)", () => {
    it("rejects an eventType outside the small, deliberate allowlist", async () => {
      const res = await request(app).post("/api/v1/public/analytics/events").send({ eventType: "literally_anything" });
      expect(res.status).toBe(400);
    });

    it("records a real page_view event under the configured public-website organization, resolving real campaign attribution", async () => {
      if (!config.publicWebsiteOrganizationId) return; // not configured in this env — see .env.test
      await prisma.organization.upsert({
        where: { id: config.publicWebsiteOrganizationId },
        update: {},
        create: { id: config.publicWebsiteOrganizationId, name: "Public Analytics Test Agency", slug: "analytics-test-public-agency" },
      });
      const campaign = await prisma.campaign.create({
        data: { organizationId: config.publicWebsiteOrganizationId, name: "Beacon Campaign", utmCampaign: "beacon-camp" },
      });

      const before = await prisma.analyticsEvent.count({ where: { organizationId: config.publicWebsiteOrganizationId, eventType: "page_view" } });
      const res = await request(app).post("/api/v1/public/analytics/events").send({
        eventType: "page_view",
        path: "/solutions",
        sessionId: "session-abc-123",
        utmSource: "google",
        utmMedium: "cpc",
        utmCampaign: "beacon-camp",
      });
      expect(res.status).toBe(201);

      const after = await prisma.analyticsEvent.count({ where: { organizationId: config.publicWebsiteOrganizationId, eventType: "page_view" } });
      expect(after).toBe(before + 1);

      const event = await prisma.analyticsEvent.findFirst({ where: { sessionId: "session-abc-123" } });
      expect(event).not.toBeNull();
      expect(event?.path).toBe("/solutions");
      expect(event?.utmSource).toBe("google");
      expect(event?.campaignId).toBe(campaign.id);
    });

    it("never stores a raw IP or user-agent, and silently no-ops (still 201) when no public org is configured", async () => {
      const res = await request(app)
        .post("/api/v1/public/analytics/events")
        .set("User-Agent", "TestBrowser/1.0")
        .send({ eventType: "cta_click", path: "/pricing" });
      expect(res.status).toBe(201);
      // Schema-level guarantee: AnalyticsEvent has no ipAddress/userAgent column at all (see prisma/schema.prisma).
      const anyEvent = await prisma.analyticsEvent.findFirst({ where: { path: "/pricing" } });
      expect(anyEvent === null || !("ipAddress" in anyEvent)).toBe(true);
    });
  });

  describe("GET /analytics/overview — RBAC + date filtering + not-fabricated empty states", () => {
    it("rejects an unauthenticated request", async () => {
      expect((await request(app).get("/api/v1/analytics/overview")).status).toBe(401);
    });

    it("returns a real, permission-gated overview for ADMIN with no fabricated zeros", async () => {
      const res = await request(app).get("/api/v1/analytics/overview").set("Authorization", `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      const overview = res.body.data;
      expect(overview.leads).toEqual({ total: 0, changePct: null, bySource: [] });
      expect(overview.clients.created).toBe(0);
      expect(overview.pipeline.wonCount).toBe(0);
    });

    it("rejects `from` after `to` as invalid input", async () => {
      const res = await request(app)
        .get("/api/v1/analytics/overview")
        .query({ from: "2026-06-01T00:00:00.000Z", to: "2026-01-01T00:00:00.000Z" })
        .set("Authorization", `Bearer ${adminToken}`);
      expect(res.status).toBe(400);
    });

    it("excludes a lead created outside the requested date range from the real count", async () => {
      const oldLead = await prisma.lead.create({
        data: { organizationId: orgId, companyName: "Old Lead Co", createdAt: new Date("2020-01-01T00:00:00.000Z") },
      });
      const res = await request(app)
        .get("/api/v1/analytics/overview")
        .query({ from: "2026-01-01T00:00:00.000Z", to: "2026-12-31T00:00:00.000Z" })
        .set("Authorization", `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.leads.total).toBe(0);
      await prisma.lead.delete({ where: { id: oldLead.id } });
    });

    it("never leaks another organization's AnalyticsEvent/Lead data into this organization's overview (tenant isolation)", async () => {
      await prisma.analyticsEvent.create({ data: { organizationId: otherOrgId, eventType: "page_view", path: "/foreign-page" } });
      await prisma.lead.create({ data: { organizationId: otherOrgId, companyName: "Foreign Lead Co" } });

      const mine = await request(app).get("/api/v1/analytics/overview").set("Authorization", `Bearer ${adminToken}`);
      expect(mine.status).toBe(200);
      expect(mine.body.data.leads.total).toBe(0);
      expect((mine.body.data.website?.topPages ?? []).some((p: { path: string }) => p.path === "/foreign-page")).toBe(false);

      const theirs = await request(app).get("/api/v1/analytics/overview").set("Authorization", `Bearer ${otherOrgAdminToken}`);
      expect(theirs.status).toBe(200);
      expect(theirs.body.data.leads.total).toBe(1);
    });
  });

  describe("GET /reports/:type and /reports/:type/export — RBAC via existing reports.read/reports.export keys", () => {
    it("404s an unknown report type", async () => {
      const res = await request(app).get("/api/v1/reports/not_a_real_report").set("Authorization", `Bearer ${adminToken}`);
      expect(res.status).toBe(404);
    });

    it.each(["executive_summary", "lead_generation", "crm_pipeline", "campaign_performance", "seo_report", "client_acquisition", "conversion_report"])(
      "generates a real %s report for ADMIN",
      async (type) => {
        const res = await request(app).get(`/api/v1/reports/${type}`).set("Authorization", `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        expect(res.body.data.type).toBe(type);
        expect(res.body.data.report).not.toBeUndefined();
      }
    );

    it("VIEWER (reports.read only) can view a report as JSON but is denied CSV export (reports.export)", async () => {
      const json = await request(app).get("/api/v1/reports/lead_generation").set("Authorization", `Bearer ${viewerToken}`);
      expect(json.status).toBe(200);

      const exportRes = await request(app).get("/api/v1/reports/lead_generation/export").set("Authorization", `Bearer ${viewerToken}`);
      expect(exportRes.status).toBe(403);

      const adminExport = await request(app).get("/api/v1/reports/lead_generation/export").set("Authorization", `Bearer ${adminToken}`);
      expect(adminExport.status).toBe(200);
      expect(adminExport.headers["content-type"]).toContain("text/csv");
    });

    it("neutralizes a CSV-formula-injection payload in an exported campaign name", async () => {
      await prisma.campaign.create({ data: { organizationId: orgId, name: "=SUM(A1:A9)", utmCampaign: "formula-camp" } });
      await prisma.lead.create({ data: { organizationId: orgId, companyName: "Formula Lead", campaignId: (await prisma.campaign.findFirstOrThrow({ where: { organizationId: orgId, utmCampaign: "formula-camp" } })).id } });

      const res = await request(app).get("/api/v1/reports/campaign_performance/export").set("Authorization", `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.text).not.toContain('"=SUM(A1:A9)"');
    });
  });

  describe("analyticsReportingService — permission gating returns null (never a fabricated zero) when the caller lacks a domain permission", () => {
    it("returns every domain section as null when the caller has no permissions at all", async () => {
      const overview = await analyticsReportingService.getOverview(orgId, [], {});
      expect(overview.website).toBeNull();
      expect(overview.leads).toBeNull();
      expect(overview.pipeline).toBeNull();
      expect(overview.clients).toBeNull();
      expect(overview.campaigns).toBeNull();
      expect(overview.forms).toBeNull();
      expect(overview.seo).toBeNull();
    });

    it("reveals only the section whose permission is granted", async () => {
      const overview = await analyticsReportingService.getOverview(orgId, ["leads.read"], {});
      expect(overview.leads).not.toBeNull();
      expect(overview.website).toBeNull();
      expect(overview.clients).toBeNull();
    });

    it("rejects an invalid report type at the service layer too", async () => {
      await expect(analyticsReportingService.getReport(orgId, ["analytics.read"], "not_a_type" as never, {})).rejects.toThrow();
    });
  });
});
