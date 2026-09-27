/**
 * Notification management (Phase 11 — docs/NOTIFICATIONS_ARCHITECTURE.md).
 * IN_APP only — there is no email/SMS transport anywhere in this codebase
 * (no mailer, no SES/SendGrid/Twilio config), so this never claims to
 * deliver a channel it can't actually send through. `NotificationChannel`/
 * `NotificationPreference` stay modeled for a future channel but nothing
 * here writes an EMAIL or SMS row.
 */
import { notificationRepository } from "../repositories/notificationRepository";
import { NotFoundError } from "../core/errors";
import type { Notification } from "@prisma/client";

export const notificationService = {
  async listNotifications(userId: string, organizationId: string, status: "UNREAD" | "READ" | "ARCHIVED" | undefined, page: number, limit: number) {
    return notificationRepository.list(userId, organizationId, { status }, page, limit);
  },

  async unreadCount(userId: string, organizationId: string): Promise<number> {
    return notificationRepository.unreadCount(userId, organizationId);
  },

  async markRead(userId: string, id: string): Promise<Notification> {
    const existing = await notificationRepository.findByIdForUser(id, userId);
    if (!existing) throw new NotFoundError("Notification not found.");
    if (existing.status === "READ") return existing;
    return notificationRepository.markRead(id);
  },

  async markAllRead(userId: string, organizationId: string): Promise<number> {
    return notificationRepository.markAllRead(userId, organizationId);
  },

  /**
   * Internal fire-and-forget helper other services call directly (never
   * exposed via a public route — a notification always originates from a
   * real system event, not a user-authored POST body). Never throws: a
   * notification failing to write must not fail the business operation
   * that triggered it (e.g. a lead create should still succeed even if
   * writing its "assigned to you" notification somehow fails).
   */
  async notify(params: { organizationId: string; userId: string | null | undefined; type: string; title: string; message: string }): Promise<void> {
    if (!params.userId) return;
    try {
      await notificationRepository.create({
        organizationId: params.organizationId,
        userId: params.userId,
        type: params.type,
        title: params.title,
        message: params.message,
      });
    } catch {
      // Best-effort — see doc comment above.
    }
  },
};
