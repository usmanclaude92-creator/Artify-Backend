import { Router, type Request } from "express";
import { authService } from "../../services/authService";
import { sessionRepository } from "../../repositories/sessionRepository";
import { auditLogRepository } from "../../repositories/auditLogRepository";
import { authenticateToken } from "../../middleware/auth";
import { NotFoundError, AuthorizationError } from "../../core/errors";
import { config } from "../../config/env";
import { captchaService } from "../../services/captchaService";
import { authLimiter, passwordResetLimiter, sensitiveActionLimiter, registerLimiter, verificationLimiter } from "../../middleware/rateLimiter";
import { asyncHandler } from "../../utils/asyncHandler";
import { sendSuccess } from "../../core/apiResponse";
import { AuthenticationError } from "../../core/errors";
import {
  loginSchema,
  registerSchema,
  portalRegisterSchema,
  verifyEmailSchema,
  resendVerificationSchema,
  changePasswordSchema,
  passwordResetRequestSchema,
  passwordResetConfirmSchema,
  switchOrganizationSchema,
  handoffExchangeSchema,
} from "../../schemas/authSchemas";

const router = Router();

function requestMeta(req: Request) {
  return { ip: req.ip, userAgent: req.headers["user-agent"] };
}

router.post(
  "/login",
  authLimiter,
  asyncHandler(async (req, res) => {
    const input = loginSchema.parse(req.body);
    const result = await authService.login(input.email, input.password, requestMeta(req));
    sendSuccess(res, result);
  })
);

// Cross-site sign-in: the public site asks for a 60-second single-use code, then the Control Center
// exchanges it for its own fresh session. No session token ever travels in a URL.
router.post(
  "/handoff",
  authenticateToken,
  sensitiveActionLimiter,
  asyncHandler(async (req, res) => {
    const { code } = await authService.issueHandoffCode(req.user!, requestMeta(req));
    sendSuccess(res, { code });
  })
);

router.post(
  "/handoff/exchange",
  authLimiter,
  asyncHandler(async (req, res) => {
    const { code } = handoffExchangeSchema.parse(req.body);
    const result = await authService.exchangeHandoffCode(code, requestMeta(req));
    sendSuccess(res, result);
  })
);

// Public client-portal registration: least-privilege role, honeypot + optional CAPTCHA,
// per-IP cap, email verification, and no account enumeration when email is configured.
router.post(
  "/portal/register",
  registerLimiter,
  authLimiter,
  asyncHandler(async (req, res) => {
    const input = portalRegisterSchema.parse(req.body);
    // Honeypot: real users never fill the hidden field. Answer exactly like a success so bots learn nothing.
    if (input.website && input.website.trim().length > 0) {
      sendSuccess(res, { status: "verification_required" }, 201);
      return;
    }
    await captchaService.assertHuman(input.captchaToken, req.ip);
    const { website: _website, captchaToken: _captchaToken, ...account } = input;
    const result = await authService.registerPortalAccount(account, requestMeta(req));
    sendSuccess(res, result, 201);
  })
);

router.post(
  "/verify-email",
  verificationLimiter,
  asyncHandler(async (req, res) => {
    const input = verifyEmailSchema.parse(req.body);
    await authService.verifyEmail(input.token, requestMeta(req));
    sendSuccess(res, { verified: true });
  })
);

router.post(
  "/resend-verification",
  verificationLimiter,
  asyncHandler(async (req, res) => {
    const input = resendVerificationSchema.parse(req.body);
    await captchaService.assertHuman(input.captchaToken, req.ip);
    await authService.resendVerification(input.email);
    sendSuccess(res, { message: "If that account needs verification, a new email has been sent." });
  })
);

router.post(
  "/register",
  authLimiter,
  asyncHandler(async (req, res) => {
    if (!config.allowAdminSelfRegistration) {
      throw new AuthorizationError("Self-registration is disabled. Use the client portal registration.");
    }
    const input = registerSchema.parse(req.body);
    const result = await authService.register(input);
    sendSuccess(res, result, 201);
  })
);

router.get(
  "/me",
  authenticateToken,
  asyncHandler(async (req, res) => {
    const organizations = await authService.listMemberships(req.user!.id, req.user!.organizationId);
    sendSuccess(res, { user: req.user, organizations });
  })
);

router.post(
  "/logout",
  authenticateToken,
  asyncHandler(async (req, res) => {
    if (req.sessionToken) {
      await authService.logout(
        req.sessionToken,
        { userId: req.user!.id, organizationId: req.user!.organizationId },
        requestMeta(req)
      );
    }
    sendSuccess(res, { message: "Logged out successfully." });
  })
);

router.post(
  "/logout-all",
  authenticateToken,
  asyncHandler(async (req, res) => {
    await authService.logoutAll(req.user!, requestMeta(req));
    sendSuccess(res, { message: "All sessions have been revoked." });
  })
);

router.post(
  "/change-password",
  authenticateToken,
  sensitiveActionLimiter,
  asyncHandler(async (req, res) => {
    const input = changePasswordSchema.parse(req.body);
    if (!req.sessionToken) throw new AuthenticationError();
    await authService.changePassword(req.user!, req.sessionToken, input.currentPassword, input.newPassword, requestMeta(req));
    sendSuccess(res, { message: "Password changed successfully. Other active sessions have been signed out." });
  })
);

router.post(
  "/password-reset/request",
  passwordResetLimiter,
  asyncHandler(async (req, res) => {
    const input = passwordResetRequestSchema.parse(req.body);
    await captchaService.assertHuman(typeof req.body?.captchaToken === "string" ? req.body.captchaToken : undefined, req.ip);
    const result = await authService.requestPasswordReset(input.email, requestMeta(req));
    // Generic response regardless of whether the account exists — never
    // let this endpoint be used to enumerate registered emails.
    sendSuccess(res, {
      message: "If an account with that email exists, password reset instructions have been sent.",
      // Present only outside production — see authService.requestPasswordReset's doc comment.
      ...(result.devToken ? { devToken: result.devToken } : {}),
    });
  })
);

router.post(
  "/password-reset/confirm",
  passwordResetLimiter,
  asyncHandler(async (req, res) => {
    const input = passwordResetConfirmSchema.parse(req.body);
    await authService.confirmPasswordReset(input.token, input.newPassword, requestMeta(req));
    sendSuccess(res, { message: "Password has been reset. Please sign in with your new password." });
  })
);

/** Self-service session list (Phase 4 Security UI) — never returns tokenHash, only safe metadata. */
router.get(
  "/sessions",
  authenticateToken,
  asyncHandler(async (req, res) => {
    const [sessions, currentSession] = await Promise.all([
      sessionRepository.listActiveForUser(req.user!.id),
      req.sessionToken ? sessionRepository.findValidByToken(req.sessionToken) : null,
    ]);

    sendSuccess(res, {
      sessions: sessions.map((s) => ({
        id: s.id,
        createdAt: s.createdAt,
        expiresAt: s.expiresAt,
        lastUsedAt: s.lastUsedAt,
        ipAddress: s.ipAddress,
        userAgent: s.userAgent,
        isCurrent: currentSession?.id === s.id,
      })),
    });
  })
);

/** Revokes one of the CALLER's OWN sessions only — never another user's, regardless of permission (this is a self-service "sign out this device" action, not an admin capability). */
router.post(
  "/sessions/:id/revoke",
  authenticateToken,
  sensitiveActionLimiter,
  asyncHandler(async (req, res) => {
    const revoked = await sessionRepository.revokeByIdForUser(req.params.id!, req.user!.id);
    if (!revoked) throw new NotFoundError("Session not found.");
    await auditLogRepository.record({
      organizationId: req.user!.organizationId,
      actorUserId: req.user!.id,
      actorType: "USER",
      action: "AUTH_SESSION_REVOKED",
      resourceType: "session",
      resourceId: req.params.id!,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });
    sendSuccess(res, { message: "Session revoked." });
  })
);

/** Signs out every other device while keeping the current session. */
router.post(
  "/sessions/revoke-others",
  authenticateToken,
  sensitiveActionLimiter,
  asyncHandler(async (req, res) => {
    await sessionRepository.revokeAllForUserExcept(req.user!.id, req.sessionToken!);
    await auditLogRepository.record({
      organizationId: req.user!.organizationId,
      actorUserId: req.user!.id,
      actorType: "USER",
      action: "AUTH_OTHER_SESSIONS_REVOKED",
      resourceType: "user",
      resourceId: req.user!.id,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });
    sendSuccess(res, { message: "All other sessions were signed out." });
  })
);

router.post(
  "/switch-organization",
  authenticateToken,
  sensitiveActionLimiter,
  asyncHandler(async (req, res) => {
    const input = switchOrganizationSchema.parse(req.body);
    if (!req.sessionToken) throw new AuthenticationError();
    const result = await authService.switchOrganization(req.user!, req.sessionToken, input.organizationId, requestMeta(req));
    sendSuccess(res, result);
  })
);

export default router;
