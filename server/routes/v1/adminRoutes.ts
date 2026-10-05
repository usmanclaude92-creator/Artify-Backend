/** Phase 17 — Administration dashboard, security policy/events, and organization session management. */
import { Router } from "express";
import { z } from "zod";
import { authenticateToken, requirePermission } from "../../middleware/auth";
import { sensitiveActionLimiter } from "../../middleware/rateLimiter";
import { asyncHandler } from "../../utils/asyncHandler";
import { sendSuccess } from "../../core/apiResponse";
import { adminOverviewService, SECURITY_EVENT_ACTIONS } from "../../services/admin/adminOverviewService";
import { userSecurityService } from "../../services/admin/userSecurityService";
import { auditLogQueryRepository, auditSeverity } from "../../repositories/auditLogQueryRepository";

const router = Router();
router.use(authenticateToken);

router.get("/overview", requirePermission("security.read"), asyncHandler(async (req, res) => sendSuccess(res, { overview: await adminOverviewService.overview(req.user!) })));

router.get("/security/policy", requirePermission("security.read"), (_req, res) => sendSuccess(res, { policy: adminOverviewService.policy() }));

const pageQuery = z.object({ page: z.coerce.number().int().positive().default(1), limit: z.coerce.number().int().positive().max(100).default(20) });

router.get(
  "/security/events",
  requirePermission("security.read"),
  asyncHandler(async (req, res) => {
    const { page, limit } = pageQuery.parse(req.query);
    const { rows, total } = await auditLogQueryRepository.list({ organizationId: req.user!.organizationId, actions: [...SECURITY_EVENT_ACTIONS] }, page, limit);
    sendSuccess(res, { events: rows.map((r) => ({ ...r, severity: auditSeverity(r) })) }, 200, { page, limit, total });
  })
);

router.get(
  "/sessions",
  requirePermission("security.read"),
  asyncHandler(async (req, res) => {
    const { page, limit } = pageQuery.parse(req.query);
    const { sessions, total } = await userSecurityService.listOrganizationSessions(req.user!.organizationId, page, limit);
    sendSuccess(res, { sessions }, 200, { page, limit, total });
  })
);

router.post(
  "/sessions/:id/revoke",
  requirePermission("security.manage"),
  sensitiveActionLimiter,
  asyncHandler(async (req, res) => {
    await userSecurityService.revokeOrganizationSession(req.user!, req.params.id!, { ip: req.ip, userAgent: req.headers["user-agent"] });
    sendSuccess(res, { message: "Session revoked." });
  })
);

export default router;
