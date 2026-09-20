/**
 * Authentication service. Ported from the Phase 0 audit's
 * artifysolscom/server/services/authService.ts design and hardened across
 * Phase 1 (bcrypt, real sessions, transactional registration) and Phase 2
 * (docs/ADR/ADR-011-permission-based-rbac-schema.md — role/permission
 * resolution via the roles/permissions/role_permissions tables instead of
 * a flat per-user array; docs/ADR/ADR-010-multi-tenant-organization-model.md
 * — organizationId replaces companyId; session tokens are hashed at rest).
 */
import { prisma } from "../db/prisma";
import { userRepository } from "../repositories/userRepository";
import { sessionRepository } from "../repositories/sessionRepository";
import { auditLogRepository } from "../repositories/auditLogRepository";
import { roleRepository } from "../repositories/roleRepository";
import { hashPassword, verifyPassword } from "../utils/password";
import { generateSessionToken } from "../utils/crypto";
import { AuthenticationError, ConflictError, InternalError } from "../core/errors";
import { sanitizeUser, type SanitizedUser } from "../types/domain";
import type { RegisterInput } from "../schemas/authSchemas";
import { logger } from "../core/logger";

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

/** Self-registration always creates the organization's ADMIN (not SUPER_ADMIN — that role is reserved for Artify's own platform operators, granted only via the seed/bootstrap procedure, never through the public register endpoint). */
const SELF_REGISTRATION_ROLE_KEY = "ADMIN";

export interface RequestMeta {
  ip?: string;
  userAgent?: string;
}

export interface LoginResult {
  session: { token: string; expiresAt: Date };
  user: SanitizedUser;
}

async function loadSanitizedUser(user: NonNullable<Awaited<ReturnType<typeof userRepository.findById>>>): Promise<SanitizedUser> {
  const role = await roleRepository.resolveById(user.roleId);
  if (!role) {
    // A user with no resolvable role is a data-integrity bug, not a normal
    // auth failure — the roleId FK is NOT NULL + RESTRICT, so this should
    // be unreachable outside a corrupted database.
    throw new InternalError("User role could not be resolved.");
  }
  return sanitizeUser(user, role);
}

export const authService = {
  async login(email: string, password: string, meta: RequestMeta = {}): Promise<LoginResult> {
    const user = await userRepository.findByEmail(email);

    // Same generic error whether the email doesn't exist or the password is
    // wrong — do not let a caller distinguish "no such account" from
    // "wrong password" (user-enumeration hardening).
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
      organizationId: user.organizationId,
      expiresAt,
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    const sanitized = await loadSanitizedUser(user);

    await auditLogRepository.record({
      organizationId: user.organizationId,
      actorUserId: user.id,
      actorName: sanitized.displayName ?? `${user.firstName} ${user.lastName}`,
      actorType: "USER",
      action: "AUTH_LOGIN",
      resourceType: "session",
      resourceId: user.id,
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return { session: { token, expiresAt }, user: sanitized };
  },

  async register(payload: RegisterInput): Promise<LoginResult> {
    const existing = await userRepository.findByEmail(payload.email);
    if (existing) {
      throw new ConflictError("An account with this email address already exists.");
    }

    const adminRole = await roleRepository.findByKey(SELF_REGISTRATION_ROLE_KEY);
    if (!adminRole) {
      // The ADMIN system role must exist (seeded) before self-registration
      // can work at all — a missing seed is an operational error, not a
      // normal user-facing failure.
      throw new InternalError("Registration is not available: required role configuration is missing.");
    }

    const passwordHash = await hashPassword(payload.password);

    // Single atomic transaction: organization + admin user are created
    // together or not at all (Phase 1 hardening, unchanged in Phase 2).
    await prisma.$transaction(async (tx) => {
      const baseSlug =
        payload.organizationName
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/(^-|-$)/g, "")
          .slice(0, 80) || "organization";

      let slug = baseSlug;
      let suffix = 1;
      while (await tx.organization.findUnique({ where: { slug } })) {
        suffix += 1;
        slug = `${baseSlug}-${suffix}`;
        if (suffix > 50) break;
      }

      const organization = await tx.organization.create({
        data: {
          name: payload.organizationName,
          slug,
          type: "CLIENT",
          tier: "GROWTH",
          status: "TRIAL",
        },
      });

      const user = await tx.user.create({
        data: {
          organizationId: organization.id,
          email: payload.email.trim().toLowerCase(),
          passwordHash,
          firstName: payload.firstName,
          lastName: payload.lastName,
          displayName: `${payload.firstName} ${payload.lastName}`.trim(),
          title: "Organization Administrator",
          roleId: adminRole.id,
        },
      });

      await tx.organizationMembership.create({
        data: {
          userId: user.id,
          organizationId: organization.id,
          roleId: adminRole.id,
          status: "ACTIVE",
          isPrimary: true,
        },
      });

      return { organization, user };
    });

    return this.login(payload.email, payload.password);
  },

  async verifySession(token: string): Promise<SanitizedUser | null> {
    const session = await sessionRepository.findValidByToken(token);
    if (!session) return null;

    const user = await userRepository.findById(session.userId);
    if (!user || user.status !== "ACTIVE") return null;

    void sessionRepository.touchLastUsed(session.id); // fire-and-forget, not on the request's critical path

    return loadSanitizedUser(user);
  },

  async logout(token: string): Promise<void> {
    await sessionRepository.revoke(token);
  },
};
