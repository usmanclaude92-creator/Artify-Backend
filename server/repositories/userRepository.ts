/**
 * User data access. Route → service → repository → Prisma (Phase 1 §27
 * layering) — no Prisma import belongs in a route or service file.
 */
import type { User } from "@prisma/client";
import { prisma } from "../db/prisma";

const MAX_FAILED_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;

export const userRepository = {
  async findByEmail(email: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  },

  async findById(id: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { id } });
  },

  async create(data: {
    companyId: string;
    email: string;
    passwordHash: string;
    fullName: string;
    title?: string;
    role: User["role"];
    permissions: string[];
  }): Promise<User> {
    return prisma.user.create({
      data: {
        companyId: data.companyId,
        email: data.email.trim().toLowerCase(),
        passwordHash: data.passwordHash,
        fullName: data.fullName,
        title: data.title,
        role: data.role,
        permissions: data.permissions,
      },
    });
  },

  async recordSuccessfulLogin(userId: string): Promise<void> {
    await prisma.user.update({
      where: { id: userId },
      data: { lastLoginAt: new Date(), failedLoginCount: 0, lockedUntil: null },
    });
  },

  /** Returns true if the account is now locked as a result of this failure. */
  async recordFailedLogin(userId: string): Promise<boolean> {
    const user = await prisma.user.update({
      where: { id: userId },
      data: { failedLoginCount: { increment: 1 } },
    });

    if (user.failedLoginCount >= MAX_FAILED_LOGIN_ATTEMPTS) {
      await prisma.user.update({
        where: { id: userId },
        data: { lockedUntil: new Date(Date.now() + LOCKOUT_DURATION_MS) },
      });
      return true;
    }
    return false;
  },

  isLocked(user: Pick<User, "lockedUntil">): boolean {
    return !!user.lockedUntil && user.lockedUntil.getTime() > Date.now();
  },
};
