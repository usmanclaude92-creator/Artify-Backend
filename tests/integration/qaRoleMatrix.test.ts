/**
 * Step 14 QA (a): every sidebar permission, against the real API, for all six roles.
 * For each (permission -> representative endpoint): a role that lacks the permission must get 403, a role that holds it must NOT get 401/403/5xx,
 * and an anonymous caller must get 401. The expectation is derived from the role's permission rows in the DB, not hard-coded.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import { createApp, finalizeApp } from "../../server/app/app";
import { disconnectPrisma, prisma } from "../../server/db/prisma";
import { resetDb } from "../helpers/db";
import { config } from "../../server/config/env";

type Probe = { method: "get" | "post" | "patch"; path: string; body?: object; /** roles that pass the permission guard but are refused later by the service (documented) */ serviceRefuses?: string[] };
/** nav permission -> an endpoint that is guarded by exactly that permission (POST {} is used where the guard precedes validation, so authorised callers get 400). */
const PROBES: Record<string, Probe> = {
  "automation.read": { method: "get", path: "/automation/workflows" },
  "approvals.read": { method: "get", path: "/approvals" },
  "security.read": { method: "get", path: "/admin/overview" },
  "users.read": { method: "get", path: "/users" },
  "roles.read": { method: "get", path: "/roles" },
  "organizations.read": { method: "get", path: "/organizations" },
  "audit.read": { method: "get", path: "/audit-logs" },
  "ops.health.read": { method: "get", path: "/ops/health" },
  "reports.manage": { method: "get", path: "/dashboard/reports/schedules" },
  "ops.backups.read": { method: "get", path: "/ops/backups" },
  "privacy.read": { method: "get", path: "/privacy/requests" },
  "settings.read": { method: "get", path: "/settings" },
  "leads.read": { method: "get", path: "/leads" },
  "clients.read": { method: "get", path: "/clients" },
  "contacts.read": { method: "get", path: "/contacts" },
  "opportunities.read": { method: "get", path: "/opportunities" },
  "onboarding.read": { method: "get", path: "/onboarding" },
  "workspaces.read": { method: "get", path: "/workspaces" },
  "products.read": { method: "get", path: "/products" },
  "product_modules.read": { method: "get", path: "/product-modules/00000000-0000-4000-8000-000000000000" },
  "templates.read": { method: "get", path: "/templates" },
  "template_parts.read": { method: "get", path: "/template-parts" },
  "navigation_menus.read": { method: "get", path: "/navigation-menus" },
  "content.read": { method: "get", path: "/pages" },
  "authors.read": { method: "get", path: "/authors" },
  "media.read": { method: "get", path: "/media" },
  "seo.audit.read": { method: "get", path: "/seo/issues" },
  "seo.redirects.read": { method: "get", path: "/redirects" },
  "campaigns.read": { method: "get", path: "/campaigns" },
  "marketing.landing.read": { method: "get", path: "/marketing/landing-pages" },
  "forms.read": { method: "get", path: "/forms" },
  "analytics.read": { method: "get", path: "/analytics/overview" },
  "reports.read": { method: "get", path: "/reports/leads" },
  "contracts.read": { method: "get", path: "/contracts" },
  "subscriptions.read": { method: "get", path: "/subscriptions" },
  "invoices.read": { method: "get", path: "/invoices" },
  "payments.read": { method: "get", path: "/payments" },
  "ai.providers.read": { method: "get", path: "/ai/providers" },
  "ai.tools.read": { method: "get", path: "/ai/tools" },
  "ai.prompts.read": { method: "get", path: "/ai/prompts" },
  "ai.workflows.read": { method: "get", path: "/ai/workflows" },
  "ai.executions.read": { method: "get", path: "/ai/executions" },
  "ai.usage.read": { method: "get", path: "/ai/usage" },
  "ai.approvals.read": { method: "get", path: "/ai/approvals" },
  "social.read": { method: "get", path: "/social/accounts" },
  "social.listening.read": { method: "get", path: "/social/listening" },
  "social.analytics.read": { method: "get", path: "/social/analytics/summary" },
  "social.publish": { method: "post", path: "/social/posts", body: {} },
  "content.update": { method: "patch", path: "/pages/00000000-0000-4000-8000-000000000000", body: {} },
};
const ROLES = ["SUPER_ADMIN", "ADMIN", "MANAGER", "USER", "VIEWER", "CLIENT_PORTAL"] as const;

describe("QA role x API matrix", () => {
  const app = createApp();
  finalizeApp(app);
  const tokens: Record<string, string> = {};
  const perms: Record<string, Set<string>> = {};
  let ip = 1;

  beforeAll(async () => {
    await resetDb();
    // The platform-level pages (System Health, Backups) are limited to the main workspace, so the matrix runs inside it.
    const org = await prisma.organization.create({ data: { id: config.publicWebsiteOrganizationId || undefined, name: "QA_TEST_2026_ Matrix", slug: "qa-matrix" } });
    for (const key of ROLES) {
      const role = await prisma.role.findUniqueOrThrow({ where: { key }, include: { rolePermissions: { include: { permission: true } } } });
      perms[key] = new Set(role.rolePermissions.map((rp) => rp.permission.key));
      const u = await prisma.user.create({ data: { organizationId: org.id, email: `qa-matrix-${key.toLowerCase()}@example.com`, passwordHash: "!disabled!", firstName: "QA", lastName: key, roleId: role.id, emailVerifiedAt: new Date() } });
      await prisma.organizationMembership.create({ data: { userId: u.id, organizationId: org.id, roleId: role.id } });
      const token = "art_sess_" + crypto.randomBytes(24).toString("hex");
      await prisma.session.create({ data: { userId: u.id, organizationId: org.id, tokenHash: crypto.createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 3600_000) } });
      tokens[key] = token;
    }
  });
  afterAll(async () => { await disconnectPrisma(); });

  const hit = (p: Probe, token?: string) => {
    const r = request(app)[p.method](`/api/v1${p.path}`).set("X-Forwarded-For", `10.15.0.${ip++ % 250}`);
    if (token) r.set("Authorization", `Bearer ${token}`);
    return p.method === "get" ? r : r.send(p.body ?? {});
  };

  it("covers every permission the sidebar uses", () => {
    expect(Object.keys(PROBES).length).toBeGreaterThanOrEqual(45);
  });

  for (const [perm, probe] of Object.entries(PROBES)) {
    it(`${perm}  ->  ${probe.method.toUpperCase()} ${probe.path}`, async () => {
      expect((await hit(probe)).status, "anonymous").toBe(401);
      for (const role of ROLES) {
        const allowed = role === "SUPER_ADMIN" || perms[role]!.has(perm);
        const res = await hit(probe, tokens[role]);
        if (!allowed) expect(res.status, `${role} must be refused`).toBe(403);
        else {
          if (!probe.serviceRefuses?.includes(role)) expect([401, 403], `${role} must be allowed (got ${res.status})`).not.toContain(res.status);
          expect(res.status, `${role} server error`).toBeLessThan(500);
        }
      }
    });
  }

  it("CLIENT_PORTAL holds no staff-area permission at all", () => {
    const staff = Object.keys(PROBES).filter((p) => p !== "portal.dashboard.read");
    expect(staff.filter((p) => perms.CLIENT_PORTAL!.has(p))).toEqual([]);
  });
});
