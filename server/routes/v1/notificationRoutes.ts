/**
 * A user's own notifications (Phase 11 — docs/NOTIFICATIONS_ARCHITECTURE.md).
 * No `requirePermission` anywhere in this file — like `/auth/me`, reading
 * or acknowledging your own notifications needs only a valid session, not
 * an RBAC grant. Every query is scoped to `req.user!.id` +
 * `req.user!.organizationId` server-side; nothing here accepts a
 * caller-supplied userId.
 */
import { Router } from "express";
import { notificationService } from "../../services/notificationService";
import { authenticateToken } from "../../middleware/auth";
import { asyncHandler } from "../../utils/asyncHandler";
import { sendSuccess } from "../../core/apiResponse";
import { listNotificationsQuerySchema } from "../../schemas/notificationSchemas";

const router = Router();

router.use(authenticateToken);

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const query = listNotificationsQuerySchema.parse(req.query);
    const { rows, total } = await notificationService.listNotifications(req.user!.id, req.user!.organizationId, query.status, query.page, query.limit);
    sendSuccess(res, { notifications: rows }, 200, { page: query.page, limit: query.limit, total });
  })
);

router.get(
  "/unread-count",
  asyncHandler(async (req, res) => {
    const count = await notificationService.unreadCount(req.user!.id, req.user!.organizationId);
    sendSuccess(res, { count });
  })
);

router.post(
  "/:id/read",
  asyncHandler(async (req, res) => {
    const notification = await notificationService.markRead(req.user!.id, req.params.id!);
    sendSuccess(res, { notification });
  })
);

router.post(
  "/read-all",
  asyncHandler(async (req, res) => {
    const count = await notificationService.markAllRead(req.user!.id, req.user!.organizationId);
    sendSuccess(res, { count });
  })
);

export default router;
