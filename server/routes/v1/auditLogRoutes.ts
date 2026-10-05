/** Phase 4 Audit Log UI — read-only, paginated, tenant-scoped. */
import { Router } from "express";
import { auditLogQueryRepository, auditSeverity } from "../../repositories/auditLogQueryRepository";
import { authenticateToken, requirePermission } from "../../middleware/auth";
import { asyncHandler } from "../../utils/asyncHandler";
import { sendSuccess } from "../../core/apiResponse";
import { listAuditLogsQuerySchema } from "../../schemas/auditLogSchemas";
import { NotFoundError } from "../../core/errors";

const router = Router();

router.use(authenticateToken);

router.get(
  "/",
  requirePermission("audit.read"),
  asyncHandler(async (req, res) => {
    const query = listAuditLogsQuerySchema.parse(req.query);

    // Non-SUPER_ADMIN callers can only ever see their own organization's
    // audit trail — a caller-supplied organizationId is honored only for
    // SUPER_ADMIN (same convention as GET /users).
    const organizationId =
      req.user!.role.key === "SUPER_ADMIN" && query.organizationId ? query.organizationId : req.user!.organizationId;

    const { rows, total } = await auditLogQueryRepository.list(
      {
        organizationId,
        actorUserId: query.actorUserId,
        action: query.action,
        resourceType: query.resourceType,
        resourceId: query.resourceId,
        actorType: query.actorType,
        q: query.q,
        severity: query.severity,
        result: query.result,
        dateFrom: query.dateFrom,
        dateTo: query.dateTo,
      },
      query.page,
      query.limit
    );

    sendSuccess(res, { auditLogs: rows.map((r) => ({ ...r, severity: auditSeverity(r) })) }, 200, { page: query.page, limit: query.limit, total });
  })
);

/** Distinct action names in the caller's organization — powers the action filter. */
router.get(
  "/facets",
  requirePermission("audit.read"),
  asyncHandler(async (req, res) => sendSuccess(res, { actions: await auditLogQueryRepository.distinctActions(req.user!.organizationId) }))
);

/** Single event with full before/after detail. Org-scoped; a foreign id is indistinguishable from a missing one. */
router.get(
  "/:id",
  requirePermission("audit.read"),
  asyncHandler(async (req, res) => {
    const row = await auditLogQueryRepository.findById(req.params.id!, req.user!.role.key === "SUPER_ADMIN" ? undefined : req.user!.organizationId);
    if (!row) throw new NotFoundError("Audit event not found.");
    sendSuccess(res, { auditLog: { ...row, severity: auditSeverity(row) } });
  })
);

export default router;
