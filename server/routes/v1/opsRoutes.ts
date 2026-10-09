/** Administration: System Health, Backups, retention and consent register (Step 13). Mounted at /api/v1/ops. */
import { Router } from "express";
import { z } from "zod";
import { authenticateToken, requirePermission, requireRole } from "../../middleware/auth";
import { sensitiveActionLimiter } from "../../middleware/rateLimiter";
import { asyncHandler } from "../../utils/asyncHandler";
import { sendSuccess } from "../../core/apiResponse";
import { healthService, ENV_CHECKLIST } from "../../services/ops/healthService";
import { backupService } from "../../services/ops/backupService";
import { retentionService, purgeEnabled } from "../../services/ops/retentionService";
import { consentService } from "../../services/ops/consentService";
import { RETENTION_POLICY } from "../../services/ops/retentionPolicy";

const router = Router();
router.use(authenticateToken);

router.get("/health", requirePermission("ops.health.read"), asyncHandler(async (req, res) => {
  const checks = await healthService.runAndStore(req.user!.organizationId);
  const present = (n: string) => !!process.env[n] && process.env[n]!.trim().length > 0;
  sendSuccess(res, {
    generatedAt: new Date().toISOString(),
    summary: { ok: checks.filter((c) => c.status === "ok").length, warn: checks.filter((c) => c.status === "warn").length, red: checks.filter((c) => c.status === "red").length, unknown: checks.filter((c) => c.status === "unknown").length, disabled: checks.filter((c) => c.status === "disabled").length },
    checks: checks.map((c) => ({ ...c, items: undefined })),
    // Names and present/missing only; values are never read into the response.
    env: ENV_CHECKLIST.map((e) => ({ name: e.name, required: e.required, purpose: e.purpose, present: present(e.name) })),
  });
}));

router.get("/backups", requirePermission("ops.backups.read"), asyncHandler(async (req, res) => {
  const [provider, exports] = await Promise.all([backupService.providerInfo(), backupService.listExports(req.user!.organizationId)]);
  sendSuccess(res, { provider, exportConfig: backupService.exportConfigStatus(), exports });
}));

router.post("/backups/exports/:id/verify", requirePermission("ops.backups.read"), sensitiveActionLimiter, asyncHandler(async (req, res) => {
  sendSuccess(res, await backupService.verifyExport(req.user!.organizationId, req.params.id!));
}));

/** Manual run: SUPER_ADMIN only (the scheduled run needs no one). */
router.post("/backups/exports", requireRole(["SUPER_ADMIN"]), sensitiveActionLimiter, asyncHandler(async (req, res) => {
  const row = await backupService.runCriticalExport(req.user!.organizationId, req.user!.id);
  sendSuccess(res, { export: { id: row.id, status: row.status, sizeBytes: row.sizeBytes, rowCounts: row.rowCounts, createdAt: row.createdAt } }, 201);
}));

router.get("/retention", requirePermission("privacy.read"), asyncHandler(async (req, res) => {
  const dry = await retentionService.run(req.user!.organizationId, { execute: false });
  sendSuccess(res, { policy: RETENTION_POLICY, purgeEnabled: purgeEnabled(), preview: dry.rows });
}));

const consentQuery = z.object({ page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(25), status: z.enum(["GIVEN", "DECLINED", "NOT_COLLECTED"]).optional(), source: z.string().trim().max(120).optional() });
router.get("/consent", requirePermission("privacy.read"), asyncHandler(async (req, res) => {
  const q = consentQuery.parse(req.query);
  const r = await consentService.list(req.user!.organizationId, q);
  sendSuccess(res, { records: r.rows, summary: r.summary }, 200, { page: q.page, limit: q.limit, total: r.total });
}));

export default router;
