/**
 * Security regression suite for the auth/RBAC middleware foundation
 * (server/middleware/auth.ts). No business routes exist yet to mount these
 * on (that's Phase 4+), so this suite builds a minimal throwaway route
 * inside the test file itself, using the REAL middleware functions, to
 * prove: missing auth is rejected, wrong permission is rejected, and
 * cross-tenant access is rejected (see docs/AUTHORIZATION_MODEL.md).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { requestIdMiddleware } from "../../server/middleware/requestId";
import { errorHandlerMiddleware, notFoundHandler } from "../../server/middleware/errorHandler";
import {
  authenticateToken,
  enforceTenantIsolation,
  requirePermission,
  requireRole,
} from "../../server/middleware/auth";
import { authService } from "../../server/services/authService";
import { disconnectPrisma } from "../../server/db/prisma";
import { resetDb } from "../helpers/db";

function buildTestApp() {
  const app = express();
  app.use(requestIdMiddleware);
  app.use(express.json());

  // A protected resource-list route: any authenticated user may call it.
  app.get("/protected/whoami", authenticateToken, (req, res) => {
    res.json({ userId: req.user?.id, role: req.user?.role });
  });

  // Requires a permission the default registration flow does NOT grant.
  app.get("/protected/admin-only", authenticateToken, requirePermission("settings.manage"), (_req, res) => {
    res.json({ ok: true });
  });

  // Requires a specific role.
  app.get(
    "/protected/super-admin-only",
    authenticateToken,
    requireRole(["SUPER_ADMINISTRATOR"]),
    (_req, res) => {
      res.json({ ok: true });
    }
  );

  // Simulates a single-record route scoped by companyId query param.
  app.get("/protected/tenant-scoped", authenticateToken, enforceTenantIsolation, (_req, res) => {
    res.json({ ok: true });
  });

  app.use(notFoundHandler);
  app.use(errorHandlerMiddleware);
  return app;
}

describe("authorization middleware foundation (security regression suite)", () => {
  const app = buildTestApp();

  let tenantAToken: string;
  let tenantACompanyId: string;
  let tenantBToken: string;
  let tenantBCompanyId: string;

  beforeAll(async () => {
    await resetDb();

    const a = await authService.register({
      email: "tenant-a-admin@example.com",
      password: "CorrectHorseBatteryStaple123",
      fullName: "Tenant A Admin",
      companyName: "Tenant A Corp",
    });
    tenantAToken = a.session.token;
    tenantACompanyId = a.user.companyId;

    const b = await authService.register({
      email: "tenant-b-admin@example.com",
      password: "CorrectHorseBatteryStaple123",
      fullName: "Tenant B Admin",
      companyName: "Tenant B Corp",
    });
    tenantBToken = b.session.token;
    tenantBCompanyId = b.user.companyId;
  });

  afterAll(async () => {
    await resetDb();
    await disconnectPrisma();
  });

  describe("authentication is required", () => {
    it("rejects a request with no Authorization header", async () => {
      const res = await request(app).get("/protected/whoami");
      expect(res.status).toBe(401);
    });

    it("rejects a request with an invalid Bearer token", async () => {
      const res = await request(app).get("/protected/whoami").set("Authorization", "Bearer garbage-token-value");
      expect(res.status).toBe(401);
    });

    it("accepts a request with a valid session token", async () => {
      const res = await request(app).get("/protected/whoami").set("Authorization", `Bearer ${tenantAToken}`);
      expect(res.status).toBe(200);
    });
  });

  describe("vertical privilege escalation is blocked", () => {
    it("rejects a Company Administrator calling a route requiring settings.manage (not in the default grant)", async () => {
      const res = await request(app).get("/protected/admin-only").set("Authorization", `Bearer ${tenantAToken}`);
      expect(res.status).toBe(403);
    });

    it("rejects a Company Administrator calling a Super-Administrator-only route", async () => {
      const res = await request(app)
        .get("/protected/super-admin-only")
        .set("Authorization", `Bearer ${tenantAToken}`);
      expect(res.status).toBe(403);
    });
  });

  describe("horizontal privilege escalation / tenant isolation is blocked", () => {
    it("allows a user to access a resource scoped to their own companyId", async () => {
      const res = await request(app)
        .get(`/protected/tenant-scoped?companyId=${tenantACompanyId}`)
        .set("Authorization", `Bearer ${tenantAToken}`);
      expect(res.status).toBe(200);
    });

    it("rejects tenant A's user requesting a resource scoped to tenant B's companyId", async () => {
      const res = await request(app)
        .get(`/protected/tenant-scoped?companyId=${tenantBCompanyId}`)
        .set("Authorization", `Bearer ${tenantAToken}`);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("TENANT_ISOLATION_ERROR");
    });

    it("rejects tenant B's user requesting a resource scoped to tenant A's companyId (symmetric check)", async () => {
      const res = await request(app)
        .get(`/protected/tenant-scoped?companyId=${tenantACompanyId}`)
        .set("Authorization", `Bearer ${tenantBToken}`);
      expect(res.status).toBe(403);
    });

    it("allows a request with no companyId filter at all (list-your-own-scope pattern)", async () => {
      const res = await request(app).get("/protected/tenant-scoped").set("Authorization", `Bearer ${tenantAToken}`);
      expect(res.status).toBe(200);
    });
  });
});
