/**
 * Authentication service. Ported from the Phase 0 audit's
 * artifysolscom/server/services/authService.ts design (docs/MIGRATION_PLAN.md
 * — REUSE the session/RBAC middleware shape) and hardened per
 * docs/ADR/ADR-003-authentication.md:
 *  - bcrypt (via bcryptjs) replaces unsalted SHA-256 (fixes S5/R5)
 *  - real Postgres-backed sessions replace the in-memory Map
 *  - account lockout after repeated failures (new — Phase 1 §17)
 *  - registration is a single DB transaction (fixes the unguarded
 *    sequential multi-write flagged in docs/CURRENT_STATE.md §2.4)
 */
import { prisma } from "../db/prisma";
import { userRepository } from "../repositories/userRepository";
import { sessionRepository } from "../repositories/sessionRepository";
import { auditLogRepository } from "../repositories/auditLogRepository";
import { hashPassword, verifyPassword } from "../utils/password";
import { generateSessionToken } from "../utils/crypto";
import { AuthenticationError, ConflictError } from "../core/errors";
import { sanitizeUser, type SanitizedUser } from "../types/domain";
import type { RegisterInput } from "../schemas/authSchemas";
import { logger } from "../core/logger";

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

const DEFAULT_ADMIN_PERMISSIONS = [
  "users.read",
  "clients.read",
  "clients.create",
  "clients.update",
  "content.read",
  "content.create",
  "products.read",
  "billing.read",
  "billing.manage",
  "leads.read",
  "leads.manage",
  "notifications.send",
  "audit.read",
  "company.manage",
];

export interface RequestMeta {
  ip?: string;
  userAgent?: string;
}

export interface LoginResult {
  session: { token: string; expiresAt: Date };
  user: SanitizedUser;
}

export const authService = {
  async login(email: string, password: string, meta: RequestMeta = {}): Promise<LoginResult> {
    const user = await userRepository.findByEmail(email);

    // Same generic error whether the email doesn't exist or the password is
    // wrong — do not let a caller distinguish "no such account" from
    // "wrong password" (user-enumeration hardening; not present in the
    // Phase 0 prototype, added here).
    const genericFailure = () => new AuthenticationError("Invalid email or password credentials.");

    if (!user) throw genericFailure();

    if (userRepository.isLocked(user)) {
      throw new AuthenticationError(
        "This account is temporarily locked due to repeated failed sign-in attempts. Try again later."
      );
    }

    const validPassword = await verifyPassword(password, user.passwordHash);
    if (!validPassword) {
      const nowLocked = await userRepository.recordFailedLogin(user.id);
      if (nowLocked) {
        logger.warn({ event: "account_locked", userId: user.id }, "Account locked after repeated failed logins");
      }
      throw genericFailure();
    }

    if (user.status !== "ACTIVE") {
      throw new AuthenticationError("This account cannot sign in. Contact your administrator.");
    }

    await userRepository.recordSuccessfulLogin(user.id);

    const token = generateSessionToken();
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await sessionRepository.create({
      token,
      userId: user.id,
      companyId: user.companyId,
      expiresAt,
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    await auditLogRepository.record({
      companyId: user.companyId,
      actorId: user.id,
      actorName: user.fullName,
      actorType: "USER",
      action: "USER_LOGIN",
      resource: "auth",
      resourceId: user.id,
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return { session: { token, expiresAt }, user: sanitizeUser(user) };
  },

  async register(payload: RegisterInput): Promise<LoginResult> {
    const existing = await userRepository.findByEmail(payload.email);
    if (existing) {
      throw new ConflictError("An account with this email address already exists.");
    }

    const passwordHash = await hashPassword(payload.password);

    // Single atomic transaction: company + admin user are created together
    // or not at all (fixes the Phase 0 finding: the prototype's equivalent
    // flow performed these as unguarded sequential writes).
    await prisma.$transaction(async (tx) => {
      const baseSlug = payload.companyName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "")
        .slice(0, 80) || "organization";

      let slug = baseSlug;
      let suffix = 1;
      // Bounded collision retry inside the transaction.
      while (await tx.company.findUnique({ where: { slug } })) {
        suffix += 1;
        slug = `${baseSlug}-${suffix}`;
        if (suffix > 50) break;
      }

      const company = await tx.company.create({
        data: {
          name: payload.companyName,
          slug,
          industry: payload.industry,
          tier: "GROWTH",
          status: "TRIAL",
        },
      });

      const createdUser = await tx.user.create({
        data: {
          companyId: company.id,
          email: payload.email.trim().toLowerCase(),
          passwordHash,
          fullName: payload.fullName,
          title: "Company Administrator",
          role: "COMPANY_ADMINISTRATOR",
          permissions: DEFAULT_ADMIN_PERMISSIONS,
        },
      });

      return { company, user: createdUser };
    });

    return this.login(payload.email, payload.password);
  },

  async verifySession(token: string): Promise<SanitizedUser | null> {
    const session = await sessionRepository.findValidByToken(token);
    if (!session) return null;

    const user = await userRepository.findById(session.userId);
    if (!user || user.status !== "ACTIVE") return null;

    return sanitizeUser(user);
  },

  async logout(token: string): Promise<void> {
    await sessionRepository.revoke(token);
  },
};
