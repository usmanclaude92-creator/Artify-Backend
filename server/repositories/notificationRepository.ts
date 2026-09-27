/**
 * Notification data access (Phase 11 — docs/NOTIFICATIONS_ARCHITECTURE.md).
 * Scoped to (userId, organizationId) — a notification is always read back
 * by its own recipient in their current session's org context, never any
 * other user's, matching the session-scoped-authorization convention used
 * everywhere else (`SanitizedUser`'s doc comment in server/types/domain.ts).
 */
import type { Notification, Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";

export const notificationRepository = {
  async list(
    userId: string,
    organizationId: string,
    filters: { status?: "UNREAD" | "READ" | "ARCHIVED" },
    page: number,
    limit: number
  ): Promise<{ rows: Notification[]; total: number }> {
    const where: Prisma.NotificationWhereInput = { userId, organizationId, ...(filters.status ? { status: filters.status } : {}) };
    const [rows, total] = await Promise.all([
      prisma.notification.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * limit, take: limit }),
      prisma.notification.count({ where }),
    ]);
    return { rows, total };
  },

  async unreadCount(userId: string, organizationId: string): Promise<number> {
    return prisma.notification.count({ where: { userId, organizationId, status: "UNREAD" } });
  },

  async findByIdForUser(id: string, userId: string): Promise<Notification | null> {
    return prisma.notification.findFirst({ where: { id, userId } });
  },

  async create(data: { organizationId?: string; userId: string; type: string; title: string; message: string }): Promise<Notification> {
    return prisma.notification.create({ data });
  },

  async markRead(id: string): Promise<Notification> {
    return prisma.notification.update({ where: { id }, data: { status: "READ", readAt: new Date() } });
  },

  async markAllRead(userId: string, organizationId: string): Promise<number> {
    const result = await prisma.notification.updateMany({
      where: { userId, organizationId, status: "UNREAD" },
      data: { status: "READ", readAt: new Date() },
    });
    return result.count;
  },
};
