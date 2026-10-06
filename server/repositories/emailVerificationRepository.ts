/** Email-verification token data access — raw tokens are never stored (SHA-256 hash only), mirroring passwordResetRepository. */
import type { EmailVerificationToken } from "@prisma/client";
import { prisma } from "../db/prisma";
import { hashToken } from "../utils/crypto";

export const emailVerificationRepository = {
  async create(data: { token: string; userId: string; expiresAt: Date }): Promise<EmailVerificationToken> {
    return prisma.emailVerificationToken.create({ data: { tokenHash: hashToken(data.token), userId: data.userId, expiresAt: data.expiresAt } });
  },

  async findValidByToken(token: string): Promise<EmailVerificationToken | null> {
    const row = await prisma.emailVerificationToken.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!row || row.usedAt || row.expiresAt.getTime() <= Date.now()) return null;
    return row;
  },

  async markUsed(id: string): Promise<void> {
    await prisma.emailVerificationToken.update({ where: { id }, data: { usedAt: new Date() } });
  },

  async invalidateAllForUser(userId: string): Promise<void> {
    await prisma.emailVerificationToken.updateMany({ where: { userId, usedAt: null }, data: { usedAt: new Date() } });
  },
};
