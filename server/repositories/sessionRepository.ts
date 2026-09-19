import type { Session } from "@prisma/client";
import { prisma } from "../db/prisma";

export const sessionRepository = {
  async create(data: {
    token: string;
    userId: string;
    companyId: string;
    expiresAt: Date;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<Session> {
    return prisma.session.create({ data });
  },

  async findValidByToken(token: string): Promise<Session | null> {
    const session = await prisma.session.findUnique({ where: { token } });
    if (!session) return null;
    if (session.revokedAt) return null;
    if (session.expiresAt.getTime() <= Date.now()) return null;
    return session;
  },

  async revoke(token: string): Promise<void> {
    await prisma.session
      .update({ where: { token }, data: { revokedAt: new Date() } })
      .catch(() => {
        // Token didn't exist — logout is idempotent, nothing to do.
      });
  },

  async revokeAllForUser(userId: string): Promise<void> {
    await prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  },
};
