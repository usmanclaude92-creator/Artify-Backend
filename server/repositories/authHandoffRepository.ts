/** Cross-site sign-in handoff codes — hashed at rest, single-use, very short-lived. */
import { prisma } from "../db/prisma";
import { hashToken } from "../utils/crypto";

export const authHandoffRepository = {
  async create(data: { code: string; userId: string; organizationId: string; expiresAt: Date }): Promise<void> {
    await prisma.authHandoffCode.create({
      data: { codeHash: hashToken(data.code), userId: data.userId, organizationId: data.organizationId, expiresAt: data.expiresAt },
    });
  },

  /**
   * Atomically claims a code: the conditional update succeeds for exactly one caller, so a code
   * can never be exchanged twice even under concurrent requests.
   */
  async consume(code: string): Promise<{ userId: string; organizationId: string } | null> {
    const codeHash = hashToken(code);
    const claimed = await prisma.authHandoffCode.updateMany({
      where: { codeHash, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    });
    if (claimed.count !== 1) return null;
    const row = await prisma.authHandoffCode.findUnique({ where: { codeHash } });
    return row ? { userId: row.userId, organizationId: row.organizationId } : null;
  },

  async purgeExpired(): Promise<void> {
    await prisma.authHandoffCode.deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - 60 * 60 * 1000) } } });
  },
};
